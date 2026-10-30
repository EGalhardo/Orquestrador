import { Globe, ArrowUpRight } from 'lucide-react'
import { useStore } from '../../store/useStore'

/** Shown in the chat after the agent starts a server. */
export function PreviewCard({ processId }: { processId: string }) {
  const { processes, openPreview } = useStore()
  const p = processes.find((x) => x.id === processId)
  const alive = p && (p.status === 'running' || p.status === 'starting')
  return (
    <button onClick={() => p && openPreview(p.id)} disabled={!p}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 text-left transition hover:border-mute/50 hover:bg-card2 disabled:opacity-50">
      <Globe size={17} className={alive ? 'text-green-400' : 'text-dim'} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px]">{alive ? 'App em execução — abrir pré-visualização' : p ? `Servidor ${p.status === 'stopped' ? 'parado' : 'terminado'}` : 'Servidor já não existe'}</span>
        {p && <span className="block truncate font-mono text-[11.5px] text-dim">{p.command}{p.port ? ` · :${p.port}` : ''}</span>}
      </span>
      <ArrowUpRight size={16} className="shrink-0 text-mute" />
    </button>
  )
}
