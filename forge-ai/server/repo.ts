/** Data access for projects (ownership), conversations, agent histories and usage. */
import fs from 'node:fs'
import path from 'node:path'
import { db } from './db.ts'
import { HttpError } from './auth.ts'
import { PROJECTS_DIR } from './projectFs.ts'

// ---------- projects ----------
export const userProjects = (userId: number) =>
  (db.prepare('SELECT name FROM projects WHERE owner_id = ? ORDER BY name').all(userId) as { name: string }[]).map((r) => r.name)
export const projectOwner = (name: string) =>
  (db.prepare('SELECT owner_id FROM projects WHERE name = ?').get(name) as { owner_id: number } | undefined)?.owner_id
export const ownsProject = (userId: number, name: string) => projectOwner(name) === userId

export function assertProject(userId: number, name: unknown): string {
  const n = String(name ?? '')
  if (!ownsProject(userId, n)) throw new HttpError(404, 'Projeto não encontrado.')
  return n
}

/** Registers a new project for a user. Names are global (one folder per project on disk). */
export function claimNewProject(userId: number, name: string) {
  if (!/^[\w.-]{1,60}$/.test(name) || name.startsWith('.')) throw new HttpError(400, 'Nome inválido. Usa letras, números, "-", "_" ou ".".')
  if (projectOwner(name) !== undefined || fs.existsSync(path.join(PROJECTS_DIR, name))) throw new HttpError(409, 'Já existe um projeto com esse nome.')
  db.prepare('INSERT INTO projects (name, owner_id, created_at) VALUES (?, ?, ?)').run(name, userId, Date.now())
}

/** Folders created before accounts existed (or by hand) are adopted by the given admin. */
export function adoptUnownedProjects(userId: number) {
  if (!fs.existsSync(PROJECTS_DIR)) return 0
  let n = 0
  for (const e of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('_') || e.name.startsWith('.')) continue
    if (projectOwner(e.name) === undefined) { db.prepare('INSERT INTO projects (name, owner_id, created_at) VALUES (?, ?, ?)').run(e.name, userId, Date.now()); n++ }
  }
  return n
}

export function deleteProjectRow(userId: number, name: string) {
  assertProject(userId, name)
  db.prepare('DELETE FROM projects WHERE name = ?').run(name)
}

// ---------- conversations ----------
const CONV_ID = /^[\w-]{1,80}$/
export interface ConversationRow { id: string; project: string | null; title: string; data: string; created_at: number; updated_at: number }

