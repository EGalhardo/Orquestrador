import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const file = process.env.DB_FILE || path.resolve('data/app.db')
fs.mkdirSync(path.dirname(file), { recursive: true })

// Reuse one connection across dev reloads.
export const db = (globalThis.__db ??= new Database(file))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

/** Append new migrations to the end; never edit old ones. */
const MIGRATIONS = [
  `CREATE TABLE items (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     done INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL
   );`,
]

const version = db.pragma('user_version', { simple: true })
for (let i = version; i < MIGRATIONS.length; i++) {
  db.transaction(() => { db.exec(MIGRATIONS[i]); db.pragma(`user_version = ${i + 1}`) })()
}
