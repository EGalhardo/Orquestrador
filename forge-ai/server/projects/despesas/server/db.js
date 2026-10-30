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
  `CREATE TABLE categories (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL UNIQUE,
     color TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE expenses (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     description TEXT NOT NULL,
     amount REAL NOT NULL,
     date TEXT NOT NULL,
     category_id INTEGER NOT NULL,
     notes TEXT,
     created_at INTEGER NOT NULL,
     FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
   );`
]

const version = db.pragma('user_version', { simple: true })
for (let i = version; i < MIGRATIONS.length; i++) {
  db.transaction(() => { db.exec(MIGRATIONS[i]); db.pragma(`user_version = ${i + 1}`) })()
}

// Seed initial data if categories is empty
export function seedDatabase() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM categories').get().count
  if (count > 0) return

  const now = Date.now()
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  
  // Previous month string
  const prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const prevYear = prevMonthDate.getFullYear()
  const prevMonth = String(prevMonthDate.getMonth() + 1).padStart(2, '0')

  const seedCategories = [
    { name: 'Alimentação', color: '#ef4444' }, // Red
    { name: 'Moradia', color: '#3b82f6' },     // Blue
    { name: 'Transporte', color: '#f59e0b' },  // Amber
    { name: 'Lazer', color: '#8b5cf6' },       // Purple
    { name: 'Saúde', color: '#10b981' },       // Emerald
    { name: 'Educação', color: '#06b6d4' },    // Cyan
    { name: 'Outros', color: '#6b7280' },      // Gray
  ]

  const insertCategory = db.prepare('INSERT INTO categories (name, color, created_at) VALUES (?, ?, ?)')
  const categoryIds = {}

  db.transaction(() => {
    for (const cat of seedCategories) {
      const res = insertCategory.run(cat.name, cat.color, now)
      categoryIds[cat.name] = res.lastInsertRowid
    }

    const insertExpense = db.prepare(`
      INSERT INTO expenses (description, amount, date, category_id, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const sampleExpenses = [
      { description: 'Supermercado Kero', amount: 85000, date: `${year}-${month}-03`, category: 'Alimentação', notes: 'Compras mensais para casa' },
      { description: 'Renda do Apartamento', amount: 250000, date: `${year}-${month}-01`, category: 'Moradia', notes: 'Pagamento referente ao mês corrente' },
      { description: 'Combustível Sonangol', amount: 20000, date: `${year}-${month}-05`, category: 'Transporte', notes: 'Atestar o depósito' },
      { description: 'Jantar Restaurante Lookal', amount: 35000, date: `${year}-${month}-08`, category: 'Lazer', notes: 'Jantar de fim de semana com amigos' },
      { description: 'Farmácia Mecofarma', amount: 15500, date: `${year}-${month}-10`, category: 'Saúde', notes: 'Medicamentos e vitaminas' },
      { description: 'Curso Online de Desenvolvimento', amount: 45000, date: `${year}-${month}-12`, category: 'Educação', notes: 'Inscrição no curso avançado' },
      { description: 'Serviço de Internet Zap', amount: 28000, date: `${year}-${month}-02`, category: 'Moradia', notes: 'Mensalidade Fibra 50Mbps' },
      { description: 'Lavadouro de Carros', amount: 5000, date: `${year}-${month}-14`, category: 'Transporte', notes: 'Lavagem completa' },
      { description: 'Cinema & Pipocas Shopping Avennida', amount: 12000, date: `${year}-${month}-15`, category: 'Lazer', notes: 'Sessão da noite' },
      { description: 'Feira Frescos Talatona', amount: 18500, date: `${year}-${month}-18`, category: 'Alimentação', notes: 'Frutas e vegetais' },
      
      // Previous month sample
      { description: 'Supermercado Candando', amount: 92000, date: `${prevYear}-${prevMonth}-04`, category: 'Alimentação', notes: 'Compras do mês anterior' },
      { description: 'Renda do Apartamento', amount: 250000, date: `${prevYear}-${prevMonth}-01`, category: 'Moradia', notes: 'Renda mês passado' },
      { description: 'Consulta Médica Girassol', amount: 30000, date: `${prevYear}-${prevMonth}-15`, category: 'Saúde', notes: 'Check-up de rotina' },
    ]

    for (const exp of sampleExpenses) {
      if (categoryIds[exp.category]) {
        insertExpense.run(exp.description, exp.amount, exp.date, categoryIds[exp.category], exp.notes, now)
      }
    }
  })()
}

// Run seed database automatically on module load
seedDatabase()
