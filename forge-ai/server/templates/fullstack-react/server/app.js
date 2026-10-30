import express from 'express'
import { db } from './db.js'

/** All API routes live under /api. Add new routers here. */
export function createApp() {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))

  app.get('/api/items', (_req, res) => {
    res.json(db.prepare('SELECT id, title, done, created_at AS createdAt FROM items ORDER BY id DESC').all())
  })
  app.post('/api/items', (req, res) => {
    const title = String(req.body?.title ?? '').trim()
    if (!title) return res.status(400).json({ error: 'title is required' })
    const r = db.prepare('INSERT INTO items (title, created_at) VALUES (?, ?)').run(title.slice(0, 200), Date.now())
    res.status(201).json(db.prepare('SELECT id, title, done, created_at AS createdAt FROM items WHERE id = ?').get(r.lastInsertRowid))
  })
  app.patch('/api/items/:id', (req, res) => {
    const r = db.prepare('UPDATE items SET done = ? WHERE id = ?').run(req.body?.done ? 1 : 0, Number(req.params.id))
    if (!r.changes) return res.status(404).json({ error: 'not found' })
    res.json({ ok: true })
  })
  app.delete('/api/items/:id', (req, res) => {
    db.prepare('DELETE FROM items WHERE id = ?').run(Number(req.params.id))
    res.status(204).end()
  })

  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'internal error' }) })
  return app
}
