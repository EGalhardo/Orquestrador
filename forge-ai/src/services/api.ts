import type { FileNode } from '../types'
import { uid } from '../lib/utils'

export interface KeyStatus { ai: Record<'anthropic' | 'openai' | 'gemini', string>; github: { hint: string; login: string } }
export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama'
export interface PublicConfig { provider: ProviderId; model: string; baseUrl: string; configured: boolean; keyHint: string; defaults?: Record<ProviderId, string>; sandbox?: 'bwrap' | 'docker' | 'local' }

export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status } }

/** Fired when a request comes back 401 (session expired / signed out elsewhere). */
export const UNAUTHORIZED_EVENT = 'forge:unauthorized'

/**
 * Session token kept by the browser and sent as `Authorization: Bearer`.
 * Needed because the app often runs inside a third-party iframe (hosted previews) where
 * browsers block cookies; the HttpOnly cookie remains as a fallback.
 */
const TOKEN_KEY = 'forge-session-token'
// Kept in memory first: some browsers also block localStorage inside third-party iframes,
// and the session must still work for this page load. Storage is only a best-effort cache.
let memToken: string | null = null
export const session = {
  get: () => { if (memToken) return memToken; try { memToken = localStorage.getItem(TOKEN_KEY) } catch { /* storage blocked */ } return memToken },
  set: (t: string) => { memToken = t; try { localStorage.setItem(TOKEN_KEY, t) } catch { /* storage blocked: memory only */ } },
  clear: () => { memToken = null; try { localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ } },
}
// Sent twice on purpose: some reverse proxies strip or overwrite `Authorization` (they use it themselves).
const authHeader = (): Record<string, string> => { const t = session.get(); return t ? { authorization: `Bearer ${t}`, 'x-forge-session': t } : {} }

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init, headers: { 'content-type': 'application/json', ...authHeader(), ...init?.headers } })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError(res.status, data.error ?? `${res.status} ${res.statusText}`)
  }
  return data as T
}

export interface User { id: number; email: string; name: string; role: 'admin' | 'user'; createdAt: number; lastLoginAt: number | null; disabled: boolean; sessions?: number }
export interface AdminUser extends User { projects?: number; conversations?: number; tokens?: number }
export interface AuthStatus { hasUsers: boolean; signupOpen: boolean }
export interface UsageRow { runs: number; input: number; output: number }
export interface UsageSummary { days: number; total: UsageRow; byModel: (UsageRow & { provider: string; model: string })[]; byDay: (UsageRow & { day: string })[] }
/** Server copy of a conversation (extra fields such as `project` are kept). */
export type RemoteConversation = Record<string, unknown> & { id: string; title: string; createdAt: number; updatedAt: number; project?: string | null }

const send = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body) })

interface RawNode { name: string; type: 'file' | 'folder'; size?: number; content?: string; children?: RawNode[] }
const toNode = (n: RawNode): FileNode => ({ id: uid(), name: n.name, type: n.type, size: n.size, content: n.content, children: n.children?.map(toNode) })

