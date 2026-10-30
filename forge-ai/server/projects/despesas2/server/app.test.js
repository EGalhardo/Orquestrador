import { test } from 'node:test'
import assert from 'node:assert/strict'
process.env.DB_FILE = ':memory:'
const { createApp } = await import('./app.js')

async function call(app, method, url, body) {
  const server = app.listen(0)
  const { port } = server.address()
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    return { status: res.status, data: res.status === 204 ? null : await res.json() }
  } finally { server.close() }
}

test('items CRUD', async () => {
  const app = createApp()
  assert.equal((await call(app, 'POST', '/api/items', { title: '' })).status, 400)
  const created = await call(app, 'POST', '/api/items', { title: 'Primeiro' })
  assert.equal(created.status, 201)
  assert.equal((await call(app, 'GET', '/api/items')).data[0].title, 'Primeiro')
  assert.equal((await call(app, 'PATCH', `/api/items/${created.data.id}`, { done: true })).status, 200)
  assert.equal((await call(app, 'DELETE', `/api/items/${created.data.id}`)).status, 204)
})