export function listConversations(userId: number, limit = 300) {
  return (db.prepare('SELECT id, project, title, data, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
    .all(userId, limit) as ConversationRow[]).map((r) => ({ ...safeParse(r.data), id: r.id, title: r.title, project: r.project, createdAt: r.created_at, updatedAt: r.updated_at }))
}
function safeParse(s: string) { try { return JSON.parse(s) as Record<string, unknown> } catch { return {} } }

const convOwner = (id: string) => (db.prepare('SELECT user_id FROM conversations WHERE id = ?').get(id) as { user_id: number } | undefined)?.user_id

/** Ensures the conversation exists and belongs to the user (creates it when new). */
export function ensureConversation(userId: number, id: string, project?: string, title = '') {
  if (!CONV_ID.test(id)) throw new HttpError(400, 'Id de conversa inválido.')
  const owner = convOwner(id)
  if (owner === undefined) {
    const now = Date.now()
    db.prepare('INSERT INTO conversations (id, user_id, project, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, userId, project ?? null, title, '{}', now, now)
  } else if (owner !== userId) throw new HttpError(404, 'Conversa não encontrada.')
}

export function upsertConversation(userId: number, id: string, body: { title?: unknown; project?: unknown; data?: unknown; createdAt?: unknown }) {
  ensureConversation(userId, id)
  const data = JSON.stringify(body.data ?? {})
  if (data.length > 4_000_000) throw new HttpError(413, 'Conversa demasiado grande.')
  db.prepare('UPDATE conversations SET title = ?, project = ?, data = ?, updated_at = ?, created_at = COALESCE(?, created_at) WHERE id = ? AND user_id = ?')
    .run(String(body.title ?? '').slice(0, 200), body.project ? String(body.project) : null, data, Date.now(), typeof body.createdAt === 'number' ? body.createdAt : null, id, userId)
}

export function deleteConversation(userId: number, id: string) {
  if (convOwner(id) !== userId) throw new HttpError(404, 'Conversa não encontrada.')
  db.prepare('DELETE FROM conversations WHERE id = ?').run(id) // cascades agent history
}

// ---------- agent histories ----------
export function loadHistory<T>(conversationId: string): T[] {
  const row = db.prepare('SELECT data FROM agent_histories WHERE conversation_id = ?').get(conversationId) as { data: string } | undefined
  if (!row) return []
  try { return JSON.parse(row.data) } catch { return [] }
}
export function saveHistory(conversationId: string, history: unknown[]) {
  db.prepare(`INSERT INTO agent_histories (conversation_id, data, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).run(conversationId, JSON.stringify(history), Date.now())
}
export const clearHistory = (conversationId: string) => db.prepare('DELETE FROM agent_histories WHERE conversation_id = ?').run(conversationId)

/** One-time import of Phase 3 JSON histories (server/.data/histories/*.json) for the first admin. */
export function importLegacyHistories(userId: number, dir: string) {
  if (!fs.existsSync(dir)) return 0
  let n = 0
  for (const f of fs.readdirSync(dir)) {
    const id = f.replace(/\.json$/, '')
    if (!f.endsWith('.json') || !CONV_ID.test(id)) continue
    try {
      if (convOwner(id) === undefined) ensureConversation(userId, id)
      if (convOwner(id) === userId) { saveHistory(id, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); n++ }
      fs.rmSync(path.join(dir, f))
    } catch { /* skip corrupt file */ }
  }
  return n
}

// ---------- usage ----------
export function recordUsage(u: { userId: number; conversationId: string; provider: string; model: string; input: number; output: number; steps: number }) {
  if (!u.input && !u.output) return
  db.prepare('INSERT INTO usage (user_id, conversation_id, provider, model, input_tokens, output_tokens, steps, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(u.userId, u.conversationId, u.provider, u.model, u.input, u.output, u.steps, Date.now())
}

export function usageSummary(userId: number, days = 30) {
  const since = Date.now() - days * 86_400_000
  const total = db.prepare('SELECT COUNT(*) runs, COALESCE(SUM(input_tokens),0) input, COALESCE(SUM(output_tokens),0) output FROM usage WHERE user_id = ? AND at >= ?').get(userId, since)
  const byModel = db.prepare('SELECT provider, model, COUNT(*) runs, SUM(input_tokens) input, SUM(output_tokens) output FROM usage WHERE user_id = ? AND at >= ? GROUP BY provider, model ORDER BY input DESC').all(userId, since)
  const byDay = db.prepare(`SELECT date(at/1000, 'unixepoch') day, SUM(input_tokens) input, SUM(output_tokens) output, COUNT(*) runs FROM usage WHERE user_id = ? AND at >= ? GROUP BY day ORDER BY day`).all(userId, since)
  return { days, total, byModel, byDay }
}

export function adminStats() {
  return db.prepare(`SELECT u.id, (SELECT COUNT(*) FROM projects p WHERE p.owner_id = u.id) projects,
    (SELECT COUNT(*) FROM conversations c WHERE c.user_id = u.id) conversations,
    (SELECT COALESCE(SUM(input_tokens + output_tokens),0) FROM usage x WHERE x.user_id = u.id) tokens FROM users u`).all() as { id: number; projects: number; conversations: number; tokens: number }[]
}

// ---------- agent plan (per conversation) ----------
export interface PlanItem { title: string; status: 'pending' | 'in_progress' | 'done' }
export function loadPlan(conversationId: string): PlanItem[] {
  const r = db.prepare('SELECT plan FROM agent_histories WHERE conversation_id = ?').get(conversationId) as { plan: string } | undefined
  try { return r ? JSON.parse(r.plan) : [] } catch { return [] }
}
export function savePlan(conversationId: string, plan: PlanItem[]) {
  db.prepare(`INSERT INTO agent_histories (conversation_id, data, updated_at, plan) VALUES (?, '[]', ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET plan = excluded.plan, updated_at = excluded.updated_at`).run(conversationId, Date.now(), JSON.stringify(plan))
}
