import { useEffect, useRef, useState } from 'react'
import { Globe, RotateCw, ExternalLink, X, TerminalSquare, Loader2, Square, Monitor, Smartphone } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { previewUrl } from '../../services/api'
import { cn } from '../../lib/utils'
import { ProcessLogs } from './ProcessLogs'

/** Live preview of a background process, shown over the chat area (like the file viewer). */
export function PreviewPanel() {
  const { previewId, processes, openPreview, processAction } = useStore()
  const proc = processes.find((p) => p.id === previewId)
  const [path, setPath] = useState('/')
  const [draft, setDraft] = useState('/')
  const [nonce, setNonce] = useState(0)
  const [showLogs, setShowLogs] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [loading, setLoading] = useState(true)
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => { setPath('/'); setDraft('/'); setShowLogs(false) }, [previewId])
  useEffect(() => { setLoading(true) }, [path, nonce, proc?.previewPort])
  // Show logs automatically when the process dies.
  useEffect(() => { if (proc && (proc.status === 'error' || proc.status === 'exited')) setShowLogs(true) }, [proc?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!previewId || !proc) return null
  const base = proc.previewPort ? previewUrl(proc.previewPort) : null
  const src = base ? `${base}${path.startsWith('/') ? path : `/${path}`}` : null
  const dot = proc.status === 'running' ? 'bg-green-500' : proc.status === 'starting' ? 'bg-accent animate-pulse' : proc.status === 'error' ? 'bg-red-500' : 'bg-dim'

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg fade-in" role="dialog" aria-label="Pré-visualização">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Globe size={16} className="shrink-0 text-mute" />
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} title={proc.status} />
        <form className="flex min-w-0 flex-1 items-center rounded-lg border border-line bg-card px-2" onSubmit={(e) => { e.preventDefault(); setPath(draft || '/'); setNonce((n) => n + 1) }}>
          <span className="hidden shrink-0 font-mono text-[11px] text-dim sm:inline">localhost:{proc.port ?? '…'}</span>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Caminho" className="min-w-0 flex-1 bg-transparent px-1 py-1.5 font-mono text-[12.5px] outline-none" />
        </form>
        <button aria-label="Recarregar" title="Recarregar" onClick={() => setNonce((n) => n + 1)} className="rounded-lg p-2 text-mute hover:bg-card hover:text-fg"><RotateCw size={15} /></button>
        <button aria-label="Vista telemóvel" title="Vista telemóvel" onClick={() => setMobile((v) => !v)} className={cn('hidden rounded-lg p-2 hover:bg-card hover:text-fg sm:block', mobile ? 'text-accent' : 'text-mute')}>{mobile ? <Smartphone size={15} /> : <Monitor size={15} />}</button>
        <button aria-label="Logs" title="Logs" onClick={() => setShowLogs((v) => !v)} className={cn('rounded-lg p-2 hover:bg-card hover:text-fg', showLogs ? 'text-accent' : 'text-mute')}><TerminalSquare size={15} /></button>
        {src && <a aria-label="Abrir num novo separador" title="Abrir num novo separador" href={src} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-mute hover:bg-card hover:text-fg"><ExternalLink size={15} /></a>}
        {(proc.status === 'running' || proc.status === 'starting') && <button aria-label="Parar servidor" title="Parar servidor" onClick={() => processAction(proc.id, 'stop')} className="rounded-lg p-2 text-mute hover:bg-card hover:text-red-400"><Square size={14} /></button>}
        <button aria-label="Fechar pré-visualização" onClick={() => openPreview(null)} className="rounded-lg p-2 text-mute hover:bg-card hover:text-fg"><X size={17} /></button>
      </div>

      <div className="relative min-h-0 flex-1 bg-[#141413]">
        {src && proc.status === 'running' ? (
          <div className={cn('h-full', mobile && 'flex justify-center py-4')}>
            <iframe
              ref={frame}
              key={`${src}#${nonce}`}
              src={src}
              title={`Pré-visualização ${proc.name}`}
              onLoad={() => setLoading(false)}
              className={cn('h-full border-0 bg-white', mobile ? 'w-[390px] max-w-full rounded-xl shadow-2xl' : 'w-full')}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
            {loading && <div className="absolute inset-0 grid place-items-center bg-bg/60"><Loader2 className="animate-spin text-accent" /></div>}
          </div>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-sm text-mute">
            {proc.status === 'starting' ? <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin text-accent" /> A iniciar <code className="font-mono">{proc.command}</code>…</span>
              : <div className="space-y-3"><p>O servidor {proc.status === 'stopped' ? 'foi parado' : `terminou (exit ${proc.exitCode ?? '?'})`}.</p>
                  <button onClick={() => processAction(proc.id, 'restart')} className="rounded-lg border border-line px-3 py-1.5 text-fg hover:bg-card">Reiniciar</button></div>}
          </div>
        )}
      </div>
      {showLogs && <div className="h-56 shrink-0 border-t border-line"><ProcessLogs id={proc.id} /></div>}
    </div>
  )
}
