/** Tiny fetch wrapper for the backend (/api). Throws object with error/errors on non-2xx. */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body && JSON.stringify(body)
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || 'Erro na requisição')
    err.status = res.status
    err.errors = data.errors || {}
    throw err
  }
  return data
}

/** Formatter helper for Kwanza currency */
export function formatKz(amount) {
  const val = Number(amount) || 0
  return val.toLocaleString('pt-AO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }) + ' Kz'
}
