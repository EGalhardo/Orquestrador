import { Globe, RotateCw, Square, Eye, Trash2, Loader2 } from 'lucide-react'
import type { ProcInfo } from '../../services/api'
import { useStore } from '../../store/useStore'
import { cn } from '../../lib/utils'

const LABEL: Record<ProcInfo['status'], string> = { starting: 'a iniciar', running: 'a correr', exited: 'terminou', error: 'erro', stopped: 'parado' }

/** Real background process (live mode). */
export function ProcessCard({ p }: { p: ProcInfo }) {
  const { openPreview, processAction, previewId } = useStore()
  const alive = p.status === 'running' || p.status === 'starting'
  const color = p.status === 'running' ? 'text-green-400' : p.status === 'starting' ? 'text-accent' : p.status === 'error' ? 'text-red-400' : 'text-dim'
  return (
    <div className={cn('group flex items-center gap-2.5 rounded-lg border bg-black/20 px-3 py-2.5', previewId === p.id ? 'border-accent/60' : 'border-line/60')}>
      <Globe size={17} className={cn('shrink-0', color)} />
      <button onClick={() => openPreview(p.id)} className="min-w-0 flex-1 text-left" title={`${p.command}\nAbrir pré-visualização`}>
        <div className={cn('truncate text-[14px]', alive ? 'text-fg' : 'text-mute')}>{p.name}</div>
        <div className="truncate font-mono text-[11px] text-dim">{p.project} · {p.port ? `:${p.port} · ` : ''}{LABEL[p.status]}{p.exitCode !== null && !alive ? ` (${p.exitCode})` : ''}</div>
      </button>
      <div className="flex items-center gap-0.5">
        <button aria-label="Pré-visualizar" title="Pré-visualizar / logs" onClick={() => openPreview(p.id)} className="rounded p-1 text-mute hover:bg-card2 hover:text-fg"><Eye size={14} /></button>
        {alive
          ? <button aria-label="Parar" title="Parar" onClick={() => processAction(p.id, 'stop')} className="rounded p-1 text-mute hover:bg-card2 hover:text-red-400"><Square size={13} /></button>
          : <button aria-label="Remover" title="Remover" onClick={() => processAction(p.id, 'remove')} className="rounded p-1 text-mute hover:bg-card2 hover:text-fg"><Trash2 size={13} /></button>}
        {p.status === 'starting' ? <Loader2 size={14} className="mx-1 animate-spin text-mute" />
          : <button aria-label="Reiniciar" title="Reiniciar" onClick={() => processAction(p.id, 'restart')} className="rounded p-1 text-mute hover:bg-card2 hover:text-fg"><RotateCw size={14} /></button>}
      </div>
    </div>
  )
}
