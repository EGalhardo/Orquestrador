import { useState, useEffect } from 'react'
import { api } from '../api.js'
import { Plus, Edit2, Trash2, Tag, Check, X, AlertCircle } from 'lucide-react'

const PRESET_COLORS = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#64748b'  // Slate
]

export default function Categories() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState({})
  
  // Modal / Form state
  const [showModal, setShowModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState('#3b82f6')
  const [submitting, setSubmitting] = useState(false)

  // Delete confirm
  const [deletingId, setDeletingId] = useState(null)
  const [deleteError, setDeleteError] = useState('')

  const loadCategories = async () => {
    setLoading(true)
    try {
      const data = await api('/categories')
      setCategories(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCategories()
  }, [])

  const openCreate = () => {
    setEditingCategory(null)
    setName('')
    setColor(PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)])
    setFormError({})
    setShowModal(true)
  }

  const openEdit = (cat) => {
    setEditingCategory(cat)
    setName(cat.name)
    setColor(cat.color || '#3b82f6')
    setFormError({})
    setShowModal(true)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setFormError({})

    try {
      if (editingCategory) {
        await api(`/categories/${editingCategory.id}`, {
          method: 'PUT',
          body: { name, color }
        })
      } else {
        await api('/categories', {
          method: 'POST',
          body: { name, color }
        })
      }
      setShowModal(false)
      loadCategories()
    } catch (err) {
      if (err.errors) {
        setFormError(err.errors)
      } else {
        setFormError({ general: err.message })
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id) => {
    setDeleteError('')
    try {
      await api(`/categories/${id}`, { method: 'DELETE' })
      setDeletingId(null)
      loadCategories()
    } catch (err) {
      setDeleteError(err.message)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-xs border border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Categorias</h2>
          <p className="text-sm text-slate-500">Organize os seus gastos por grupos personalizados</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-medium px-4 py-2.5 rounded-lg transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          Nova Categoria
        </button>
      </div>

      {deleteError && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{deleteError}</span>
          </div>
          <button onClick={() => setDeleteError('')} className="text-red-500 hover:text-red-700">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-slate-100 animate-pulse rounded-xl" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <Tag className="w-12 h-12 stroke-[1.5] text-slate-400 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-slate-700">Nenhuma categoria criada</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
            Crie categorias como Alimentação, Transporte ou Lazer para classificar as suas despesas.
          </p>
          <button
            onClick={openCreate}
            className="mt-4 inline-flex items-center gap-2 bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Criar Primeira Categoria
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat) => (
            <div
              key={cat.id}
              className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex items-center justify-between hover:border-slate-300 transition-all"
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-5 h-5 rounded-full shrink-0 shadow-xs ring-2 ring-white"
                  style={{ backgroundColor: cat.color }}
                />
                <div>
                  <h4 className="font-semibold text-slate-800 text-sm sm:text-base">{cat.name}</h4>
                  <p className="text-xs text-slate-400">
                    {cat.expense_count || 0} despesa{cat.expense_count !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => openEdit(cat)}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                  title="Editar"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setDeletingId(cat.id)}
                  className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  title="Eliminar"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 space-y-4 shadow-lg border border-slate-200">
            <h3 className="font-bold text-slate-800 text-lg">Eliminar Categoria</h3>
            <p className="text-sm text-slate-600">
              Tem certeza que deseja eliminar esta categoria? As despesas associadas ficarão sem categoria.
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
                Sim, Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form Modal (Create / Edit) */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-lg">
                {editingCategory ? 'Editar Categoria' : 'Nova Categoria'}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="mt-4 space-y-4">
              {formError.general && (
                <div className="p-3 bg-red-50 text-red-700 rounded-lg text-xs font-medium">
                  {formError.general}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Nome da Categoria
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Alimentação, Habitação..."
                  className={`w-full px-3.5 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition-colors ${
                    formError.name ? 'border-red-500 bg-red-50/30' : 'border-slate-300'
                  }`}
                  autoFocus
                />
                {formError.name && (
                  <p className="text-xs text-red-600 mt-1">{formError.name}</p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-2">
                  Cor de Identificação
                </label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-transform ${
                        color === c ? 'scale-110 ring-2 ring-slate-900 ring-offset-2' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                    >
                      {color === c && <Check className="w-4 h-4 text-white drop-shadow-sm" />}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-10 h-8 p-0 border border-slate-300 rounded cursor-pointer"
                  />
                  <span className="text-xs text-slate-500 font-mono">{color}</span>
                </div>
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
                  {submitting ? 'A guardar...' : editingCategory ? 'Guardar Alterações' : 'Criar Categoria'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
