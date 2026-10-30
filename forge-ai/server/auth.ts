/**
 * Accounts & sessions.
 * - Passwords: scrypt (N=16384, r=8, p=1), random 16-byte salt, constant-time compare.
 * - Sessions: random 32-byte token in an HttpOnly SameSite=Lax cookie; only its SHA-256 is stored.
 * - The first account is admin. Afterwards signup is controlled by the admin (app setting).
 */
import crypto from 'node:crypto'
import type http from 'node:http'
import { db, getSetting, setSetting } from './db.ts'

export interface User { id: number; email: string; name: string; role: 'admin' | 'user'; disabled: number; created_at: number; last_login_at: number | null }
export const COOKIE = 'forge_session'
const SESSION_DAYS = Number(process.env.FORGE_SESSION_DAYS || 30)
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export class HttpError extends Error { constructor(public status: number, message: string) { super(message) } }

// ---------- passwords ----------
export function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16)
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 })
  return `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`
}
export function verifyPassword(pw: string, stored: string) {
  const [alg, n, salt, hash] = stored.split('$')
  if (alg !== 'scrypt') return false
  const expected = Buffer.from(hash, 'base64')
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 })
  return crypto.timingSafeEqual(expected, got)
}
function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'A palavra-passe deve ter pelo menos 8 caracteres.')
  if (pw.length > 200) throw new HttpError(400, 'Palavra-passe demasiado longa.')
  return pw
}
// Used when a login targets an unknown email, so timing does not reveal which emails exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'))

// ---------- users ----------
const USER_COLS = 'id, email, name, role, disabled, created_at, last_login_at'
export const userCount = () => (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n
export const getUser = (id: number) => db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as User | undefined
export const listUsers = () => db.prepare(`SELECT ${USER_COLS} FROM users ORDER BY created_at`).all() as User[]
export const signupOpen = () => userCount() === 0 || getSetting('signup_open', process.env.FORGE_SIGNUP === 'open' ? '1' : '0') === '1'
export const setSignupOpen = (open: boolean) => setSetting('signup_open', open ? '1' : '0')

/** Hook run after the first (admin) account exists: claims pre-existing projects/config. */
let onFirstUser: (u: User) => void = () => {}
export const setOnFirstUser = (fn: (u: User) => void) => { onFirstUser = fn }

export function register(input: { email?: unknown; name?: unknown; password?: unknown }, opts: { byAdmin?: boolean } = {}) {
  const email = String(input.email ?? '').trim().toLowerCase()
  const name = String(input.name ?? '').trim().slice(0, 80)
  if (!EMAIL_RE.test(email) || email.length > 200) throw new HttpError(400, 'Email inválido.')
  if (!name) throw new HttpError(400, 'Indica o teu nome.')
  const password = validatePassword(input.password)
  if (!opts.byAdmin && !signupOpen()) throw new HttpError(403, 'O registo está fechado. Pede uma conta ao administrador.')
  const first = userCount() === 0
  try {
    const r = db.prepare('INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(email, name, hashPassword(password), first ? 'admin' : 'user', Date.now())
    const user = getUser(Number(r.lastInsertRowid))!
    if (first) onFirstUser(user)
    return user
  } catch (e) {
    if (String((e as Error).message).includes('UNIQUE')) throw new HttpError(409, 'Já existe uma conta com esse email.')
    throw e
  }
}

// ---------- login rate limiting (in memory) ----------
const fails = new Map<string, { n: number; until: number }>()
const WINDOW = 15 * 60_000, MAX_FAILS = 8
function checkRate(key: string) {
  const f = fails.get(key)
  if (f && f.n >= MAX_FAILS && f.until > Date.now()) throw new HttpError(429, 'Demasiadas tentativas. Tenta novamente daqui a alguns minutos.')
}
function noteFail(key: string) {
  const f = fails.get(key)
  const fresh = !f || f.until < Date.now()
  fails.set(key, { n: fresh ? 1 : f!.n + 1, until: Date.now() + WINDOW })
}

export function login(email: unknown, password: unknown, ip = '') {
  const e = String(email ?? '').trim().toLowerCase()
  const key = `${ip}|${e}`
  checkRate(key)
  const row = db.prepare('SELECT id, password_hash, disabled FROM users WHERE email = ?').get(e) as { id: number; password_hash: string; disabled: number } | undefined
  const ok = verifyPassword(String(password ?? ''), row?.password_hash ?? DUMMY_HASH) && !!row
  if (!ok) { noteFail(key); throw new HttpError(401, 'Email ou palavra-passe incorretos.') }
  if (row.disabled) throw new HttpError(403, 'Esta conta está desativada.')
  fails.delete(key)
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Date.now(), row.id)
  return getUser(row.id)!
}

// ---------- sessions ----------
const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex')

export function createSession(userId: number, meta: { ua?: string; ip?: string } = {}) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)')
    .run(sha(token), userId, now, now + SESSION_DAYS * 86_400_000, (meta.ua ?? '').slice(0, 200), meta.ip ?? '')
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now)
  return token
}
export const destroySession = (token: string) => db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token))
export const destroyOtherSessions = (userId: number, keepToken: string) =>
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha(keepToken)).changes
export const countSessions = (userId: number) =>
  (db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id = ? AND expires_at > ?').get(userId, Date.now()) as { n: number }).n

export function userForToken(token: string | undefined): User | null {
  if (!token) return null
  const row = db.prepare(`SELECT u.id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0`).get(sha(token), Date.now()) as { id: number } | undefined
  return row ? getUser(row.id)! : null
}

export function readCookie(req: http.IncomingMessage, name = COOKIE) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return undefined
}
export function sessionCookie(req: http.IncomingMessage, token: string | null) {
  // Over https (directly or behind a proxy) the app may be shown inside an iframe on another site
  // (e.g. a hosted preview). SameSite=Lax cookies are dropped there, so use SameSite=None + Secure,
  // partitioned (CHIPS) so the cookie is isolated to that embedding site. CSRF is still blocked by the Origin check.
  // Proxies append to X-Forwarded-Proto ("https,http"): the first entry is what the browser used.
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim()
  const https = proto === 'https' || String(req.headers.origin ?? '').startsWith('https://') || !!(req.socket as { encrypted?: boolean }).encrypted
  const attrs = https ? 'SameSite=None; Secure; Partitioned' : 'SameSite=Lax'
  return token
    ? `${COOKIE}=${token}; Path=/; HttpOnly; ${attrs}; Max-Age=${SESSION_DAYS * 86400}`
    : `${COOKIE}=; Path=/; HttpOnly; ${attrs}; Max-Age=0`
}

