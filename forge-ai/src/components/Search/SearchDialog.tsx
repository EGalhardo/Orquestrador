import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, MessageSquare, FileCode2, SquareTerminal, Activity as ActIcon } from 'lucide-react'
import { useStore } from '../../store/useStore'
import type { Activity } from '../../types'
import { cn, walk } from '../../lib/utils'

type Result = { group: 'Conversations' | 'Files' | 'Commands' | 'Activities'; label: string; sub?: string; run: () => void }
const ICON = { Conversations: MessageSquare, Files: FileCode2, Commands: SquareTerminal, Activities: ActIcon }

export function SearchDialog() {
  const { searchOpen, setSearch, conversations, workspaces, selectChat, openFileView } = useStore()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { if (searchOpen) { setQ(''); setIdx(0); setTimeout(() => input.current?.focus(), 0) } }, [searchOpen])

  const results = useMemo<Result[]>(() => {
    const t = q.trim().toLowerCase()
    const out: Result[] = []
    const close = () => setSearch(false)
    for (const c of conversations) {
      if (!t || c.title.toLowerCase().includes(t) || c.messages.some((m) => m.content.toLowerCase().includes(t)))
        out.push({ group: 'Conversations', label: c.title, run: () => { selectChat(c.id); close() } })
      const flat: Activity[] = []
      c.messages.forEach((m) => m.activities?.forEach((a) => { flat.push(a); a.children?.forEach((x) => flat.push(x)) }))
      for (const a of flat) {
        if (!t) continue
        const hay = `${a.label} ${a.target ?? ''} ${a.details ?? ''}`.toLowerCase()
        if (!hay.includes(t)) continue
        const isCmd = a.kind === 'bash' || a.kind === 'command'
        out.push({ group: isCmd ? 'Commands' : 'Activities', label: isCmd ? (a.target ?? a.label) : `${a.label} ${a.target ?? ''}`, sub: c.title, run: () => { selectChat(c.id); close() } })
      }
    }
    if (t) walk(workspaces[0].root, (n, p) => {
      if (n.type === 'file' && (p.toLowerCase().includes(t) || n.content?.toLowerCase().includes(t)))
        out.push({ group: 'Files', label: n.name, sub: p, run: () => { openFileView(p); close() } })
    })
    const order = ['Conversations', 'Files', 'Commands', 'Activities']
    return out.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group)).slice(0, 60)
  }, [q, conversations, workspaces, selectChat, openFileView, setSearch])

  if (!searchOpen) return null
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, results.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') results[idx]?.run()
    if (e.key === 'Escape') setSearch(false)
  }
  let lastGroup = ''
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/60 p-4 pt-[12vh]" onMouseDown={() => setSearch(false)}>
      <div role="dialog" aria-label="Search" onMouseDown={(e) => e.stopPropagation()} className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl fade-in">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-mute" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setIdx(0) }} onKeyDown={onKey}
            placeholder="Search conversations, files, commands…" className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-dim" />
          <kbd className="rounded border border-line px-1.5 font-mono text-[10px] text-dim">ESC</kbd>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {results.length === 0 && <p className="p-6 text-center text-sm text-dim">No results for “{q}”.</p>}
          {results.map((r, i) => {
            const head = r.group !== lastGroup ? (lastGroup = r.group) : null
            const Icon = ICON[r.group]
            return (
              <div key={i}>
                {head && <div className="px-3 pt-3 pb-1 text-[11px] uppercase tracking-wider text-dim">{head}</div>}
                <button onMouseEnter={() => setIdx(i)} onClick={r.run} className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === idx && 'bg-card2')}>
                  <Icon size={15} className="shrink-0 text-mute" />
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm">{r.label}</span>{r.sub && <span className="block truncate font-mono text-[11px] text-dim">{r.sub}</span>}</span>
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
