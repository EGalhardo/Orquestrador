import { useState, useEffect } from 'react'
import { api, formatKz } from '../api.js'
import { 
  TrendingUp, 
  Calendar, 
  Wallet, 
  PieChart, 
  ArrowUpRight, 
  ChevronLeft, 
  ChevronRight,
  Receipt
} from 'lucide-react'

export default function Dashboard() {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadStats = async (month) => {
    setLoading(true)
    setError('')
    try {
      const data = await api(`/stats?month=${month}`)
      setStats(data)
    } catch (err) {
      setError(err.message || 'Erro ao carregar resumo.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStats(currentMonth)
  }, [currentMonth])

  const handlePrevMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const handleNextMonth = () => {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m, 1)
    setCurrentMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const monthLabel = () => {
    const [y, m] = currentMonth.split('-').map(Number)
    const d = new Date(y, m - 1, 1)
    return d.toLocaleDateString('pt-AO', { month: 'long', year: 'numeric' })
  }

  const total = stats?.totalMonth || 0
  const dailyAvg = stats?.dailyAverage || 0

  return (
    <div className="space-y-6">
      {/* Month Navigator Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-xs border border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Painel Financeiro</h2>
          <p className="text-sm text-slate-500">Visão geral das suas despesas e médias mensais</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-1">
          <button 
            onClick={handlePrevMonth}
            className="p-1.5 hover:bg-white rounded-md text-slate-600 hover:text-slate-900 transition-colors shadow-xs"
            title="Mês anterior"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-medium text-slate-800 px-3 min-w-[140px] text-center capitalize">
            {monthLabel()}
          </span>
          <button 
            onClick={handleNextMonth}
            className="p-1.5 hover:bg-white rounded-md text-slate-600 hover:text-slate-900 transition-colors shadow-xs"
            title="Próximo mês"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="h-32 bg-slate-100 animate-pulse rounded-xl" />
          <div className="h-32 bg-slate-100 animate-pulse rounded-xl" />
        </div>
      ) : (
        <>
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl p-5 text-white shadow-sm flex items-center justify-between">
              <div>
                <p className="text-emerald-100 text-sm font-medium">Total de Despesas no Mês</p>
                <h3 className="text-2xl sm:text-3xl font-bold mt-1 tracking-tight">
                  {formatKz(total)}
                </h3>
                <p className="text-xs text-emerald-100/80 mt-2">
                  {stats?.expenseCount || 0} lançamentos registados
                </p>
              </div>
              <div className="p-3 bg-white/10 rounded-xl backdrop-blur-xs">
                <Wallet className="w-8 h-8 text-white" />
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl p-5 text-white shadow-sm flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium">Média Diária Gasta</p>
                <h3 className="text-2xl sm:text-3xl font-bold mt-1 tracking-tight">
                  {formatKz(dailyAvg)}
                </h3>
                <p className="text-xs text-blue-100/80 mt-2">
                  Considerando {stats?.daysInMonth || 30} dias no mês
                </p>
              </div>
              <div className="p-3 bg-white/10 rounded-xl backdrop-blur-xs">
                <TrendingUp className="w-8 h-8 text-white" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* By Category Breakdown with Progress Bars */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col">
              <div className="flex items-center gap-2 mb-4">
                <PieChart className="w-5 h-5 text-slate-700" />
                <h3 className="font-semibold text-slate-800">Gastos por Categoria</h3>
              </div>

              {(!stats?.byCategory || stats.byCategory.length === 0) ? (
                <div className="flex-1 flex flex-col items-center justify-center py-10 text-slate-400">
                  <Receipt className="w-12 h-12 stroke-[1.5] mb-2 opacity-50" />
                  <p className="text-sm">Nenhuma despesa neste mês.</p>
                </div>
              ) : (
                <div className="space-y-4 flex-1">
                  {stats.byCategory.map((cat, idx) => {
                    const pct = total > 0 ? ((cat.total / total) * 100).toFixed(1) : 0
                    return (
                      <div key={cat.id ?? `uncat-${idx}`} className="space-y-1.5">
                        <div className="flex justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span 
                              className="w-3.5 h-3.5 rounded-full inline-block shrink-0 shadow-xs" 
                              style={{ backgroundColor: cat.color || '#94a3b8' }}
                            />
                            <span className="font-medium text-slate-700">{cat.name}</span>
                            <span className="text-xs text-slate-400">({cat.count}x)</span>
                          </div>
                          <div className="text-right">
                            <span className="font-semibold text-slate-900">{formatKz(cat.total)}</span>
                            <span className="text-xs text-slate-500 ml-1.5 font-normal">({pct}%)</span>
                          </div>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                          <div 
                            className="h-full rounded-full transition-all duration-500"
                            style={{ 
                              width: `${pct}%`,
                              backgroundColor: cat.color || '#94a3b8'
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Top 5 Expenses of the Month */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="w-5 h-5 text-slate-700" />
                  <h3 className="font-semibold text-slate-800">Top 5 Maiores Despesas</h3>
                </div>
                <span className="text-xs text-slate-400 uppercase font-bold tracking-wider">Mês atual</span>
              </div>

              {(!stats?.topExpenses || stats.topExpenses.length === 0) ? (
                <div className="flex-1 flex flex-col items-center justify-center py-10 text-slate-400">
                  <Receipt className="w-12 h-12 stroke-[1.5] mb-2 opacity-50" />
                  <p className="text-sm">Sem despesas registradas.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 flex-1">
                  {stats.topExpenses.map((exp, idx) => (
                    <div key={exp.id} className="py-3 flex items-center justify-between first:pt-0 last:pb-0">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-semibold">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{exp.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {exp.category_name && (
                              <span 
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium"
                                style={{
                                  backgroundColor: `${exp.category_color}18`,
                                  color: exp.category_color
                                }}
                              >
                                {exp.category_name}
                              </span>
                            )}
                            <span className="text-xs text-slate-400">
                              {new Date(exp.date + 'T00:00:00').toLocaleDateString('pt-AO')}
                            </span>
                          </div>
                        </div>
                      </div>
                      <span className="font-bold text-slate-900 text-sm sm:text-base">
                        {formatKz(exp.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
