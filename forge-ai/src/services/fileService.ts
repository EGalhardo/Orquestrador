import type { FileNode } from '../types'
import { uid } from '../lib/utils'

/** Immutable file-tree operations. Swap for a real FS/API adapter later. */
export const FileService = {
  write(root: FileNode[], path: string, content: string): FileNode[] {
    const parts = path.split('/')
    const rec = (nodes: FileNode[], i: number): FileNode[] => {
      const name = parts[i]
      const last = i === parts.length - 1
      const existing = nodes.find((n) => n.name === name)
      if (last) {
        if (existing) return nodes.map((n) => (n === existing ? { ...n, previous: n.content, content, size: content.length } : n))
        return [...nodes, { id: uid(), name, type: 'file', content, previous: '', size: content.length }]
      }
      if (existing) return nodes.map((n) => (n === existing ? { ...n, children: rec(n.children ?? [], i + 1) } : n))
      return [...nodes, { id: uid(), name, type: 'folder', children: rec([], i + 1) }]
    }
    return rec(root, 0)
  },
  /** Set the "previous" (pre-change) content of a file so the UI can show a diff. */
  setPrevious(root: FileNode[], path: string, previous: string): FileNode[] {
    const parts = path.split('/')
    const rec = (nodes: FileNode[], i: number): FileNode[] =>
      nodes.map((n) => (n.name !== parts[i] ? n : i === parts.length - 1 ? { ...n, previous } : { ...n, children: rec(n.children ?? [], i + 1) }))
    return rec(root, 0)
  },
  remove(root: FileNode[], path: string): FileNode[] {
    const parts = path.split('/')
    const rec = (nodes: FileNode[], i: number): FileNode[] =>
      i === parts.length - 1
        ? nodes.filter((n) => n.name !== parts[i])
        : nodes.map((n) => (n.name === parts[i] ? { ...n, children: rec(n.children ?? [], i + 1) } : n))
    return rec(root, 0)
  },
}
