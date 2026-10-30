import { Download, X, RefreshCw } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { cn, stats } from '../../lib/utils'
import { ServerCard } from '../Server/ServerCard'
import { ProcessCard } from '../Server/ProcessCard'
import { StartProcessForm } from '../Server/StartProcessForm'
import { FileExplorer } from '../FileExplorer/FileExplorer'

export function WorkspacePanel() {
  const { workspaces, workspaceOpen, toggleWorkspace, toast, mode, refreshWorkspace, backend, processes } = useStore()
  const ws = workspaces[0]
  const totals = ws.root.map(stats).reduce((a, b) => ({ files: a.files + b.files, folders: a.folders + b.folders + 1, size: a.size + b.size }), { files: 0, folders: 0, size: 0 })
  const usedMB = totals.size / 1024 ** 2
  const pct = Math.min(100, (usedMB / ws.quotaMB) * 100)

  const exportWs = () => {
    const blob = new Blob([JSON.stringify(ws, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = 'workspace.json'; a.click()
    URL.revokeObjectURL(a.href)
    toast('Workspace exported', 'success')
  }

  return (
    <>
      {workspaceOpen && <div className="fixed inset-0 z-30 bg-black/50 xl:hidden" onClick={() => toggleWorkspace(false)} />}
      <aside
        aria-label="Workspace"
        className={cn(
          'fixed inset-y-0 right-0 z-40 w-[min(320px,90vw)] bg-bg p-3 transition-transform duration-200 xl:static xl:z-auto xl:w-[300px] xl:pl-0',
          workspaceOpen ? 'translate-x-0' : 'translate-x-full xl:hidden',
        )}
      >
        <div className="flex max-h-full flex-col overflow-hidden rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-4 pt-4 pb-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px]">Workspace</h2>
              <div className="flex gap-1">
                {mode === 'live' && <button aria-label="Refresh files" onClick={() => refreshWorkspace()} className="rounded p-1 text-mute hover:bg-card hover:text-fg"><RefreshCw size={15} /></button>}
                <button aria-label="Export workspace" onClick={exportWs} className="rounded p-1 text-mute hover:bg-card hover:text-fg"><Download size={16} /></button>
                <button aria-label="Close workspace" onClick={() => toggleWorkspace(false)} className="rounded p-1 text-mute hover:bg-card hover:text-fg xl:hidden"><X size={16} /></button>
              </div>
            </div>
            <div className="mt-2 flex justify-between font-mono text-[12.5px] text-dim">
              <span>{usedMB.toFixed(1)}MB/{ws.quotaMB.toFixed(1)}MB</span>
              <span>{totals.files}/{ws.fileQuota / 1000}K files</span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-card2">
              <div className={cn('h-full transition-all', pct > 90 ? 'bg-red-400' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11.5px] text-dim">
              <span>{totals.folders} folders</span>
              <span className="flex items-center gap-1.5">
                <span className={cn('h-1.5 w-1.5 rounded-full', ws.env === 'ready' ? 'bg-green-500' : ws.env === 'busy' ? 'animate-pulse bg-accent' : 'bg-red-500')} />
                env {ws.env}
                {mode === 'live' && backend?.sandbox && (
                  <span title={backend.sandbox === 'local' ? 'Comandos correm SEM isolamento' : 'Comandos correm isolados'} className={cn('ml-1 rounded border px-1 font-mono', backend.sandbox === 'local' ? 'border-yellow-700/60 text-yellow-500' : 'border-line')}>
                    sandbox:{backend.sandbox}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-1.5 border-b border-line p-2">
              {mode === 'live' ? (
                <>
                  {processes.map((p) => <ProcessCard key={p.id} p={p} />)}
                  {processes.length === 0 && <p className="px-2 pt-1 text-xs text-dim">Sem servidores em execução.</p>}
                  <StartProcessForm />
                </>
              ) : ws.servers.length ? ws.servers.map((s) => <ServerCard key={s.id} s={s} />) : <p className="p-2 text-xs text-dim">No running processes.</p>}
            </div>
            <div className="p-2"><FileExplorer root={ws.root} /></div>
          </div>
        </div>
      </aside>
    </>
  )
}
