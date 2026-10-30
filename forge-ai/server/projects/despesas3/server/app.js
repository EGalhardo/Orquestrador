import express from 'express'
import { db } from './db.js'

export function createApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  // --- Categories ---
  app.get('/api/categories', (_req, res) => {
    res.json(db.prepare(`
      SELECT c.*, COUNT(e.id) as expense_count 
      FROM categories c 
      LEFT JOIN expenses e ON e.category_id = c.id 
      GROUP BY c.id 
      ORDER BY c.name ASC
    `).all())
  })

  app.post('/api/categories', (req, res) => {
    const { name, color } = req.body
    if (!name?.trim()) return res.status(400).json({ errors: { name: 'Nome é obrigatório' } })
    if (!color?.trim()) return res.status(400).json({ errors: { color: 'Cor é obrigatória' } })
    
    try {
      const r = db.prepare('INSERT INTO categories (name, color) VALUES (?, ?)').run(name.trim(), color.trim())
      res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(r.lastInsertRowid))
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ errors: { name: 'Já existe uma categoria com este nome' } })
      }
      throw err
    }
  })

  app.put('/api/categories/:id', (req, res) => {
    const { name, color } = req.body
    const id = Number(req.params.id)
    if (!name?.trim()) return res.status(400).json({ errors: { name: 'Nome é obrigatório' } })
    if (!color?.trim()) return res.status(400).json({ errors: { color: 'Cor é obrigatória' } })

    try {
      const r = db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(name.trim(), color.trim(), id)
      if (!r.changes) return res.status(404).json({ error: 'Categoria não encontrada' })
      res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(id))
    } catch (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(400).json({ errors: { name: 'Já existe uma categoria com este nome' } })
      }
      throw err
    }
  })

  app.delete('/api/categories/:id', (req, res) => {
    db.prepare('DELETE FROM categories WHERE id = ?').run(Number(req.params.id))
    res.status(204).end()
  })

  // --- Expenses ---
  const validateExpense = (data) => {
    const errors = {}
    if (!data.description?.trim()) errors.description = 'Descrição é obrigatória'
    if (data.amount === undefined || data.amount === null || data.amount <= 0) errors.amount = 'O valor deve ser maior que zero'
    if (!data.date || isNaN(Date.parse(data.date))) errors.date = 'Data inválida'
    if (!data.category_id) {
      errors.category_id = 'Categoria é obrigatória'
    } else {
      const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(data.category_id)
      if (!category) errors.category_id = 'Categoria inexistente'
    }
    return errors
  }

  app.get('/api/expenses', (req, res) => {
    const { month, category_id, categoryId, search, sort } = req.query
    const catId = category_id || categoryId
    let query = `
      SELECT e.*, c.name as category_name, c.color as category_color 
      FROM expenses e 
      LEFT JOIN categories c ON e.category_id = c.id 
      WHERE 1=1
    `
    const params = []

    if (month) {
      query += ' AND e.date LIKE ?'
      params.push(`${month}%`)
    }
    if (catId) {
      query += ' AND e.category_id = ?'
      params.push(catId)
    }
    if (search) {
      query += ' AND (e.description LIKE ? OR e.notes LIKE ?)'
      params.push(`%${search}%`, `%${search}%`)
    }

    if (sort === 'value') {
      query += ' ORDER BY e.amount DESC'
    } else {
      query += ' ORDER BY e.date DESC, e.id DESC'
    }

    res.json(db.prepare(query).all(...params))
  })

  app.post('/api/expenses', (req, res) => {
    const errors = validateExpense(req.body)
    if (Object.keys(errors).length > 0) return res.status(400).json({ errors })

    const { description, amount, date, category_id, notes } = req.body
    const r = db.prepare(`
      INSERT INTO expenses (description, amount, date, category_id, notes) 
      VALUES (?, ?, ?, ?, ?)
    `).run(description.trim(), amount, date, category_id, notes?.trim() || null)

    res.status(201).json(db.prepare(`
      SELECT e.*, c.name as category_name, c.color as category_color 
      FROM expenses e 
      JOIN categories c ON e.category_id = c.id 
      WHERE e.id = ?
    `).get(r.lastInsertRowid))
  })

  app.put('/api/expenses/:id', (req, res) => {
    const errors = validateExpense(req.body)
    if (Object.keys(errors).length > 0) return res.status(400).json({ errors })

    const id = Number(req.params.id)
    const { description, amount, date, category_id, notes } = req.body
    const r = db.prepare(`
      UPDATE expenses 
      SET description = ?, amount = ?, date = ?, category_id = ?, notes = ? 
      WHERE id = ?
    `).run(description.trim(), amount, date, category_id, notes?.trim() || null, id)

    if (!r.changes) return res.status(404).json({ error: 'Despesa não encontrada' })
    res.json(db.prepare(`
      SELECT e.*, c.name as category_name, c.color as category_color 
      FROM expenses e 
      JOIN categories c ON e.category_id = c.id 
      WHERE e.id = ?
    `).get(id))
  })

  app.delete('/api/expenses/:id', (req, res) => {
    db.prepare('DELETE FROM expenses WHERE id = ?').run(Number(req.params.id))
    res.status(204).end()
  })

  // --- Stats ---
  app.get('/api/stats', (req, res) => {
    const month = req.query.month || new Date().toISOString().slice(0, 7)
    
    const countRow = db.prepare('SELECT COUNT(*) as count, SUM(amount) as total FROM expenses WHERE date LIKE ?').get(`${month}%`)
    const totalMonth = countRow?.total || 0
    const expenseCount = countRow?.count || 0
    
    const [year, monthNum] = month.split('-').map(Number)
    const daysInMonth = new Date(year, monthNum, 0).getDate()
    const dailyAverage = totalMonth / daysInMonth

    const byCategory = db.prepare(`
      SELECT c.id, COALESCE(c.name, 'Sem Categoria') as name, COALESCE(c.color, '#94a3b8') as color, COUNT(e.id) as count, SUM(e.amount) as total 
      FROM expenses e 
      LEFT JOIN categories c ON e.category_id = c.id 
      WHERE e.date LIKE ? 
      GROUP BY c.id, c.name, c.color
      ORDER BY total DESC
    `).all(`${month}%`)

    const topExpenses = db.prepare(`
      SELECT e.*, c.name as category_name, c.color as category_color 
      FROM expenses e 
      LEFT JOIN categories c ON e.category_id = c.id 
      WHERE e.date LIKE ? 
      ORDER BY amount DESC 
      LIMIT 5
    `).all(`${month}%`)

    res.json({ totalMonth, expenseCount, daysInMonth, dailyAverage, byCategory, topExpenses })
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))
  app.use((err, _req, res, _next) => { 
    console.error(err)
    res.status(500).json({ error: 'Erro interno do servidor' }) 
  })
  return app
}
