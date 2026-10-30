import { useState } from 'react'
import { ChevronRight, Folder, FolderOpen, FileCode2, FileText, FileJson, Image } from 'lucide-react'
import type { FileNode } from '../../types'
import { useStore } from '../../store/useStore'
import { cn, ext, fmtBytes, stats } from '../../lib/utils'

function FileIcon({ name }: { name: string }) {
  const e = ext(name)
  if (e === 'json') return <FileJson size={15} className="text-yellow-500/80" />
  if (['png', 'jpg', 'svg'].includes(e)) return <Image size={15} className="text-purple-400/80" />
  if (['md', 'txt'].includes(e)) return <FileText size={15} className="text-mute" />
  return <FileCode2 size={15} className="text-sky-400/80" />
}

function Node({ n, path, depth }: { n: FileNode; path: string; depth: number }) {
  const [open, setOpen] = useState(false)
  const { openFileView, selectedPath } = useStore()
  const isTop = depth === 0
  if (n.type === 'file') {
    return (
      <button
        onClick={() => openFileView(path)}
        style={{ paddingLeft: 12 + depth * 14 }}
        className={cn('flex w-full items-center gap-2 rounded-md py-1 pr-2 text-left text-[13.5px] hover:bg-card2', selectedPath === path && 'bg-card2 text-fg')}
      >
        <FileIcon name={n.name} /><span className="truncate">{n.name}</span>
        {n.previous !== undefined && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Modified by agent" />}
      </button>
    )
  }
  const st = isTop ? stats(n) : null
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        style={{ paddingLeft: (isTop ? 8 : 12) + depth * 14 }}
        className={cn('flex w-full items-center gap-2 rounded-md pr-2 text-left hover:bg-card2', isTop ? 'py-2 text-[16px]' : 'py-1 text-[13.5px]')}
      >
        <ChevronRight size={isTop ? 16 : 13} className={cn('shrink-0 text-mute transition-transform', open && 'rotate-90')} />
        {open ? <FolderOpen size={isTop ? 19 : 15} className="shrink-0" /> : <Folder size={isTop ? 19 : 15} className="shrink-0" />}
        <span className="truncate">{n.name}</span>
        {st && <span className="ml-auto shrink-0 whitespace-nowrap text-[12.5px] text-dim">{st.files} files · {fmtBytes(st.size)}</span>}
      </button>
      {open && (
        <div className="fade-in">
          {n.children?.length ? [...n.children].sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'folder' ? -1 : 1))
            .map((c) => <Node key={c.id} n={c} path={`${path}/${c.name}`} depth={depth + 1} />)
            : <div style={{ paddingLeft: 28 + depth * 14 }} className="py-1 text-xs text-dim">Empty folder</div>}
        </div>
      )}
    </div>
  )
}

export function FileExplorer({ root }: { root: FileNode[] }) {
  const [hidden, setHidden] = useState(false)
  if (!root.length) return <p className="px-3 py-4 text-sm text-dim">No files in this workspace.</p>
  return (
    <div role="tree" className="space-y-0.5">
      {root.map((n) => <Node key={n.id} n={n} path={n.name} depth={0} />)}
      <button onClick={() => setHidden(!hidden)} className="flex items-center gap-2 px-2 py-2 text-[14px] text-dim hover:text-mute">
        <ChevronRight size={13} className={cn('transition-transform', hidden && 'rotate-90')} /> Hidden files
      </button>
      {hidden && <div className="pl-8 font-mono text-xs text-dim">.git/ · .env.example · node_modules/ (excluded)</div>}
    </div>
  )
}
