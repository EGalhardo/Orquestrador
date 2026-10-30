import { useRef, useState, type KeyboardEvent } from 'react'
import { LayoutGrid, Paperclip, ArrowUp, Square, X, FileText, Image as ImageIcon, FileArchive, FileCode2 } from 'lucide-react'
import { useStore, useIsWorking } from '../../store/useStore'
import type { Attachment } from '../../types'
import { cn, ext, fmtBytes, uid } from '../../lib/utils'
import { AgentSelector } from '../Agent/AgentSelector'
import { Menu, MenuItem } from '../common/Menu'

const MAX = 25 * 1024 * 1024
const TOOLS = ['Analisa o projecto e identifica problemas.', 'Cria uma página de login moderna.', 'Altera o botão de login para azul.', 'Executa os testes.', 'Cria uma nova página de dashboard.']

function AttachIcon({ name }: { name: string }) {
  const e = ext(name)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return <ImageIcon size={16} />
  if (['zip', 'rar', 'gz', 'tar'].includes(e)) return <FileArchive size={16} />
  if (['ts', 'tsx', 'js', 'jsx', 'css', 'html', 'json', 'py'].includes(e)) return <FileCode2 size={16} />
  return <FileText size={16} />
}

/** Downscale an image to ≤1600px JPEG so the model can read it cheaply. */
function downscale(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      const g = c.getContext('2d')!
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')) }
    img.src = url
  })
}

export function Composer({ draft, setDraft }: { draft: string; setDraft: (s: string) => void }) {
  const { send, stop, toast } = useStore()
  const working = useIsWorking()
  const [files, setFiles] = useState<Attachment[]>([])
  const [tools, setTools] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)

  const submit = () => {
    const text = draft.trim()
    if (!text || working) return
    send(text, files)
    setDraft('')
    setFiles([])
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }
  const addFiles = (list: FileList | null) => {
    if (!list) return
    const next: Attachment[] = []
    for (const f of Array.from(list)) {
      if (f.size > MAX) { toast(`${f.name} exceeds 25 MB`, 'error'); continue }
      const a: Attachment = { id: uid(), name: f.name, size: f.size, type: f.type }
      next.push(a)
      if (f.type.startsWith('image/')) downscale(f).then((dataUrl) => setFiles((p) => p.map((x) => (x.id === a.id ? { ...x, dataUrl } : x)))).catch(() => toast(`Não foi possível ler ${f.name}`, 'error'))
    }
    setFiles((p) => [...p, ...next])
  }

  return (
    <div
      className="rounded-2xl border border-line bg-card/80 shadow-lg shadow-black/20 transition focus-within:border-mute/60"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
    >
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {files.map((f) => (
            <div key={f.id} className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-bg/60 py-1.5 pl-2.5 pr-1.5 text-sm fade-in">
              <span className="text-mute"><AttachIcon name={f.name} /></span>
              <span className="max-w-40 truncate">{f.name}</span>
              <span className="font-mono text-[11px] text-dim">{ext(f.name).toUpperCase() || 'FILE'} · {fmtBytes(f.size)}</span>
              <button aria-label={`Remove ${f.name}`} onClick={() => setFiles((p) => p.filter((x) => x.id !== f.id))} className="rounded p-0.5 text-mute hover:bg-card2 hover:text-fg"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={ta}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 240) + 'px' }}
        onKeyDown={onKey}
        rows={2}
        placeholder="What would you like to do?"
        aria-label="Message the agent"
        className="block w-full resize-none bg-transparent px-6 pt-5 pb-2 text-[17px] placeholder:text-dim focus:outline-none focus-visible:outline-none"
      />
      <div className="flex items-center gap-1 px-3 pb-3">
        <div className="relative">
          <button aria-label="Tools" onClick={() => setTools(!tools)} className="rounded-lg p-2 text-mute hover:bg-card2 hover:text-fg"><LayoutGrid size={18} /></button>
          <Menu open={tools} onClose={() => setTools(false)} className="bottom-11 left-0 w-72">
            <div className="px-3 py-1.5 text-xs text-dim">Quick instructions</div>
            {TOOLS.map((t) => <MenuItem key={t} onClick={() => { setDraft(t); setTools(false); ta.current?.focus() }}>{t}</MenuItem>)}
          </Menu>
        </div>
        <AgentSelector />
        <div className="ml-auto flex items-center gap-2">
          <input ref={input} type="file" multiple hidden accept="image/*,.pdf,.doc,.docx,.txt,.md,.zip,.ts,.tsx,.js,.jsx,.css,.html,.json,.py" onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
          <button aria-label="Attach files" onClick={() => input.current?.click()} className="rounded-lg p-2 text-mute hover:bg-card2 hover:text-fg"><Paperclip size={18} /></button>
          {working ? (
            <button aria-label="Stop agent" onClick={stop} className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-bg hover:bg-card2"><Square size={15} className="fill-fg" /></button>
          ) : (
            <button aria-label="Send" onClick={submit} disabled={!draft.trim()} className={cn('grid h-10 w-10 place-items-center rounded-xl transition', draft.trim() ? 'bg-fg text-bg hover:bg-white' : 'bg-card2 text-dim')}><ArrowUp size={18} /></button>
          )}
        </div>
      </div>
    </div>
  )
}
