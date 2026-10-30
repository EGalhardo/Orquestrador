import { useState } from 'react'
import { Brain, ChevronRight, FileSearch, FilePlus2, FilePen, FileX2, SquareTerminal, Terminal, Package, Search, FlaskConical, Hammer, CheckCircle2, XCircle, Check, X, AlertTriangle, Loader2 } from 'lucide-react'
import type { Activity, ActivityKind, Status } from '../../types'
import { cn, fmtMs } from '../../lib/utils'
import { FileCard } from './FileCard'
import { PreviewCard } from './PreviewCard'

const ICONS: Record<ActivityKind, typeof Brain> = {
  thinking: Brain, read: FileSearch, create: FilePlus2, edit: FilePen, delete: FileX2, command: Terminal, bash: SquareTerminal,
  install: Package, search: Search, test: FlaskConical, build: Hammer, completed: CheckCircle2, error: XCircle,
}

export function StatusIcon({ status }: { status: Status }) {
  if (status === 'loading') return <Loader2 size={14} className="animate-spin text-accent" aria-label="Running" />
  if (status === 'success') return <Check size={15} className="text-green-500" aria-label="Success" />
  if (status === 'warning') return <AlertTriangle size={14} className="text-yellow-500" aria-label="Warning" />
  return <X size={15} className="text-red-500" aria-label="Error" />
}

export function ActivityItem({ a }: { a: Activity }) {
  const [open, setOpen] = useState(false)
  const Icon = ICONS[a.kind]
  const isFile = (a.kind === 'edit' || a.kind === 'create' || a.kind === 'delete') && a.filePath
  const expandable = !!(a.details || a.children?.length || (a.target && a.kind === 'bash'))

  // "Ran commands N" style group
  if (a.children) {
    const running = a.children.some((c) => c.status === 'loading')
    return (
      <div className="fade-in">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex items-center gap-2.5 py-1.5 text-[16px] text-fg/90 hover:text-fg">
          <ChevronRight size={15} className={cn('text-mute transition-transform', open && 'rotate-90')} />
          <Terminal size={16} className="text-mute" /> {a.label} <span className="text-mute">{a.children.length}</span>
          {running && <Loader2 size={14} className="animate-spin text-accent" />}
        </button>
        {open && <div className="ml-6 space-y-1 border-l border-line pl-3">{a.children.map((c) => <ActivityItem key={c.id} a={c} />)}</div>}
      </div>
    )
  }

  if (isFile) {
    return (
      <div className="fade-in space-y-2 py-1">
        <div className="flex min-w-0 items-center gap-2.5 text-[16px]">
          <ChevronRight size={15} className="shrink-0 text-mute" />
          <span className="shrink-0">{a.kind === 'create' ? 'Create' : a.kind === 'delete' ? 'Delete' : 'Edit'}</span>
          <code className="truncate rounded bg-black/40 px-1.5 py-0.5 font-mono text-[12.5px] text-fg/90" title={a.filePath}>{a.filePath}</code>
          {a.status === 'loading' && <Loader2 size={14} className="shrink-0 animate-spin text-accent" />}
        </div>
        {a.kind !== 'delete' && a.status !== 'loading' && <FileCard path={a.filePath!} />}
      </div>
    )
  }

  return (
    <div className="fade-in">
      <button
        disabled={!expandable}
        onClick={() => setOpen(!open)}
        aria-expanded={expandable ? open : undefined}
        className={cn('flex min-w-0 max-w-full items-center gap-2.5 rounded-md py-1.5 text-left text-[15px]', expandable && 'hover:text-fg', a.status === 'error' ? 'text-red-300' : 'text-fg/90')}
      >
        <Icon size={16} className="shrink-0 text-mute" />
        <span className="shrink-0">{a.status === 'loading' && a.kind === 'bash' ? 'Running command…' : a.label}</span>
        {a.target && <span className="truncate font-mono text-[12.5px] text-mute">{a.target}</span>}
        <StatusIcon status={a.status} />
        {a.durationMs != null && a.status !== 'loading' && <span className="shrink-0 font-mono text-[12px] text-mute">{fmtMs(a.durationMs)}</span>}
        {expandable && <ChevronRight size={14} className={cn('shrink-0 text-mute transition-transform', open ? '-rotate-90' : 'rotate-90')} />}
      </button>
      {!open && a.kind === 'bash' && a.status === 'loading' && a.details && (
        <pre aria-live="polite" className="mt-1 mb-2 max-h-32 overflow-hidden whitespace-pre-wrap break-all rounded-lg border border-line bg-black/30 p-3 font-mono text-[11.5px] leading-relaxed text-mute">
          {a.details.split('\n').slice(-6).join('\n')}
        </pre>
      )}
      {a.retry && a.status === 'loading' && (
        <div role="status" className="mb-1 ml-6 text-[13px] text-amber-300/90">A aguardar para tentar de novo ({a.retry.reason}) — tentativa {a.retry.attempt}</div>
      )}
      {a.processId && a.status !== 'loading' && <div className="mt-1 mb-1"><PreviewCard processId={a.processId} /></div>}
      {a.screenshot && (
        <a href={a.screenshot} target="_blank" rel="noreferrer" className="mt-1 mb-2 ml-6 block w-fit overflow-hidden rounded-lg border border-line" title="Captura da app no navegador">
          <img src={a.screenshot} alt="Captura de ecrã da app inspecionada" className="max-h-56 max-w-full object-contain" loading="lazy" />
        </a>
      )}
      {open && (
        <pre className="mt-1 mb-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-black/30 p-3 font-mono text-[12px] leading-relaxed text-fg/80 fade-in">
          {a.kind === 'bash' && a.target ? <span className="text-accent">$ {a.target}{'\n'}</span> : null}{a.details}
        </pre>
      )}
    </div>
  )
}
