/**
 * AI provider configuration, stored per user in SQLite (API keys encrypted with AES-256-GCM).
 * Env vars (FORGE_PROVIDER, FORGE_API_KEY, …) act as defaults for users without settings.
 */
import fs from 'node:fs'
import path from 'node:path'
import { db, encrypt, decrypt } from './db.ts'

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama'
export interface Config { provider: ProviderId; model: string; apiKey: string; baseUrl?: string }
const PROVIDERS: ProviderId[] = ['anthropic', 'openai', 'gemini', 'ollama']

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-4.1',
  gemini: 'gemini-flash-latest',
  ollama: 'qwen2.5-coder:7b',
}
export const BASE_URLS: Record<Exclude<ProviderId, 'anthropic'>, string> = {
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  ollama: 'http://localhost:11434/v1',
}

/** AI keys per provider + integration secrets (github token, github_login). Encrypted together. */
type Keys = Partial<Record<ProviderId | 'github' | 'github_login', string>>
interface Stored { provider: ProviderId; model: string; baseUrl: string; keys: Keys }

function fromEnv(): Stored {
  const provider = PROVIDERS.includes(process.env.FORGE_PROVIDER as ProviderId) ? (process.env.FORGE_PROVIDER as ProviderId) : 'anthropic'
  const key = process.env.FORGE_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || ''
  return { provider, model: process.env.FORGE_MODEL || DEFAULT_MODELS[provider], baseUrl: process.env.FORGE_BASE_URL || '', keys: key ? { [provider]: key } : {} }
}

function load(userId: number): Stored {
  const row = db.prepare('SELECT provider, model, base_url, keys_enc FROM user_settings WHERE user_id = ?').get(userId) as
    { provider: ProviderId; model: string; base_url: string; keys_enc: string } | undefined
  if (!row) return fromEnv()
  let keys: Keys = {}
  try { keys = row.keys_enc ? JSON.parse(decrypt(row.keys_enc)) : {} } catch { /* secret rotated: keys unreadable */ }
  return { provider: row.provider, model: row.model, baseUrl: row.base_url, keys }
}
function save(userId: number, s: Stored) {
  db.prepare(`INSERT INTO user_settings (user_id, provider, model, base_url, keys_enc) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET provider = excluded.provider, model = excluded.model, base_url = excluded.base_url, keys_enc = excluded.keys_enc`)
    .run(userId, s.provider, s.model, s.baseUrl, encrypt(JSON.stringify(s.keys)))
}
const toConfig = (s: Stored): Config => ({ provider: s.provider, model: s.model, baseUrl: s.baseUrl, apiKey: s.keys[s.provider] ?? '' })

export const getConfig = (userId: number) => toConfig(load(userId))
export const isConfigured = (c: Config) => c.provider === 'ollama' || c.apiKey.length > 0

/** Keys are stored per provider so switching providers never sends one vendor's key to another. */
export function setConfig(userId: number, patch: Partial<Config>) {
  const cur = load(userId)
  const provider = patch.provider && PROVIDERS.includes(patch.provider) ? patch.provider : cur.provider
  const switched = provider !== cur.provider
  const next: Stored = {
    provider,
    keys: patch.apiKey ? { ...cur.keys, [provider]: patch.apiKey } : cur.keys,
    // A custom base URL belongs to the previous provider — reset it on switch unless given.
    baseUrl: patch.baseUrl !== undefined ? patch.baseUrl : switched ? '' : cur.baseUrl,
    model: patch.model || (switched ? DEFAULT_MODELS[provider] : cur.model),
  }
  save(userId, next)
  return toConfig(next)
}
export function clearKey(userId: number, provider: ProviderId) {
  const cur = load(userId); delete cur.keys[provider]; save(userId, cur); return toConfig(cur)
}

export type SecretName = Exclude<ProviderId, 'ollama'> | 'github'
export const SECRET_NAMES: SecretName[] = ['anthropic', 'openai', 'gemini', 'github']
const hint = (v?: string) => (v ? `••••${v.slice(-4)}` : '')

/** Status of every stored secret, without revealing values. */
export function listSecrets(userId: number) {
  const k = load(userId).keys
  return {
    ai: { anthropic: hint(k.anthropic), openai: hint(k.openai), gemini: hint(k.gemini) },
    github: { hint: hint(k.github), login: k.github ? (k.github_login ?? '') : '' },
  }
}
/** Store one secret independently of the active provider. */
export function setSecret(userId: number, name: SecretName, value: string, extra: Partial<Keys> = {}) {
  const cur = load(userId)
  cur.keys = { ...cur.keys, [name]: value, ...extra }
  save(userId, cur)
}
export function deleteSecret(userId: number, name: SecretName) {
  const cur = load(userId)
  delete cur.keys[name]
  if (name === 'github') delete cur.keys.github_login
  save(userId, cur)
}
export const getGithub = (userId: number) => { const k = load(userId).keys; return { token: k.github ?? '', login: k.github_login ?? '' } }

/** Never expose the key to the browser. */
export const publicConfig = (c: Config) => ({
  provider: c.provider, model: c.model, baseUrl: c.baseUrl ?? '', configured: isConfigured(c),
  keyHint: c.apiKey ? `••••${c.apiKey.slice(-4)}` : '',
})

/** One-time import of the pre-accounts config file (Phases 1–3) into the first admin. */
export function importLegacyConfig(userId: number) {
  const file = path.resolve(import.meta.dirname, '.forge-config.json')
  if (!fs.existsSync(file)) return false
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'))
    const keys: Keys = old.keys ?? (old.apiKey ? { [old.provider]: old.apiKey } : {})
    save(userId, { provider: old.provider ?? 'anthropic', model: old.model ?? DEFAULT_MODELS[old.provider as ProviderId ?? 'anthropic'], baseUrl: old.baseUrl ?? '', keys })
    fs.rmSync(file) // plaintext keys no longer needed on disk
    return true
  } catch { return false }
}
