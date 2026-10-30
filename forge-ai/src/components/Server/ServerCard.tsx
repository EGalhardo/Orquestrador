import { Globe, RotateCw, Square, Play, ExternalLink, Loader2 } from 'lucide-react'
import type { Server } from '../../types'
import { useStore } from '../../store/useStore'
import { cn } from '../../lib/utils'

export function ServerCard({ s }: { s: Server }) {
  const { setServer, toast } = useStore()
  const restart = () => {
    setServer(s.id, 'starting')
    setTimeout(() => { setServer(s.id, 'running'); toast(`${s.name} is running on :${s.port}`, 'success') }, 1500)
  }
  const color = s.status === 'running' ? 'text-green-400' : s.status === 'starting' ? 'text-accent' : s.status === 'error' ? 'text-red-400' : 'text-dim'
  return (
    <div className="group flex items-center gap-2.5 rounded-lg border border-line/60 bg-black/20 px-3 py-2.5">
      <Globe size={17} className={cn('shrink-0', color)} />
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-[15px]', s.status === 'stopped' ? 'text-mute' : 'text-red-300/90')} title={s.name}>{s.name}</div>
        <div className="font-mono text-[11px] text-dim">:{s.port} · {s.status}</div>
      </div>
      <div className="flex items-center gap-0.5">
        {s.status === 'running' && <button aria-label="Open" onClick={() => toast(`Preview would open on port ${s.port}`)} className="rounded p-1 text-mute hover:bg-card2 hover:text-fg"><ExternalLink size={14} /></button>}
        {s.status === 'stopped'
          ? <button aria-label="Start" onClick={restart} className="rounded p-1 text-mute hover:bg-card2 hover:text-fg"><Play size={14} /></button>
          : <button aria-label="Stop" onClick={() => { setServer(s.id, 'stopped'); toast(`${s.name} stopped`) }} className="rounded p-1 text-mute hover:bg-card2 hover:text-fg"><Square size={13} /></button>}
        {s.status === 'starting' ? <Loader2 size={15} className="mx-1 animate-spin text-mute" />
          : <button aria-label="Restart" onClick={restart} className="rounded p-1 text-mute hover:bg-card2 hover:text-fg"><RotateCw size={14} /></button>}
      </div>
    </div>
  )
}
