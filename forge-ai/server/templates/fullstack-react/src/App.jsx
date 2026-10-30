import { useEffect, useState } from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import { api } from './api.js'

function Items() {
  const [items, setItems] = useState([])
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const load = () => api('/items').then(setItems).catch((e) => setError(e.message))
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault()
    try { await api('/items', { method: 'POST', body: { title } }); setTitle(''); load() } catch (err) { setError(err.message) }
  }
  return (
    <section className="space-y-4">
      <form onSubmit={add} className="flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Novo item" className="flex-1 rounded-lg border border-slate-300 px-3 py-2" />
        <button className="rounded-lg bg-slate-900 px-4 py-2 text-white">Adicionar</button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="divide-y rounded-lg border border-slate-200 bg-white">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3 py-2">
            <input type="checkbox" checked={!!i.done} onChange={async () => { await api(`/items/${i.id}`, { method: 'PATCH', body: { done: !i.done } }); load() }} />
            <span className={i.done ? 'text-slate-400 line-through' : ''}>{i.title}</span>
          </li>
        ))}
        {!items.length && <li className="px-3 py-6 text-center text-sm text-slate-500">Sem itens.</li>}
      </ul>
    </section>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <strong>App</strong>
          <NavLink to="/" className={({ isActive }) => (isActive ? 'font-medium' : 'text-slate-500')}>Itens</NavLink>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl p-4">
        <Routes>
          <Route path="/" element={<Items />} />
        </Routes>
      </main>
    </div>
  )
}
