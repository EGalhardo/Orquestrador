import { useState } from 'react'
import { ChevronDown, FolderGit2, Plus, Check } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { cn } from '../../lib/utils'
import { Menu, MenuItem } from '../common/Menu'

/** Shows Live/Demo state + provider, and the active project selector. */
export function ModeBadge() {
  const { mode, backend, openSettings, project, projects, setProject, createProject, toast } = useStore()
  const [open, setOpen] = useState(false)
  const live = mode === 'live' && backend?.configured
  return (
    <div className="flex items-center gap-1.5">
      {mode === 'live' && (
        <div className="relative">
          <button onClick={() => setOpen(!open)} title={`Projecto: ${project}`} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-mute hover:bg-card hover:text-fg">
            <FolderGit2 size={14} /><span className="hidden max-w-28 truncate md:inline">{project}</span><ChevronDown size={12} />
          </button>
          <Menu open={open} onClose={() => setOpen(false)} className="right-0 top-9">
            <div className="px-3 py-1.5 text-xs text-dim">Projecto onde o agente trabalha</div>
            {projects.map((p) => <MenuItem key={p} active={p === project} onClick={() => { setProject(p); setOpen(false) }}>{p === project ? <Check size={14} className="text-accent" /> : <span className="w-3.5" />}{p}</MenuItem>)}
            <MenuItem onClick={async () => {
              setOpen(false)
              const name = prompt('Nome do novo projecto (letras, números, - e _)')?.trim()
              if (!name) return
              if (!/^[\w.-]+$/.test(name)) return toast('Nome inválido', 'error')
              await createProject(name).catch((e) => toast(e.message, 'error'))
            }}><Plus size={14} /> Novo projecto</MenuItem>
          </Menu>
        </div>
      )}
      <button onClick={() => openSettings('model')} title="Definições de IA"
        className={cn('flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs transition hover:bg-card',
          live ? 'border-green-700/60 text-green-400' : mode === 'live' ? 'border-yellow-700/60 text-yellow-400' : 'border-line text-mute')}>
        <span className={cn('h-1.5 w-1.5 rounded-full bg-current', live && 'animate-pulse')} />
        {live ? <>Live<span className="hidden max-w-32 truncate font-mono lg:inline">· {backend!.model}</span></> : mode === 'live' ? 'Configurar IA' : 'Demo'}
      </button>
    </div>
  )
}
