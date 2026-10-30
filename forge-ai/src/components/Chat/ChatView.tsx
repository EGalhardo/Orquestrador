import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ChevronDown, PanelLeft, ChevronsRight, ChevronsLeft, Loader2, Pencil, Trash2, Copy, Blocks, Bug, ScanSearch, Component, Wand2, Paperclip, Undo2 } from 'lucide-react'
import { useStore, useActiveConversation } from '../../store/useStore'
import type { Message } from '../../types'
import { cn, fmtBytes, fmtMs, timeAgo } from '../../lib/utils'
import { ActivityItem } from '../Activity/ActivityItem'
import { PlanCard } from '../Agent/PlanCard'
import { Composer } from '../Composer/Composer'
import { FileViewer } from './FileViewer'
import { PreviewPanel } from '../Preview/PreviewPanel'
import { Menu, MenuItem } from '../common/Menu'
import { Logo } from '../common/Logo'
import { ModeBadge } from '../Settings/ModeBadge'

const SUGGESTIONS = [
  { icon: Blocks, label: 'Build an application', prompt: 'Cria uma nova página de dashboard.' },
  { icon: Bug, label: 'Fix a bug', prompt: 'Corrige o erro de autenticação.' },
  { icon: ScanSearch, label: 'Analyse my project', prompt: 'Analisa o projecto e identifica problemas.' },
  { icon: Component, label: 'Create a component', prompt: 'Cria um componente chamado UserCard.' },
  { icon: Wand2, label: 'Refactor code', prompt: 'Refactor the VideoSessionPage component.' },
]

function Markdownish({ text }: { text: string }) {
  // Minimal inline renderer: `code` and _italic_
  return (
    <div className="whitespace-pre-wrap break-words leading-relaxed">
      {text.split(/(`[^`\n]+`|(?<![\w])_[^_\n]+_(?![\w]))/g).map((p, i) =>
        p.startsWith('`') ? <code key={i} className="rounded bg-black/40 px-1 py-0.5 font-mono text-[13px]">{p.slice(1, -1)}</code>
        : /^_[^_]+_$/.test(p) ? <em key={i} className="text-mute">{p.slice(1, -1)}</em>
        : p)}
    </div>
  )
}

function UndoButton({ m }: { m: Message }) {
  const undo = useStore((s) => s.undoMessage)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!m.checkpoint) return null
  if (m.checkpoint.undone) return <span className="mr-auto flex items-center gap-1.5 text-[13px] text-mute"><Undo2 size={14} /> Alterações desfeitas</span>
  if (confirm) return (
    <span className="mr-auto flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-fg/80">Repor os ficheiros como estavam antes desta tarefa?</span>
      <button disabled={busy} onClick={async () => { setBusy(true); await undo(m.id); setBusy(false); setConfirm(false) }} className="rounded-md bg-red-500/15 px-2 py-1 text-red-300 hover:bg-red-500/25 disabled:opacity-50">{busy ? 'A desfazer…' : 'Desfazer'}</button>
      <button disabled={busy} onClick={() => setConfirm(false)} className="rounded-md px-2 py-1 text-mute hover:text-fg">Cancelar</button>
    </span>
  )
  return <button onClick={() => setConfirm(true)} className="mr-auto flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[13px] text-mute hover:bg-white/5 hover:text-fg" title="Repor os ficheiros do projeto ao estado anterior a esta tarefa"><Undo2 size={14} /> Desfazer alterações</button>
}

function AgentMessage({ m, working }: { m: Message; working: boolean }) {
  return (
    <div className="space-y-1">
      {m.plan && m.plan.length > 0 && <PlanCard items={m.plan} working={working} />}
      {m.activities?.map((a) => <ActivityItem key={a.id} a={a} />)}
      {working && !m.content && (
        <div className="flex items-center gap-2 py-2 text-sm text-mute"><Loader2 size={14} className="animate-spin text-accent" /> Agent is working…</div>
      )}
      {m.content && <div className="pt-3 text-[15px] text-fg/90 fade-in"><Markdownish text={m.content} /></div>}
      {m.elapsedMs != null && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-2 text-[14px] text-mute">{!working && <UndoButton m={m} />}<span>{fmtMs(m.elapsedMs)} | {timeAgo(m.createdAt)}</span></div>
      )}
    </div>
  )
}

