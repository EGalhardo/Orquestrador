import http from 'node:http'
import path from 'node:path'
import { getConfig, publicConfig, setConfig, clearKey, isConfigured, importLegacyConfig, DEFAULT_MODELS, listSecrets, setSecret, deleteSecret, SECRET_NAMES, type ProviderId, type SecretName } from './config.ts'
import { verifyToken } from './github.ts'
import { parseDataUrl, type ImagePart } from './llm.ts'
import { createProject, tree } from './projectFs.ts'
import { runAgent, resetHistory } from './agent.ts'
import * as checkpoints from './checkpoints.ts'
import { sandboxKind } from './sandbox.ts'
import * as procs from './processes.ts'
import * as auth from './auth.ts'
import * as repo from './repo.ts'
import { DATA_DIR } from './db.ts'
import { HttpError, type User } from './auth.ts'

const PORT = Number(process.env.PORT || 8787)
/** conversationId → { controller, owner } for the currently running agent task */
const running = new Map<string, { ctrl: AbortController; userId: number; project: string }>()

// First account: adopt projects created before accounts existed + import old config/histories.
auth.setOnFirstUser((u) => {
  repo.adoptUnownedProjects(u.id)
  importLegacyConfig(u.id)
  repo.importLegacyHistories(u.id, path.join(DATA_DIR, 'histories'))
})
// Folders added by hand later are adopted by the first admin.
const firstAdmin = auth.listUsers().find((u) => u.role === 'admin')
if (firstAdmin) repo.adoptUnownedProjects(firstAdmin.id)

/** Every account starts with a workspace of its own (the first admin adopts existing projects instead). */
async function ensureStarterProject(userId: number) {
  if (repo.userProjects(userId).length) return
  let name = `projeto-${userId}`
  for (let i = 2; repo.projectOwner(name) !== undefined; i++) name = `projeto-${userId}-${i}`
  try { repo.claimNewProject(userId, name); await createProject(name) } catch { /* name taken on disk: user can create one manually */ }
}

async function body(req: http.IncomingMessage, max = 5_000_000) {
  let raw = ''
  for await (const chunk of req) { raw += chunk; if (raw.length > max) throw new HttpError(413, 'Pedido demasiado grande (imagens a mais?)') }
  try { return raw ? JSON.parse(raw) : {} } catch { throw new HttpError(400, 'JSON inválido') }
}
const json = (res: http.ServerResponse, code: number, data: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }); res.end(JSON.stringify(data))
}
const ipOf = (req: http.IncomingMessage) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || ''
const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at, lastLoginAt: u.last_login_at, disabled: !!u.disabled })

/**
 * Session token: `Authorization: Bearer` (works inside third-party iframes where browsers block cookies),
 * then the HttpOnly cookie, then `?access_token=` for EventSource streams (GET only; they cannot send headers).
 */
function tokenOf(req: http.IncomingMessage, url: URL) {
  // Custom header first: proxies in front of the app may strip or replace `Authorization`.
  const x = String(req.headers['x-forge-session'] ?? '').trim()
  if (x) return x
  const h = String(req.headers.authorization ?? '')
  if (h.startsWith('Bearer ')) { const t = h.slice(7).trim(); if (auth.userForToken(t)) return t }
  const c = auth.readCookie(req)
  if (c) return c
  if ((req.method ?? 'GET') === 'GET' && url.pathname.endsWith('/stream')) return url.searchParams.get('access_token') ?? undefined
  return undefined
}

/**
 * CSRF defence: state-changing requests must come from the same origin as the page.
 * (Preview apps run on other ports of the same host, so SameSite cookies alone are not enough.)
 */
