import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import Dashboard from './pages/Dashboard.jsx'
import Expenses from './pages/Expenses.jsx'
import Categories from './pages/Categories.jsx'
import { LayoutDashboard, ReceiptText, Tags } from 'lucide-react'

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      <header className="border-b border-slate-200 bg-white sticky top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center text-white shadow-xs">
              <span className="font-extrabold text-sm tracking-tighter">KZ</span>
            </div>
            <div>
              <h1 className="font-bold text-slate-900 leading-tight">Despesas Kz</h1>
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Gestão Financeira</p>
            </div>
          </div>

          <nav className="flex items-center gap-1 sm:gap-2">
            <NavLink
              to="/painel"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Painel</span>
            </NavLink>

            <NavLink
              to="/despesas"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <ReceiptText className="w-4 h-4" />
              <span>Despesas</span>
            </NavLink>

            <NavLink
              to="/categorias"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`
              }
            >
              <Tags className="w-4 h-4" />
              <span>Categorias</span>
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-6xl w-full p-4 sm:p-6 flex-1">
        <Routes>
          <Route path="/" element={<Navigate to="/painel" replace />} />
          <Route path="/painel" element={<Dashboard />} />
          <Route path="/despesas" element={<Expenses />} />
          <Route path="/categorias" element={<Categories />} />
          <Route path="*" element={<Navigate to="/painel" replace />} />
        </Routes>
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 mt-auto">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center text-xs text-slate-500">
          Despesas Pessoais em Kwanza (Kz) &bull; Gestão Financeira Pessoal
        </div>
      </footer>
    </div>
  )
}