export function ChatView() {
  const conv = useActiveConversation()
  const { sidebarOpen, workspaceOpen, toggleSidebar, toggleWorkspace, renameChat, deleteChat, toast } = useStore()
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scroller = useRef<HTMLDivElement>(null)
  const working = conv?.state === 'working'

  const last = conv?.messages[conv.messages.length - 1]
  const sig = `${conv?.id}-${conv?.messages.length}-${last?.activities?.length}-${last?.content?.length}`
  useEffect(() => {
    const el = scroller.current
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAtBottom(true); requestAnimationFrame(() => scroller.current?.scrollTo({ top: 1e9 })) }, [conv?.id])

  const onScroll = () => {
    const el = scroller.current!
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  return (
    <main className="relative flex min-w-0 flex-1 flex-col">
      <header className="flex h-16 shrink-0 items-center gap-2 px-3 sm:px-6">
        {!sidebarOpen && <button aria-label="Open sidebar" onClick={() => toggleSidebar(true)} className="rounded-lg p-2 text-mute hover:bg-card hover:text-fg"><PanelLeft size={19} /></button>}
        <div className="relative min-w-0 flex-1">
          {conv ? (
            <button onClick={() => setMenu(!menu)} className="flex min-w-0 max-w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[17px] hover:bg-card">
              <span className="truncate">{conv.title}</span>
              <ChevronDown size={15} className="shrink-0 text-mute" />
            </button>
          ) : <span className="px-2 text-[17px] text-mute">New chat</span>}
          {conv && (
            <Menu open={menu} onClose={() => setMenu(false)} className="left-0 top-11">
              <MenuItem onClick={() => { const t = prompt('Rename conversation', conv.title); if (t?.trim()) renameChat(conv.id, t.trim()); setMenu(false) }}><Pencil size={14} /> Rename</MenuItem>
              <MenuItem onClick={() => { navigator.clipboard?.writeText(location.href + '#' + conv.id); toast('Link copied'); setMenu(false) }}><Copy size={14} /> Copy link</MenuItem>
              <MenuItem onClick={() => { deleteChat(conv.id); setMenu(false) }}><Trash2 size={14} className="text-red-400" /> Delete</MenuItem>
            </Menu>
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <ModeBadge />
          {conv && (
            <span className={cn('hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs sm:flex',
              working ? 'text-accent' : conv.state === 'error' ? 'text-red-400' : conv.state === 'stopped' ? 'text-yellow-500' : 'text-mute')}>
              {working ? <Loader2 size={12} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
              {working ? 'Working' : conv.state === 'done' ? 'Idle' : conv.state[0].toUpperCase() + conv.state.slice(1)}
            </span>
          )}
          <button aria-label={workspaceOpen ? 'Hide workspace' : 'Show workspace'} onClick={() => toggleWorkspace()} className="rounded-lg p-2 text-mute hover:bg-card hover:text-fg">
            {workspaceOpen ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <FileViewer />
        <PreviewPanel />
        <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="mx-auto w-full max-w-[900px] px-4 pb-8 sm:px-8">
            {!conv || conv.messages.length === 0 ? (
              <div className="flex min-h-[55vh] flex-col items-center justify-center text-center fade-in">
                <Logo className="mb-5 h-12 w-12 text-fg" />
                <h1 className="mb-8 text-2xl font-medium sm:text-3xl" style={{ fontFamily: 'Georgia, serif' }}>How can I help you build today?</h1>
                <div className="flex max-w-2xl flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button key={s.label} onClick={() => setDraft(s.prompt)} className="flex items-center gap-2 rounded-full border border-line bg-card/60 px-4 py-2 text-sm text-fg/90 transition hover:border-mute/50 hover:bg-card2">
                      <s.icon size={15} className="text-mute" /> {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : conv.messages.map((m, i) => (
              <div key={m.id} className="py-3">
                {m.role === 'user' ? (
                  <div className="flex flex-col items-end gap-2 fade-in">
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {m.attachments.map((a) => <span key={a.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs text-mute"><Paperclip size={12} />{a.name} · {fmtBytes(a.size)}</span>)}
                      </div>
                    )}
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-card2 px-4 py-3 text-[17px]">{m.content}</div>
                  </div>
                ) : <AgentMessage m={m} working={working && i === conv.messages.length - 1} />}
              </div>
            ))}
          </div>
        </div>
        {!atBottom && (
          <button aria-label="Scroll to bottom" onClick={() => scroller.current?.scrollTo({ top: 1e9, behavior: 'smooth' })} className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-lg border border-line bg-card p-2 text-fg/80 shadow-lg hover:bg-card2">
            <ArrowDown size={18} />
          </button>
        )}
      </div>

      <div className="shrink-0 px-3 pb-3 sm:px-5 sm:pb-4">
        <div className="mx-auto max-w-[920px]"><Composer draft={draft} setDraft={setDraft} /></div>
      </div>
    </main>
  )
}
