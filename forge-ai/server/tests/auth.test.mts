// Accounts, sessions, isolation between users, admin and CSRF — against a real server instance.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'

const PORT = 8807
const BASE = `http://127.0.0.1:${PORT}`
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-auth-'))
const PROJ = path.resolve(import.meta.dirname, '../projects')
const P1 = '_authtest-a', P2 = '_authtest-b'
let failed = 0
const before = new Set(fs.readdirSync(PROJ))
const starter = { has: (n: string) => !before.has(n) && /^projeto-\d+/.test(n) }
const ok = (c: unknown, m: string, extra = '') => { console.log(c ? 'PASS' : 'FAIL', m, c ? '' : extra); if (!c) failed++ }

// Single process (no npx/tsx wrapper) so killing it never leaves an orphan server behind.
const srv = spawn(process.execPath, ['--import', 'tsx', path.resolve(import.meta.dirname, '../index.ts')], {
  env: { ...process.env, PORT: String(PORT), FORGE_DATA_DIR: DATA, FORGE_SIGNUP: '' }, stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''; srv.stdout.on('data', (d) => (out += d)); srv.stderr.on('data', (d) => (out += d))

async function call(method: string, p: string, opts: { cookie?: string; body?: unknown; origin?: string } = {}) {
  const res = await fetch(BASE + p, {
    method, headers: { 'content-type': 'application/json', ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.origin ? { origin: opts.origin } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  return { status: res.status, data: await res.json().catch(() => ({})), setCookie, cookie: setCookie.split(';')[0] }
}

try {
  for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/api/health'); break } catch { await new Promise((r) => setTimeout(r, 250)) } }

  let r = await call('GET', '/api/auth/status')
  ok(r.data.hasUsers === false && r.data.signupOpen === true, 'fresh install: no users, signup open for the first account')
  ok((await call('GET', '/api/projects')).status === 401, 'API requires a session')

  r = await call('POST', '/api/auth/register', { body: { email: 'bad', name: 'x', password: '12345678' } })
  ok(r.status === 400, 'invalid email rejected')
  r = await call('POST', '/api/auth/register', { body: { email: 'ana@forge.dev', name: 'Ana', password: 'short' } })
  ok(r.status === 400, 'short password rejected')

  r = await call('POST', '/api/auth/register', { body: { email: 'Ana@Forge.dev', name: 'Ana', password: 'ana-password-1' } })
  const admin = r.cookie
  ok(r.status === 200 && r.data.role === 'admin', 'first account becomes admin')
  ok(/HttpOnly/.test(r.setCookie) && /SameSite=Lax/.test(r.setCookie), 'session cookie is HttpOnly + SameSite')
  {
    const res = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-proto': 'https,http' }, body: JSON.stringify({ email: 'ana@forge.dev', password: 'ana-password-1' }) })
    const c = res.headers.get('set-cookie') ?? ''
    ok(/SameSite=None/.test(c) && /Secure/.test(c) && /Partitioned/.test(c), 'behind https (embedded preview): cookie works inside iframes (SameSite=None; Secure; Partitioned)', c)
  }
  {
    // Bearer token (used when browsers block cookies in third-party iframes)
    const lr = await call('POST', '/api/auth/login', { body: { email: 'ana@forge.dev', password: 'ana-password-1' } })
    ok(typeof lr.data.token === 'string' && lr.data.token.length > 20, 'login also returns a session token for header auth')
    const me = await fetch(BASE + '/api/auth/me', { headers: { authorization: `Bearer ${lr.data.token}` } })
    ok(me.status === 200, 'Authorization: Bearer works without any cookie')
    ok((await fetch(BASE + '/api/auth/me', { headers: { authorization: 'Bearer invalid-token' } })).status === 401, 'invalid bearer token rejected')
    ok((await fetch(BASE + `/api/projects?access_token=${lr.data.token}`)).status === 401, 'access_token query param NOT accepted outside log streams')
    await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${lr.data.token}` } })
    ok((await fetch(BASE + '/api/auth/me', { headers: { authorization: `Bearer ${lr.data.token}` } })).status === 401, 'logout revokes the bearer token')
  }
  ok((await call('GET', '/api/auth/me', { cookie: admin })).data.email === 'ana@forge.dev', 'session works; email normalised')

  r = await call('GET', '/api/auth/status')
  ok(r.data.signupOpen === false, 'signup closes after the first account')
  ok((await call('POST', '/api/auth/register', { body: { email: 'eve@x.io', name: 'Eve', password: 'eve-password' } })).status === 403, 'public signup blocked while closed')

  r = await call('POST', '/api/admin/users', { cookie: admin, body: { email: 'bob@forge.dev', name: 'Bob', password: 'bob-password-1' } })
  ok(r.status === 200 && r.data.role === 'user', 'admin creates a user')
  ok((await call('POST', '/api/admin/users', { cookie: admin, body: { email: 'bob@forge.dev', name: 'B2', password: 'bob-password-2' } })).status === 409, 'duplicate email rejected')

  ok((await call('POST', '/api/auth/login', { body: { email: 'bob@forge.dev', password: 'wrong-pass' } })).status === 401, 'wrong password rejected')
  r = await call('POST', '/api/auth/login', { body: { email: 'bob@forge.dev', password: 'bob-password-1' } })
  const bob = r.cookie
  ok(r.status === 200 && bob, 'user logs in')
  ok((await call('GET', '/api/projects', { cookie: bob })).data.some((n: string) => /^projeto-\d+$/.test(n)), 'new user gets a starter project')
  ok((await call('GET', '/api/admin/users', { cookie: bob })).status === 403, 'non-admin cannot use admin API')

  // projects isolation
  ok((await call('POST', '/api/projects', { cookie: admin, body: { name: P1 } })).status === 200, 'admin creates a project')
  ok((await call('POST', '/api/projects', { cookie: bob, body: { name: P2 } })).status === 200, 'user creates a project')
  ok((await call('POST', '/api/projects', { cookie: bob, body: { name: P1 } })).status === 409, 'project names cannot be taken over')
  r = await call('GET', '/api/projects', { cookie: bob })
  ok(r.data.includes(P2) && !r.data.includes(P1), 'users only list their own projects', JSON.stringify(r.data))
  ok((await call('GET', `/api/projects/${P1}/tree`, { cookie: bob })).status === 404, "cannot read another user's files")
  ok((await call('POST', '/api/processes', { cookie: bob, body: { project: P1, command: 'node -e 1' } })).status === 404, "cannot start processes in another user's project")

  // conversations isolation
  ok((await call('PUT', '/api/conversations/conv-a1', { cookie: admin, body: { title: 'Olá', project: P1, data: { messages: [{ id: 'm', role: 'user', content: 'oi' }] } } })).status === 200, 'conversation saved')
  r = await call('GET', '/api/conversations', { cookie: admin })
  ok(r.data.length === 1 && r.data[0].title === 'Olá' && r.data[0].messages?.[0]?.content === 'oi', 'conversation loaded with its messages')
  ok((await call('GET', '/api/conversations', { cookie: bob })).data.length === 0, "user doesn't see others' conversations")
  ok((await call('PUT', '/api/conversations/conv-a1', { cookie: bob, body: { title: 'hack' } })).status === 404, "cannot overwrite others' conversation")
  ok((await call('DELETE', '/api/conversations/conv-a1', { cookie: bob })).status === 404, "cannot delete others' conversation")
  ok((await call('POST', '/api/agent/run', { cookie: bob, body: { conversationId: 'conv-a1', project: P2, instruction: 'x' } })).status === 404, "cannot run the agent on others' conversation")

  // per-user AI config
  await call('POST', '/api/config', { cookie: admin, body: { provider: 'openai', apiKey: 'sk-admin-secret-9999' } })
  r = await call('GET', '/api/config', { cookie: bob })
  ok(r.data.keyHint === '' && r.data.provider !== 'openai', "user doesn't inherit admin's key")
  ok((await call('GET', '/api/config', { cookie: admin })).data.keyHint === '••••9999', 'admin sees only a key hint')

  // CSRF
  ok((await call('POST', '/api/projects', { cookie: admin, origin: 'http://evil.example', body: { name: 'x' } })).status === 403, 'cross-origin writes blocked (CSRF)')
  ok((await call('POST', '/api/projects', { cookie: admin, origin: `http://localhost:8790`, body: { name: 'x' } })).status === 403, 'writes from a preview app (other port) blocked')

  // sessions / passwords
  const bob2 = (await call('POST', '/api/auth/login', { body: { email: 'bob@forge.dev', password: 'bob-password-1' } })).cookie
  ok((await call('POST', '/api/auth/password', { cookie: bob, body: { current: 'nope-nope', next: 'bob-password-2' } })).status === 400, 'password change needs the current password')
  ok((await call('POST', '/api/auth/password', { cookie: bob, body: { current: 'bob-password-1', next: 'bob-password-2' } })).status === 200, 'password changed')
  ok((await call('GET', '/api/auth/me', { cookie: bob2 })).status === 401, 'password change signs out other sessions')
  ok((await call('GET', '/api/auth/me', { cookie: bob })).status === 200, 'current session kept')
  ok((await call('POST', '/api/auth/login', { body: { email: 'bob@forge.dev', password: 'bob-password-2' } })).status === 200, 'new password works')

  // rate limiting
  let last = 0
  for (let i = 0; i < 9; i++) last = (await call('POST', '/api/auth/login', { body: { email: 'ana@forge.dev', password: 'guess-' + i } })).status
  ok(last === 429, 'login brute force rate-limited', String(last))

  // admin safety + disable
  const bobId = (await call('GET', '/api/auth/me', { cookie: bob })).data.id
  const anaId = (await call('GET', '/api/auth/me', { cookie: admin })).data.id
  ok((await call('PATCH', `/api/admin/users/${anaId}`, { cookie: admin, body: { role: 'user' } })).status === 400, 'last admin cannot be demoted')
  ok((await call('PATCH', `/api/admin/users/${bobId}`, { cookie: admin, body: { disabled: true } })).status === 200, 'admin disables a user')
  ok((await call('GET', '/api/auth/me', { cookie: bob })).status === 401, 'disabled user is signed out')
  ok((await call('POST', '/api/auth/login', { body: { email: 'bob@forge.dev', password: 'bob-password-2' } })).status === 403, 'disabled user cannot log in')
  ok((await call('POST', '/api/admin/settings', { cookie: admin, body: { signupOpen: true } })).data.signupOpen === true, 'admin can open signup')
  ok((await call('POST', '/api/auth/register', { body: { email: 'eve@x.io', name: 'Eve', password: 'eve-password' } })).status === 200, 'signup works when opened')

  // storage checks
  const db = new Database(path.join(DATA, 'forge.db'), { readonly: true })
  const raw = JSON.stringify(db.prepare('SELECT * FROM sessions').all()) + JSON.stringify(db.prepare('SELECT * FROM users').all())
  ok(!raw.includes(admin.split('=')[1]) && /scrypt\$/.test(raw) && !raw.includes('ana-password-1'), 'tokens stored hashed, passwords scrypt-hashed')
  ok(!JSON.stringify(db.prepare('SELECT * FROM user_settings').all()).includes('sk-admin'), 'API keys encrypted at rest')
  db.close()

  ok((await call('DELETE', `/api/admin/users/${bobId}`, { cookie: admin })).status === 200, 'admin deletes a user')
  ok((await call('GET', '/api/admin/users', { cookie: admin })).data.every((u: { email: string }) => u.email !== 'bob@forge.dev'), 'deleted user gone')

  r = await call('POST', '/api/auth/logout', { cookie: admin })
  ok(/Max-Age=0/.test(r.setCookie), 'logout clears the cookie')
  ok((await call('GET', '/api/auth/me', { cookie: admin })).status === 401, 'logged-out session is invalid')
} catch (e) {
  failed++; console.log('FAIL exception', e, out.slice(-2000))
} finally {
  srv.kill('SIGTERM')
  await new Promise((r) => { if (srv.exitCode !== null) r(0); else { srv.once('exit', r); setTimeout(() => { srv.kill('SIGKILL'); r(0) }, 3000) } })
  for (const p of [P1, P2, ...fs.readdirSync(PROJ).filter((n) => starter.has(n))]) fs.rmSync(path.join(PROJ, p), { recursive: true, force: true })
  fs.rmSync(DATA, { recursive: true, force: true })
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