function sameOrigin(req: http.IncomingMessage) {
  const origin = req.headers.origin
  if (!origin) return true // non-browser clients (curl, tests)
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim()
  try { return new URL(origin).host === host } catch { return false }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  const p = url.pathname
  const method = req.method ?? 'GET'
  if (process.env.FORGE_DEBUG_AUTH && p.startsWith('/api/auth')) console.log('[auth-debug]', method, p, JSON.stringify({ host: req.headers.host, origin: req.headers.origin, xfh: req.headers['x-forwarded-host'], xfp: req.headers['x-forwarded-proto'], cookie: req.headers.cookie ? 'present' : 'none' }))
  try {
    if (method !== 'GET' && method !== 'HEAD' && !sameOrigin(req)) throw new HttpError(403, 'Origem não permitida.')

    // ---------- public ----------
    if (p === '/api/health') return json(res, 200, { ok: true })
    if (p === '/api/auth/status') return json(res, 200, { hasUsers: auth.userCount() > 0, signupOpen: auth.signupOpen() })
    if (p === '/api/auth/register' && method === 'POST') {
      const u = auth.register(await body(req))
      await ensureStarterProject(u.id)
      const token = auth.createSession(u.id, { ua: req.headers['user-agent'], ip: ipOf(req) })
      return json(res, 200, { ...publicUser(u), token }, { 'set-cookie': auth.sessionCookie(req, token) })
    }
    if (p === '/api/auth/login' && method === 'POST') {
      const b = await body(req)
      const u = auth.login(b.email, b.password, ipOf(req))
      const token = auth.createSession(u.id, { ua: req.headers['user-agent'], ip: ipOf(req) })
      return json(res, 200, { ...publicUser(u), token }, { 'set-cookie': auth.sessionCookie(req, token) })
    }
    if (p === '/api/auth/logout' && method === 'POST') {
      const t = tokenOf(req, url); if (t) auth.destroySession(t)
      return json(res, 200, { ok: true }, { 'set-cookie': auth.sessionCookie(req, null) })
    }

    // ---------- everything else requires a session ----------
    const token = tokenOf(req, url)
    const user = auth.userForToken(token)
    if (!user) return json(res, 401, { error: 'Sessão expirada. Inicia sessão novamente.' })
    const uid = user.id

    // account
    if (p === '/api/auth/me' && method === 'GET') return json(res, 200, { ...publicUser(user), sessions: auth.countSessions(uid) })
    if (p === '/api/auth/me' && method === 'PATCH') return json(res, 200, publicUser(auth.updateProfile(uid, await body(req))))
    if (p === '/api/auth/password' && method === 'POST') { const b = await body(req); auth.changePassword(uid, b.current, b.next, token!); return json(res, 200, { ok: true }) }
    if (p === '/api/auth/sessions/others' && method === 'DELETE') return json(res, 200, { closed: auth.destroyOtherSessions(uid, token!) })

    // AI provider config (per user)
    if (p === '/api/config' && method === 'GET') return json(res, 200, { ...publicConfig(getConfig(uid)), defaults: DEFAULT_MODELS, sandbox: sandboxKind() })
    if (p === '/api/config' && method === 'POST') {
      const b = await body(req)
      const patch: Record<string, string> = {}
      if (b.provider) { patch.provider = b.provider as ProviderId; if (!b.model) patch.model = DEFAULT_MODELS[b.provider as ProviderId] }
      if (typeof b.model === 'string' && b.model) patch.model = b.model
      if (typeof b.apiKey === 'string' && b.apiKey) patch.apiKey = b.apiKey.trim()
      if (typeof b.baseUrl === 'string') patch.baseUrl = b.baseUrl.trim()
      return json(res, 200, publicConfig(setConfig(uid, patch)))
    }
    // ---------- secrets: AI keys per provider + GitHub token (encrypted, never returned) ----------
    if (p === '/api/keys' && method === 'GET') return json(res, 200, listSecrets(uid))
    if (p === '/api/keys' && method === 'POST') {
      const b = await body(req)
      const name = String(b.name ?? '') as SecretName
      const value = String(b.value ?? '').trim()
      if (!SECRET_NAMES.includes(name)) throw new HttpError(400, 'Chave desconhecida.')
      if (value.length < 8 || value.length > 500 || /\s/.test(value)) throw new HttpError(400, 'Valor inválido.')
      if (name === 'github') {
        let login = ''
        try { login = (await verifyToken(value)).login } catch (e) { throw new HttpError(400, `GitHub: ${(e as Error).message}`) }
        setSecret(uid, 'github', value, { github_login: login })
      } else setSecret(uid, name, value)
      return json(res, 200, listSecrets(uid))
    }
    const km = p.match(/^\/api\/keys\/(\w+)$/)
    if (km && method === 'DELETE') {
      if (!SECRET_NAMES.includes(km[1] as SecretName)) throw new HttpError(400, 'Chave desconhecida.')
      deleteSecret(uid, km[1] as SecretName)
      return json(res, 200, listSecrets(uid))
    }
    if (p === '/api/config/key' && method === 'DELETE') return json(res, 200, publicConfig(clearKey(uid, getConfig(uid).provider)))

    // projects (owned by the user)
    if (p === '/api/projects' && method === 'GET') return json(res, 200, repo.userProjects(uid))
    if (p === '/api/projects' && method === 'POST') {
      const b = await body(req); const name = String(b.name ?? '').trim()
      repo.claimNewProject(uid, name)
      try { await createProject(name) } catch (e) { repo.deleteProjectRow(uid, name); throw e }
      return json(res, 200, { ok: true })
    }
    const m = p.match(/^\/api\/projects\/([\w.-]+)\/tree$/)
    if (m) return json(res, 200, await tree(repo.assertProject(uid, m[1])))

    // conversations
    if (p === '/api/conversations' && method === 'GET') return json(res, 200, repo.listConversations(uid))
    const cm = p.match(/^\/api\/conversations\/([\w-]{1,80})$/)
    if (cm && method === 'PUT') {
      const b = await body(req)
      if (b.project) repo.assertProject(uid, b.project)
      repo.upsertConversation(uid, cm[1], b); return json(res, 200, { ok: true })
    }
    if (cm && method === 'DELETE') { running.get(cm[1])?.ctrl.abort(); repo.deleteConversation(uid, cm[1]); return json(res, 200, { ok: true }) }

    // usage
    if (p === '/api/usage' && method === 'GET') return json(res, 200, repo.usageSummary(uid, Math.min(365, Number(url.searchParams.get('days')) || 30)))

    // ---------- background processes (only for the user's projects) ----------
    const mine = new Set(repo.userProjects(uid))
    if (p === '/api/processes' && method === 'GET') {
      const only = url.searchParams.get('project') ?? undefined
      return json(res, 200, procs.list(only).filter((x) => mine.has(x.project)))
    }
    if (p === '/api/processes' && method === 'POST') {
      const b = await body(req)
      const project = repo.assertProject(uid, b.project)
      try { const started = await procs.start(project, b.command, b.name); return json(res, 200, await procs.waitReady(started.id, 4000) ?? started) }
      catch (e) { throw new HttpError(400, (e as Error).message) }
    }
    const pm = p.match(/^\/api\/processes\/(p\d+)(?:\/(stop|restart|logs|stream))?$/)
    if (pm) {
      const [, id, action] = pm
      const proc = procs.get(id)
      if (!proc || !mine.has(proc.project)) throw new HttpError(404, 'Processo desconhecido.')
      if (action === 'stop' && method === 'POST') { procs.stop(id); return json(res, 200, { ok: true }) }
      if (action === 'restart' && method === 'POST') return json(res, 200, await procs.restart(id))
      if (action === 'logs') return json(res, 200, { log: procs.logs(id, 50_000) })
      if (action === 'stream') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' })
        res.write(`data: ${JSON.stringify({ chunk: procs.logs(id, 20_000) })}\n\n`)
        const off = procs.subscribe(id, (chunk) => res.write(`data: ${JSON.stringify({ chunk })}\n\n`))
        const ping = setInterval(() => res.write(': ping\n\n'), 15000)
        req.on('close', () => { off(); clearInterval(ping) })
        return
      }
      if (!action && method === 'DELETE') { procs.remove(id); return json(res, 200, { ok: true }) }
    }

    // ---------- checkpoints (undo) ----------
    if (p === '/api/checkpoints' && method === 'GET') {
      const project = repo.assertProject(uid, url.searchParams.get('project'))
      return json(res, 200, await checkpoints.list(project))
    }
    if (p === '/api/checkpoints/restore' && method === 'POST') {
      const b = await body(req)
      const project = repo.assertProject(uid, b.project)
      if ([...running.values()].some((r) => r.userId === uid && r.project === project)) throw new HttpError(409, 'Pára a tarefa em curso antes de desfazer alterações.')
      try { return json(res, 200, await checkpoints.restore(project, String(b.hash ?? ''), 'Alterações desfeitas')) }
      catch (e) { throw new HttpError(400, (e as Error).message) }
    }
    if (p === '/api/agent/plan' && method === 'GET') {
      const id = String(url.searchParams.get('conversationId') ?? '')
      repo.ensureConversation(uid, id)
      return json(res, 200, repo.loadPlan(id))
    }

    // ---------- agent ----------
    if (p === '/api/agent/stop' && method === 'POST') {
      const b = await body(req); const r = running.get(b.conversationId)
      if (r && r.userId === uid) r.ctrl.abort()
      return json(res, 200, { ok: true })
    }
    if (p === '/api/agent/reset' && method === 'POST') {
      const b = await body(req); repo.ensureConversation(uid, String(b.conversationId)); resetHistory(b.conversationId); return json(res, 200, { ok: true })
    }
    if (p === '/api/agent/run' && method === 'POST') {
      const b = await body(req, 30_000_000)
      const images: ImagePart[] = (Array.isArray(b.images) ? b.images : []).slice(0, 6)
        .map((i: { dataUrl?: string; name?: string }) => (typeof i?.dataUrl === 'string' && i.dataUrl.length < 8_000_000 ? parseDataUrl(i.dataUrl, String(i.name ?? 'imagem')) : null))
        .filter(Boolean) as ImagePart[]
      const project = repo.assertProject(uid, b.project)
      const conversationId = String(b.conversationId ?? '')
      repo.ensureConversation(uid, conversationId, project, String(b.instruction ?? '').slice(0, 60))
      const config = getConfig(uid)
      if (!isConfigured(config)) throw new HttpError(400, 'Nenhum fornecedor de IA configurado. Abre as Definições e adiciona a tua chave de API.')
      if (running.has(conversationId)) throw new HttpError(409, 'Já existe uma tarefa a correr nesta conversa.')
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' })
      const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`)
      const ctrl = new AbortController()
      running.set(conversationId, { ctrl, userId: uid, project })
      res.on('close', () => { if (!res.writableFinished) ctrl.abort() })
      const ping = setInterval(() => res.write(': ping\n\n'), 15000)
      try {
        await runAgent({ userId: uid, config, conversationId, project, agent: ['agent', 'code', 'debug', 'review', 'team'].includes(b.agent) ? b.agent : 'agent', instruction: String(b.instruction ?? ''), images, signal: ctrl.signal, emit: send })
      } catch (e) {
        const err = e as Error
        send(err.name === 'AbortError' ? { type: 'error', message: 'aborted' } : { type: 'error', message: err.message })
      } finally {
        clearInterval(ping); running.delete(conversationId); res.end()
      }
      return
    }

    // ---------- admin ----------
    if (p.startsWith('/api/admin/')) {
      if (user.role !== 'admin') throw new HttpError(403, 'Apenas administradores.')
      if (p === '/api/admin/users' && method === 'GET') {
        const stats = new Map(repo.adminStats().map((s) => [s.id, s]))
        return json(res, 200, auth.listUsers().map((u) => ({ ...publicUser(u), ...stats.get(u.id), id: u.id })))
      }
      if (p === '/api/admin/users' && method === 'POST') {
        const u = auth.register(await body(req), { byAdmin: true })
        await ensureStarterProject(u.id)
        return json(res, 200, publicUser(u))
      }
      const um = p.match(/^\/api\/admin\/users\/(\d+)$/)
      if (um && method === 'PATCH') return json(res, 200, publicUser(auth.adminUpdateUser(uid, Number(um[1]), await body(req))))
      if (um && method === 'DELETE') {
        const target = Number(um[1])
        const owned = repo.userProjects(target)
        auth.deleteUser(uid, target)
        // Their project folders stay on disk; stop their servers.
        for (const x of procs.list()) if (owned.includes(x.project)) procs.remove(x.id)
        return json(res, 200, { ok: true })
      }
      if (p === '/api/admin/settings' && method === 'GET') return json(res, 200, { signupOpen: auth.signupOpen() })
      if (p === '/api/admin/settings' && method === 'POST') { const b = await body(req); auth.setSignupOpen(!!b.signupOpen); return json(res, 200, { signupOpen: auth.signupOpen() }) }
    }
    json(res, 404, { error: 'Not found' })
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500
    if (status === 500) console.error(e)
    if (!res.headersSent) json(res, status, { error: (e as Error).message })
    else res.end()
  }
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`EGalhardo IA API on :${PORT} — users=${auth.userCount()} signup=${auth.signupOpen() ? 'open' : 'closed'} sandbox=${sandboxKind()} data=${DATA_DIR}`)
})
