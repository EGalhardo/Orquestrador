import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
process.env.DB_FILE = ':memory:'
const { createApp } = await import('./app.js')

async function call(app, method, url, body) {
  const server = app.listen(0)
  const { port } = server.address()
  try {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { 
      method, 
      headers: { 'content-type': 'application/json' }, 
      body: body && JSON.stringify(body) 
    })
    const data = res.status === 204 ? null : await res.json()
    return { status: res.status, data }
  } finally { server.close() }
}

describe('API Tests', async () => {
  const app = createApp()

  let catId;

  test('Categories CRUD', async () => {
    // List empty
    const list1 = await call(app, 'GET', '/api/categories')
    assert.equal(list1.status, 200)
    assert.equal(list1.data.length, 0)

    // Create invalid
    const fail1 = await call(app, 'POST', '/api/categories', { name: '' })
    assert.equal(fail1.status, 400)
    assert.ok(fail1.data.errors.name)

    // Create valid
    const created = await call(app, 'POST', '/api/categories', { name: 'Alimentação', color: '#ff0000' })
    assert.equal(created.status, 201)
    assert.equal(created.data.name, 'Alimentação')
    catId = created.data.id

    // Update
    const updated = await call(app, 'PUT', `/api/categories/${catId}`, { name: 'Comida', color: '#00ff00' })
    assert.equal(updated.status, 200)
    assert.equal(updated.data.name, 'Comida')

    // List
    const list2 = await call(app, 'GET', '/api/categories')
    assert.equal(list2.data.length, 1)
    assert.equal(list2.data[0].name, 'Comida')
  })

  test('Expenses CRUD', async () => {
    // List empty
    const list1 = await call(app, 'GET', '/api/expenses')
    assert.equal(list1.status, 200)
    assert.equal(list1.data.length, 0)

    // Create invalid
    const fail1 = await call(app, 'POST', '/api/expenses', { description: '' })
    assert.equal(fail1.status, 400)
    assert.ok(fail1.data.errors.description)

    // Create valid
    const created = await call(app, 'POST', '/api/expenses', {
      description: 'Almoço',
      amount: 2500,
      date: '2023-10-27',
      category_id: catId,
      notes: 'No restaurante X'
    })
    assert.equal(created.status, 201)
    assert.equal(created.data.description, 'Almoço')
    const expId = created.data.id

    // Update
    const updated = await call(app, 'PUT', `/api/expenses/${expId}`, {
      description: 'Jantar',
      amount: 3000,
      date: '2023-10-27',
      category_id: catId,
      notes: 'No restaurante Y'
    })
    assert.equal(updated.status, 200)
    assert.equal(updated.data.description, 'Jantar')

    // List
    const list2 = await call(app, 'GET', '/api/expenses')
    assert.equal(list2.data.length, 1)
    assert.equal(list2.data[0].description, 'Jantar')

    // Delete
    const deleted = await call(app, 'DELETE', `/api/expenses/${expId}`)
    assert.equal(deleted.status, 204)

    const list3 = await call(app, 'GET', '/api/expenses')
    assert.equal(list3.data.length, 0)
  })

  test('Stats API', async () => {
    // Setup some data
    const c1 = await call(app, 'POST', '/api/categories', { name: 'Cat1', color: '#1' })
    const c2 = await call(app, 'POST', '/api/categories', { name: 'Cat2', color: '#2' })
    
    const month = '2023-11'
    await call(app, 'POST', '/api/expenses', { description: 'E1', amount: 1000, date: `${month}-01`, category_id: c1.data.id })
    await call(app, 'POST', '/api/expenses', { description: 'E2', amount: 2000, date: `${month}-02`, category_id: c2.data.id })
    await call(app, 'POST', '/api/expenses', { description: 'E3', amount: 3000, date: `${month}-03`, category_id: c1.data.id })

    const stats = await call(app, 'GET', `/api/stats?month=${month}`)
    assert.equal(stats.status, 200)
    assert.equal(stats.data.totalMonth, 6000)
    assert.equal(stats.data.byCategory.length, 2)
    assert.equal(stats.data.topExpenses.length, 3)
    assert.equal(stats.data.topExpenses[0].amount, 3000)
  })
})
