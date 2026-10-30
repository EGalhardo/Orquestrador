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
  `CREATE TABLE categories (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE,
     color TEXT NOT NULL
   );`,
  `CREATE TABLE expenses (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     description TEXT NOT NULL,
     amount REAL NOT NULL,
     date TEXT NOT NULL,
     category_id INTEGER NOT NULL,
     notes TEXT,
     FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
   );`,
]

const version = db.pragma('user_version', { simple: true })
for (let i = version; i < MIGRATIONS.length; i++) {
  db.transaction(() => { db.exec(MIGRATIONS[i]); db.pragma(`user_version = ${i + 1}`) })()
}
