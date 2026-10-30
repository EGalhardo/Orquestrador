/**
 * GitHub integration: clone / status / commit / push / pull / branches / pull requests.
 *
 * Security:
 * - git runs INSIDE the sandbox (a repository's own config/hooks can't execute code on the host).
 * - The token is passed as an environment variable and referenced as $VAR by the command, so it
 *   never appears in the command text, in .git/config or in the tool output (output is scrubbed).
 * - The auth header is scoped to https://github.com/ only; hooks are disabled.
 */
import { exec } from './sandbox.ts'
import * as pfs from './projectFs.ts'

export const GITHUB_API = () => process.env.FORGE_GITHUB_API || 'https://api.github.com'
const WEB = 'https://github.com/'
const allowLocal = () => process.env.FORGE_GITHUB_ALLOW_LOCAL === '1' // tests only

export interface GithubAuth { token: string; login: string }
export interface GitResult { output: string; isError?: boolean }

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const scrub = (text: string, token: string) => (token ? text.split(token).join('***') : text)

/** "owner/repo", "https://github.com/owner/repo(.git)" or "git@github.com:owner/repo" → clone URL. */
export function repoUrl(input: string): string {
  const s = input.trim()
  let m = s.match(/^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
  if (m) return `${WEB}${m[1]}/${m[2]}.git`
  m = s.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  if (m) return `${WEB}${m[1]}/${m[2]}.git`
  if (allowLocal() && (s.startsWith('/') || s.startsWith('file://') || s.startsWith('git://127.0.0.1'))) return s
  throw new Error(`Repositório inválido: "${input}". Usa "dono/nome" ou https://github.com/dono/nome`)
}

/** owner/repo from a remote URL (https or ssh). */
export function parseRemote(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

function gitPrefix(auth: GithubAuth) {
  const flags = ['-c core.hooksPath=/dev/null', '-c credential.helper=', '-c core.fsmonitor=false', '-c protocol.file.allow=' + (allowLocal() ? 'always' : 'never')]
  if (auth.token) flags.push(`-c "http.${WEB}.extraheader=Authorization: Basic $FORGE_GH_AUTH"`)
  const name = auth.login || 'EGalhardo IA'
  flags.push(`-c user.name=${q(name)}`, `-c user.email=${q(`${auth.login || 'forge'}@users.noreply.github.com`)}`)
  return `git ${flags.join(' ')}`
}

async function run(project: string, auth: GithubAuth, script: string, extraEnv: Record<string, string> = {}, signal?: AbortSignal): Promise<GitResult & { exitCode: number }> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/bin/true', ...extraEnv }
  if (auth.token) env.FORGE_GH_AUTH = Buffer.from(`x-access-token:${auth.token}`).toString('base64')
  const r = await exec(project, script, { env, network: true, timeoutMs: 300_000, signal })
  if (r.aborted) throw new DOMException('Aborted', 'AbortError')
  const out = scrub(scrub(r.output, auth.token), env.FORGE_GH_AUTH ?? '').trim()
  return { output: out || '(sem saída)', exitCode: r.exitCode, isError: r.exitCode !== 0 }
}

async function api(auth: GithubAuth, method: string, path: string, body?: unknown) {
  const res = await fetch(`${GITHUB_API()}${path}`, {
    method,
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'EGalhardo IA', ...(auth.token ? { authorization: `Bearer ${auth.token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data: data as Record<string, unknown> }
}

/** Validate a token and return the account login. */
export async function verifyToken(token: string): Promise<{ login: string; scopes: string }> {
  const res = await fetch(`${GITHUB_API()}/user`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'EGalhardo IA' }, signal: AbortSignal.timeout(15_000) })
  if (res.status === 401) throw new Error('Token inválido ou expirado.')
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}.`)
  const j = await res.json() as { login: string }
  return { login: j.login, scopes: res.headers.get('x-oauth-scopes') ?? '' }
}

export type GithubAction = 'clone' | 'status' | 'commit' | 'push' | 'pull' | 'branch' | 'checkout' | 'create_pr' | 'log'
export const GITHUB_ACTIONS: GithubAction[] = ['clone', 'status', 'commit', 'push', 'pull', 'branch', 'checkout', 'create_pr', 'log']

export async function githubAction(project: string, auth: GithubAuth, action: string, args: Record<string, string | undefined>, signal?: AbortSignal): Promise<GitResult> {
  const g = gitPrefix(auth)
  const needRepo = async () => {
    const r = await run(project, auth, 'git rev-parse --is-inside-work-tree', {}, signal)
    if (r.isError) throw new Error('Este projeto ainda não é um repositório git. Usa github com action "clone" (projeto vazio) ou pede ao utilizador.')
  }
  const branchName = (s?: string) => {
    const b = String(s ?? '').trim()
    if (!/^[\w./-]{1,100}$/.test(b) || b.includes('..') || b.startsWith('-')) throw new Error(`Nome de branch inválido: "${b}"`)
    return b
  }
  switch (action) {
    case 'clone': {
      const url = repoUrl(String(args.repo ?? ''))
      const files = await pfs.listFiles(project).catch(() => [])
      if (files.length) return { output: `O projeto não está vazio (${files.length} ficheiros). Só é possível clonar para um projeto vazio — cria um projeto novo.`, isError: true }
      const br = args.branch ? ` --branch ${q(branchName(args.branch))}` : ''
      const r = await run(project, auth, `${g} clone${br} -- ${q(url)} . && git log --oneline -5`, {}, signal)
      if (r.isError && /Authentication failed|could not read Username|403|404|not found/i.test(r.output)) r.output += auth.token ? '\n\nDICA: confirma que o token tem acesso a este repositório.' : '\n\nDICA: repositório privado? Adiciona um token do GitHub em Definições → Chaves e integrações.'
      return r
    }
    case 'status': await needRepo(); return run(project, auth, 'git status -sb && echo && git remote -v && echo && git log --oneline -5', {}, signal)
    case 'log': await needRepo(); return run(project, auth, 'git log --oneline --decorate -20', {}, signal)
    case 'commit': {
      await needRepo()
      const msg = String(args.message ?? '').trim()
      if (!msg) return { output: 'Falta "message".', isError: true }
      const r = await run(project, auth, `git add -A && if git diff --cached --quiet; then echo "Nada para fazer commit (sem alterações)."; else ${g} commit -q -m "$FORGE_MSG" && git log --oneline -1 && git show --stat --format= HEAD | tail -15; fi`, { FORGE_MSG: msg.slice(0, 2000) }, signal)
      return r
    }
    case 'push': {
      await needRepo()
      if (!auth.token && !allowLocal()) return { output: 'Para enviar (push) é preciso um token do GitHub. Adiciona-o em Definições → Chaves e integrações.', isError: true }
      const target = args.branch ? branchName(args.branch) : 'HEAD'
      const r = await run(project, auth, `${g} push -u origin ${q(target)} 2>&1`, {}, signal)
      if (r.isError && /rejected|non-fast-forward|fetch first/i.test(r.output)) r.output += '\n\nDICA: o remoto tem commits novos. Faz "pull" primeiro e resolve conflitos, depois "push".'
      return r
    }
    case 'pull': {
      await needRepo()
      const r = await run(project, auth, `${g} pull --no-rebase --no-edit 2>&1 && git log --oneline -5`, {}, signal)
      if (r.isError && /CONFLICT/.test(r.output)) r.output += '\n\nHá conflitos: edita os ficheiros marcados (<<<<<<< / >>>>>>>), depois usa "commit".'
      return r
    }
    case 'branch': { await needRepo(); const b = branchName(args.name); return run(project, auth, `git checkout -b ${q(b)} && git status -sb`, {}, signal) }
    case 'checkout': { await needRepo(); const b = branchName(args.name); return run(project, auth, `${g} checkout ${q(b)} 2>&1 || (${g} fetch origin ${q(b)} 2>&1 && git checkout ${q(b)}) && git status -sb`, {}, signal) }
    case 'create_pr': {
      await needRepo()
      if (!auth.token) return { output: 'Para abrir um Pull Request é preciso um token do GitHub (Definições → Chaves e integrações).', isError: true }
      const remote = (await run(project, auth, 'git remote get-url origin', {}, signal)).output
      const rr = parseRemote(remote)
      if (!rr) return { output: `O remoto "origin" não é do GitHub: ${remote}`, isError: true }
      const head = args.head ? branchName(args.head) : (await run(project, auth, 'git rev-parse --abbrev-ref HEAD', {}, signal)).output.trim()
      let base = args.base ? branchName(args.base) : ''
      if (!base) { const info = await api(auth, 'GET', `/repos/${rr.owner}/${rr.repo}`); base = String(info.data.default_branch ?? 'main') }
      if (head === base) return { output: `A branch atual (${head}) é a base. Cria uma branch nova ("branch"), faz commit e push, e depois abre o PR.`, isError: true }
      const title = String(args.title ?? '').trim() || `Alterações em ${head}`
      const r = await api(auth, 'POST', `/repos/${rr.owner}/${rr.repo}/pulls`, { title, body: String(args.body ?? ''), head, base })
      if (!r.ok) {
        const errs = (r.data.errors as { message?: string }[] | undefined)?.map((e) => e.message).filter(Boolean).join('; ')
        return { output: `Falhou a criação do PR (${r.status}): ${String(r.data.message ?? '')}${errs ? ` — ${errs}` : ''}${r.status === 422 ? '\nDICA: faz "push" da branch primeiro, ou já existe um PR aberto para ela.' : ''}`, isError: true }
      }
      return { output: `Pull Request #${r.data.number} criado: ${r.data.html_url}\n${head} → ${base}` }
    }
    default:
      return { output: `Ação desconhecida "${action}". Disponíveis: ${GITHUB_ACTIONS.join(', ')}`, isError: true }
  }
}
