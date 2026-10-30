/** Tiny fetch wrapper for the backend (/api). Throws Error(message) on non-2xx. */
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) })
  if (res.status === 204) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