/** Thin client for the EGalhardo IA backend (server/). All AI keys stay server-side. */
export const Api = {
  // ---- accounts
  authStatus: () => j<AuthStatus>('/api/auth/status'),
  me: () => j<User>('/api/auth/me'),
  async login(email: string, password: string) {
    const u = await j<User & { token?: string }>('/api/auth/login', send('POST', { email, password }))
    if (u.token) session.set(u.token)
    return u
  },
  async register(name: string, email: string, password: string) {
    const u = await j<User & { token?: string }>('/api/auth/register', send('POST', { name, email, password }))
    if (u.token) session.set(u.token)
    return u
  },
  logout: () => j('/api/auth/logout', send('POST')).finally(() => session.clear()),
  updateMe: (patch: { name?: string; email?: string }) => j<User>('/api/auth/me', send('PATCH', patch)),
  changePassword: (current: string, next: string) => j('/api/auth/password', send('POST', { current, next })),
  closeOtherSessions: () => j<{ closed: number }>('/api/auth/sessions/others', send('DELETE')),
  // ---- conversations (server is the source of truth when signed in)
  listConversations: () => j<RemoteConversation[]>('/api/conversations'),
  saveConversation: (id: string, c: { title: string; project?: string; createdAt: number; data: unknown }) => j(`/api/conversations/${id}`, send('PUT', c)),
  deleteConversation: (id: string) => j(`/api/conversations/${id}`, send('DELETE')),
  usage: (days = 30) => j<UsageSummary>(`/api/usage?days=${days}`),
  // ---- admin
  adminUsers: () => j<AdminUser[]>('/api/admin/users'),
  adminCreateUser: (u: { name: string; email: string; password: string }) => j<User>('/api/admin/users', send('POST', u)),
  adminUpdateUser: (id: number, patch: { role?: 'admin' | 'user'; disabled?: boolean; password?: string }) => j<User>(`/api/admin/users/${id}`, send('PATCH', patch)),
  adminDeleteUser: (id: number) => j(`/api/admin/users/${id}`, send('DELETE')),
  adminSettings: () => j<{ signupOpen: boolean }>('/api/admin/settings'),
  adminSetSettings: (s: { signupOpen: boolean }) => j<{ signupOpen: boolean }>('/api/admin/settings', send('POST', s)),

  getConfig: () => j<PublicConfig>('/api/config'),
  clearKey: () => j<PublicConfig>('/api/config/key', send('DELETE')),
  saveConfig: (c: Partial<{ provider: ProviderId; model: string; apiKey: string; baseUrl: string }>) => j<PublicConfig>('/api/config', { method: 'POST', body: JSON.stringify(c) }),
  listProjects: () => j<string[]>('/api/projects'),
  createProject: (name: string) => j('/api/projects', { method: 'POST', body: JSON.stringify({ name }) }),
  async loadWorkspace(): Promise<FileNode[]> {
    const projects = await Api.listProjects()
    return Promise.all(projects.map(async (p) => ({ id: uid(), name: p, type: 'folder' as const, children: (await j<RawNode[]>(`/api/projects/${p}/tree`)).map(toNode) })))
  },
  // ---- background processes
  listProcesses: (project?: string) => j<ProcInfo[]>(`/api/processes${project ? `?project=${encodeURIComponent(project)}` : ''}`),
  startProcess: (project: string, command: string, name?: string) => j<ProcInfo>('/api/processes', { method: 'POST', body: JSON.stringify({ project, command, name }) }),
  stopProcess: (id: string) => j(`/api/processes/${id}/stop`, { method: 'POST' }),
  restartProcess: (id: string) => j<ProcInfo>(`/api/processes/${id}/restart`, { method: 'POST' }),
  removeProcess: (id: string) => j(`/api/processes/${id}`, { method: 'DELETE' }),
  /** Live log stream; returns an unsubscribe function. */
  streamLogs(id: string, onChunk: (s: string) => void) {
    const t = session.get()
    const es = new EventSource(`/api/processes/${id}/stream${t ? `?access_token=${encodeURIComponent(t)}` : ''}`)
    es.onmessage = (e) => { try { onChunk(JSON.parse(e.data).chunk ?? '') } catch { /* ignore */ } }
    return () => es.close()
  },
  restoreCheckpoint: (project: string, hash: string) => j<{ hash: string; changed: string[] }>('/api/checkpoints/restore', { method: 'POST', body: JSON.stringify({ project, hash }) }),
  stop: (conversationId: string) => j('/api/agent/stop', { method: 'POST', body: JSON.stringify({ conversationId }) }),

  /** POST + read the SSE stream, invoking onEvent for each JSON event. */
  listKeys: () => j<KeyStatus>('/api/keys'),
  setKey: (name: string, value: string) => j<KeyStatus>('/api/keys', send('POST', { name, value })),
  deleteKey: (name: string) => j<KeyStatus>(`/api/keys/${name}`, send('DELETE')),
  async run(body: { conversationId: string; project: string; agent: string; instruction: string; images?: { name: string; dataUrl: string }[] }, onEvent: (e: AgentEvent) => void, signal: AbortSignal) {
    const res = await fetch('/api/agent/run', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', ...authHeader() }, body: JSON.stringify(body), signal })
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
      throw new Error(data.error ?? `Servidor indisponível (${res.status})`)
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
        const line = chunk.split('\n').find((l) => l.startsWith('data: '))
        if (line) onEvent(JSON.parse(line.slice(6)))
      }
    }
  },
}

export type ProcStatus = 'starting' | 'running' | 'exited' | 'error' | 'stopped'
export interface ProcInfo {
  id: string; project: string; name: string; command: string; status: ProcStatus
  port: number | null; previewPort: number | null; exitCode: number | null; startedAt: number; endedAt: number | null
}

/**
 * Public URL of a preview proxy port, as seen by the user's browser.
 * - Cloud sandboxes expose ports as "<port>-<id>.<domain>" (e.g. E2B): swap the port prefix.
 * - Otherwise: same host, different port.
 */
export function previewUrl(previewPort: number, loc: Location = window.location) {
  const m = loc.hostname.match(/^(\d+)-(.+)$/)
  if (m) return `${loc.protocol}//${previewPort}-${m[2]}`
  return `${loc.protocol}//${loc.hostname}:${previewPort}`
}

export type AgentEvent =
  | { type: 'activity'; activity: { id: string; kind: string; label: string; target?: string; status: string; filePath?: string; details?: string }; parentId?: string }
  | { type: 'update'; id: string; patch: Record<string, unknown> }
  | { type: 'file'; path: string; content: string | null; previous: string | null; deleted?: boolean }
  | { type: 'text'; text: string }
  | { type: 'done'; text: string; usage: { input: number; output: number }; steps: number; changed?: string[]; commands?: { command: string; exitCode: number }[] }
  | { type: 'files_changed' }
  | { type: 'processes_changed' }
  | { type: 'error'; message: string }
  | { type: 'plan'; items: { title: string; status: 'pending' | 'in_progress' | 'done' }[] }
  | { type: 'checkpoint'; before: string; after?: string }
