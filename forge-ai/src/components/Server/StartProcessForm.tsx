import { useState } from 'react'
import { Play, Plus, Loader2 } from 'lucide-react'
import { useStore } from '../../store/useStore'

/** Lets the user start a dev server manually (without the agent). */
export function StartProcessForm() {
  const { startProcess, project } = useStore()
  const [open, setOpen] = useState(false)
  const [cmd, setCmd] = useState('npm run dev')
  const [busy, setBusy] = useState(false)
  if (!open) return (
    <button onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[13px] text-mute hover:bg-card hover:text-fg">
      <Plus size={14} /> Iniciar servidor em {project}
    </button>
  )
  return (
    <form className="flex items-center gap-1.5 px-1 py-1" onSubmit={async (e) => { e.preventDefault(); if (!cmd.trim()) return; setBusy(true); await startProcess(cmd.trim()); setBusy(false); setOpen(false) }}>
      <input autoFocus value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }} aria-label="Comando" className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-[12px] outline-none focus:border-mute" />
      <button type="submit" disabled={busy} aria-label="Iniciar" className="grid h-8 w-8 place-items-center rounded-md bg-fg text-bg disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}</button>
    </form>
  )
}
