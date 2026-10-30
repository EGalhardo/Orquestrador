/**
 * SQLite persistence (better-sqlite3, synchronous, WAL).
 * Location: $FORGE_DATA_DIR (default server/.data)/forge.db
 */
import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const DATA_DIR = path.resolve(process.env.FORGE_DATA_DIR || path.join(import.meta.dirname, '.data'))
fs.mkdirSync(DATA_DIR, { recursive: true })

export const db = new Database(path.join(DATA_DIR, 'forge.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 3000')

/** Ordered migrations; PRAGMA user_version tracks which ones ran. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin','user')),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_login_at INTEGER
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT,
    ip TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE projects (
    name TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project TEXT,
    title TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX conversations_user ON conversations(user_id, updated_at DESC);
  CREATE TABLE agent_histories (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE user_settings (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    base_url TEXT NOT NULL DEFAULT '',
    keys_enc TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE usage (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id TEXT,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    steps INTEGER NOT NULL DEFAULT 0,
    at INTEGER NOT NULL
  );
  CREATE INDEX usage_user ON usage(user_id, at);
  CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  `ALTER TABLE agent_histories ADD COLUMN plan TEXT NOT NULL DEFAULT '[]';`,
]

function migrate() {
  const v = db.pragma('user_version', { simple: true }) as number
  for (let i = v; i < MIGRATIONS.length; i++) {
    db.transaction(() => { db.exec(MIGRATIONS[i]); db.pragma(`user_version = ${i + 1}`) })()
  }
}
migrate()

// ---------- secrets (API keys encrypted at rest, AES-256-GCM) ----------
function loadSecret(): Buffer {
  if (process.env.FORGE_SECRET) return crypto.createHash('sha256').update(process.env.FORGE_SECRET).digest()
  const file = path.join(DATA_DIR, 'secret.key')
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 })
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64')
}
const SECRET = loadSecret()

export function encrypt(plain: string) {
  if (!plain) return ''
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', SECRET, iv)
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':')
}
export function decrypt(blob: string) {
  if (!blob) return ''
  const [v, iv, tag, enc] = blob.split(':')
  if (v !== 'v1') throw new Error('Unknown secret format')
  const d = crypto.createDecipheriv('aes-256-gcm', SECRET, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8')
}

// ---------- app settings ----------
export const getSetting = (key: string, fallback: string) =>
  (db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? fallback
export const setSetting = (key: string, value: string) =>
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