// ---------- account management ----------
export function updateProfile(userId: number, patch: { name?: unknown; email?: unknown }) {
  if (patch.name !== undefined) {
    const name = String(patch.name).trim().slice(0, 80)
    if (!name) throw new HttpError(400, 'O nome não pode ficar vazio.')
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId)
  }
  if (patch.email !== undefined) {
    const email = String(patch.email).trim().toLowerCase()
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Email inválido.')
    try { db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId) }
    catch { throw new HttpError(409, 'Já existe uma conta com esse email.') }
  }
  return getUser(userId)!
}

export function changePassword(userId: number, current: unknown, next: unknown, keepToken: string) {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string }
  if (!verifyPassword(String(current ?? ''), row.password_hash)) throw new HttpError(400, 'A palavra-passe atual está incorreta.')
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(validatePassword(next)), userId)
  destroyOtherSessions(userId, keepToken) // sign out everywhere else
}

const admins = () => (db.prepare(`SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0`).get() as { n: number }).n

export function adminUpdateUser(actorId: number, id: number, patch: { role?: unknown; disabled?: unknown; password?: unknown }) {
  const u = getUser(id)
  if (!u) throw new HttpError(404, 'Utilizador não encontrado.')
  const demoting = (patch.role === 'user' && u.role === 'admin') || (patch.disabled === true && u.role === 'admin')
  if (demoting && admins() <= 1) throw new HttpError(400, 'Tem de existir pelo menos um administrador ativo.')
  if (id === actorId && patch.disabled === true) throw new HttpError(400, 'Não podes desativar a tua própria conta.')
  if (patch.role === 'admin' || patch.role === 'user') db.prepare('UPDATE users SET role = ? WHERE id = ?').run(patch.role, id)
  if (typeof patch.disabled === 'boolean') {
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(patch.disabled ? 1 : 0, id)
    if (patch.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  }
  if (patch.password !== undefined) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(validatePassword(patch.password)), id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
  }
  return getUser(id)!
}

export function deleteUser(actorId: number, id: number) {
  const u = getUser(id)
  if (!u) throw new HttpError(404, 'Utilizador não encontrado.')
  if (id === actorId) throw new HttpError(400, 'Não podes apagar a tua própria conta aqui.')
  if (u.role === 'admin' && admins() <= 1) throw new HttpError(400, 'Tem de existir pelo menos um administrador ativo.')
  db.prepare('DELETE FROM users WHERE id = ?').run(id) // cascades sessions, conversations, settings, usage, projects rows
}
