import type { FileNode } from '../types'

export const uid = () => Math.random().toString(36).slice(2, 10)
export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms)
    signal?.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('Aborted', 'AbortError')) })
  })

export function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 ** 2).toFixed(1)} MB`
}
export function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
export function timeAgo(t: number) {
  const d = (Date.now() - t) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)} minutes ago`
  if (d < 86400) return `${Math.floor(d / 3600)} hours ago`
  return `${Math.floor(d / 86400)} days ago`
}
export function period(t: number): 'Today' | 'Yesterday' | 'Older' {
  const start = new Date(); start.setHours(0, 0, 0, 0)
  if (t >= start.getTime()) return 'Today'
  if (t >= start.getTime() - 86400000) return 'Yesterday'
  return 'Older'
}
export const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '')
export function langBadge(name: string) {
  const e = ext(name)
  const map: Record<string, string> = { ts: 'TS', tsx: 'TSX', js: 'JS', jsx: 'JSX', css: 'CSS', html: 'HTML', json: 'JSON', md: 'MD', py: 'PY', sh: 'SH', svg: 'SVG', yml: 'YML', yaml: 'YML' }
  return map[e] ?? (e.toUpperCase() || 'TXT')
}

/* ---------- tree helpers ---------- */
export function walk(nodes: FileNode[], cb: (n: FileNode, path: string) => void, base = '') {
  for (const n of nodes) {
    const p = base ? `${base}/${n.name}` : n.name
    cb(n, p)
    if (n.children) walk(n.children, cb, p)
  }
}
export function stats(node: FileNode) {
  let files = 0, folders = 0, size = 0
  walk([node], (n) => {
    if (n.type === 'file') { files++; size += n.size ?? n.content?.length ?? 0 } else folders++
  })
  return { files, folders: folders - (node.type === 'folder' ? 1 : 0), size }
}
export function findByPath(nodes: FileNode[], path: string): FileNode | undefined {
  let found: FileNode | undefined
  walk(nodes, (n, p) => { if (p === path) found = n })
  return found
}
