import { useState, useEffect } from 'react'
import { api, formatKz } from '../api.js'
import { 
  Plus, 
  Search, 
  Filter, 
  ArrowUpDown, 
  Edit2, 
  Trash2, 
  Calendar, 
  Tag, 
  Receipt,
  FileText,
  X,
  AlertCircle
} from 'lucide-react'

export default function Expenses() {
  const [expenses, setExpenses] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [selectedCategory, setSelectedCategory] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState('date_desc')

  // Modal / Form state
  const [showModal, setShowModal] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    date: new Date().toISOString().split('T')[0],
    category_id: '',
    notes: ''
  })
  const [formErrors, setFormErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)

  // Delete confirm state
  const [deletingId, setDeletingId] = useState(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const queryParams = new URLSearchParams()
      if (selectedMonth) queryParams.set('month', selectedMonth)
      if (selectedCategory) queryParams.set('category_id', selectedCategory)
      if (searchQuery.trim()) queryParams.set('search', searchQuery.trim())

      const [expData, catData] = await Promise.all([
        api(`/expenses?${queryParams.toString()}`),
        api('/categories')
      ])

      // Client-side sort
      let sorted = [...expData]
      if (sortBy === 'date_desc') sorted.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      else if (sortBy === 'date_asc') sorted.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)
      else if (sortBy === 'amount_desc') sorted.sort((a, b) => b.amount - a.amount)
      else if (sortBy === 'amount_asc') sorted.sort((a, b) => a.amount - b.amount)
      else if (sortBy === 'desc_asc') sorted.sort((a, b) => a.description.localeCompare(b.description))

      setExpenses(sorted)
      setCategories(catData)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [selectedMonth, selectedCategory, searchQuery, sortBy])

  const openCreateModal = () => {
    setEditingExpense(null)
    setFormData({
      description: '',
      amount: '',
      date: new Date().toISOString().split('T')[0],
      category_id: categories.length > 0 ? categories[0].id : '',
      notes: ''
    })
    setFormErrors({})
    setShowModal(true)
  }

  const openEditModal = (expense) => {
    setEditingExpense(expense)
    setFormData({
      description: expense.description,
      amount: expense.amount,
      date: expense.date,
      category_id: expense.category_id || '',
      notes: expense.notes || ''
    })
    setFormErrors({})
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setFormErrors({})

    const payload = {
      description: formData.description,
      amount: Number(formData.amount),
      date: formData.date,
      category_id: formData.category_id ? Number(formData.category_id) : null,
      notes: formData.notes
    }

    try {
      if (editingExpense) {
        await api(`/expenses/${editingExpense.id}`, {
          method: 'PUT',
          body: payload
        })
      } else {
        await api('/expenses', {
          method: 'POST',
          body: payload
        })
      }
      setShowModal(false)
      loadData()
    } catch (err) {
      if (err.errors) {
        setFormErrors(err.errors)
      } else {
        setFormErrors({ general: err.message })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id) => {
    try {
      await api(`/expenses/${id}`, { method: 'DELETE' })
      setDeletingId(null)
      loadData()
    } catch (err) {
      alert(err.message)
    }
  }

  const totalFiltered = expenses.reduce((acc, curr) => acc + curr.amount, 0)

  return (
    <div className="space-y-6">
      {/* Header action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-xs border border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Despesas</h2>
          <p className="text-sm text-slate-500">Registe e filtre as suas saídas de dinheiro em Kwanza (Kz)</p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium px-4 py-2.5 rounded-lg transition-colors shadow-xs shrink-0"
        >
          <Plus className="w-4 h-4" />
          Nova Despesa
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-white p-4 rounded-xl shadow-xs border border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar descrição ou notas..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Month Selector */}
        <div className="relative">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
          />
        </div>

        {/* Category Filter */}
        <div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-slate-700"
          >
            <option value="">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {/* Sort by */}
        <div className="relative">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white text-slate-700"
          >
            <option value="date_desc">Mais recente primeiro</option>
            <option value="date_asc">Mais antiga primeiro</option>
            <option value="amount_desc">Maior valor primeiro</option>
            <option value="amount_asc">Menor valor primeiro</option>
            <option value="desc_asc">Descrição (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Summary bar for current filters */}
      <div className="flex items-center justify-between px-2 text-sm text-slate-600">
        <span>
          Encontradas <strong className="text-slate-900">{expenses.length}</strong> despesas
        </span>
        <span>
          Total listado: <strong className="text-slate-900 font-bold">{formatKz(totalFiltered)}</strong>
        </span>
      </div>

      {/* Table / List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 bg-slate-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : expenses.length === 0 ? (
          <div className="p-12 text-center">
            <Receipt className="w-12 h-12 stroke-[1.5] text-slate-400 mx-auto mb-3" />
            <h3 className="font-semibold text-slate-700">Nenhuma despesa encontrada</h3>
            <p className="text-sm text-slate-500 mt-1">
              Tente alterar os filtros ou registe uma nova despesa.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-3">Data</th>
                  <th className="px-4 py-3">Descrição & Notas</th>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3 text-right">Valor (Kz)</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {expenses.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/75 transition-colors">
                    <td className="px-4 py-3.5 whitespace-nowrap text-slate-600 text-xs font-medium">
                      {new Date(item.date + 'T00:00:00').toLocaleDateString('pt-AO')}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="font-medium text-slate-900">{item.description}</div>
                      {item.notes && (
                        <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                          <span>{item.notes}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {item.category_name ? (
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                          style={{
                            backgroundColor: `${item.category_color}1a`,
                            color: item.category_color
                          }}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: item.category_color }}
                          />
                          {item.category_name}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Sem categoria</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right font-semibold text-slate-900 whitespace-nowrap">
                      {formatKz(item.amount)}
                    </td>
                    <td className="px-4 py-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEditModal(item)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                          title="Editar"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeletingId(item.id)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 space-y-4 shadow-lg border border-slate-200">
            <h3 className="font-bold text-slate-800 text-lg">Eliminar Despesa</h3>
            <p className="text-sm text-slate-600">
              Tem certeza que pretende remover esta despesa? Esta ação não pode ser desfeita.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(deletingId)}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors shadow-xs"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-lg">
                {editingExpense ? 'Editar Despesa' : 'Nova Despesa'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              {formErrors.general && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-xs font-medium">
                  {formErrors.general}
                </div>
              )}

              {/* Description */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Descrição
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Ex: Compras de supermercado, Gasolina..."
                  className={`w-full px-3.5 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors ${
                    formErrors.description ? 'border-red-500 bg-red-50/30' : 'border-slate-300'
                  }`}
                  autoFocus
                />
                {formErrors.description && (
                  <p className="text-xs text-red-600 mt-1">{formErrors.description}</p>
                )}
              </div>

              {/* Amount and Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Valor (Kz)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
                    className={`w-full px-3.5 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors ${
                      formErrors.amount ? 'border-red-500 bg-red-50/30' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.amount && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.amount}</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Data
                  </label>
                  <input
                    type="date"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                    className={`w-full px-3.5 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors ${
                      formErrors.date ? 'border-red-500 bg-red-50/30' : 'border-slate-300'
                    }`}
                  />
                  {formErrors.date && (
                    <p className="text-xs text-red-600 mt-1">{formErrors.date}</p>
                  )}
                </div>
              </div>

              {/* Category */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Categoria
                </label>
                <select
                  value={formData.category_id}
                  onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                >
                  <option value="">Sem Categoria</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Notas / Observações (opcional)
                </label>
                <textarea
                  rows="2"
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  placeholder="Informações adicionais..."
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors shadow-xs"
                >
                  {submitting ? 'A guardar...' : editingExpense ? 'Guardar Alterações' : 'Adicionar Despesa'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
