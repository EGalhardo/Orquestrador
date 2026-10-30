import { useMemo, useState } from 'react'
import { ChevronDown, CirclePlus, ListOrdered, Search, PanelLeft, Hammer, Circle, MoreHorizontal, Pencil, Trash2, LogOut, Settings, User as UserIcon, BarChart3, Users, LogIn } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { cn, period } from '../../lib/utils'
import { Logo } from '../common/Logo'
import { Menu, MenuItem } from '../common/Menu'

export function Sidebar() {
  const { conversations, activeId, view, sidebarOpen, newChat, selectChat, setView, toggleSidebar, setSearch, renameChat, deleteChat, toast, user, logout, openSettings, backendOnline } = useStore()
  const initials = user ? user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : 'D'
  const [brandMenu, setBrandMenu] = useState(false)
  const [account, setAccount] = useState(false)
  const [itemMenu, setItemMenu] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const groups = useMemo(() => {
    const g: Record<string, typeof conversations> = { Today: [], Yesterday: [], Older: [] }
    ;[...conversations].sort((a, b) => b.updatedAt - a.updatedAt).forEach((c) => g[period(c.updatedAt)].push(c))
    return g
  }, [conversations])

  const closeOnMobile = () => { if (window.innerWidth < 1024) toggleSidebar(false) }

  return (
    <>
      {sidebarOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => toggleSidebar(false)} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[292px] flex-col border-r border-line bg-panel transition-transform duration-200 lg:static lg:z-auto',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:hidden',
        )}
        aria-label="Sidebar"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <div className="relative">
            <button onClick={() => setBrandMenu((v) => !v)} className="flex items-center gap-1.5 text-[26px] font-semibold tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
              <Logo className="h-7 w-7" /> EGalhardo IA <ChevronDown size={16} className="mt-1 text-mute" />
            </button>
            <Menu open={brandMenu} onClose={() => setBrandMenu(false)} className="left-0 top-11">
              <MenuItem onClick={() => { setBrandMenu(false); toast('EGalhardo IA v1.0 — AI dev workspace') }}>About EGalhardo IA</MenuItem>
              <MenuItem onClick={() => { setBrandMenu(false); setView('leaderboard') }}>Leaderboard</MenuItem>
            </Menu>
          </div>
          <button aria-label="Collapse sidebar" onClick={() => toggleSidebar(false)} className="rounded-lg p-1.5 text-mute hover:bg-card hover:text-fg"><PanelLeft size={20} /></button>
        </div>

        <nav className="space-y-0.5 px-3">
          <NavItem icon={<CirclePlus size={19} />} label="New Chat" onClick={() => { newChat(); closeOnMobile() }} kbd="⌘⇧O" />
          <NavItem icon={<ListOrdered size={19} />} label="Leaderboard" active={view === 'leaderboard'} onClick={() => { setView('leaderboard'); closeOnMobile() }} />
          <NavItem icon={<Search size={19} />} label="Search" onClick={() => setSearch(true)} kbd="⌘K" />
        </nav>

        <div className="mt-5 flex-1 overflow-y-auto px-3 pb-4">
          {conversations.length === 0 && <p className="px-3 text-sm text-dim">No conversations yet.</p>}
          {Object.entries(groups).map(([label, items]) => items.length > 0 && (
            <section key={label} className="mb-5">
              <h3 className="px-3 pb-2 text-[13px] text-mute">{label}</h3>
              {items.map((c) => {
                const active = c.id === activeId && view === 'chat'
                return (
                  <div key={c.id} className={cn('group relative flex items-center rounded-lg', active ? 'bg-card2/70' : 'hover:bg-card')}>
                    {editing === c.id ? (
                      <input
                        autoFocus defaultValue={c.title}
                        className="m-1 w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm outline-none"
                        onBlur={(e) => { renameChat(c.id, e.target.value.trim() || c.title); setEditing(null) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null) }}
                      />
                    ) : (
                      <button onClick={() => { selectChat(c.id); closeOnMobile() }} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left text-[15px]" title={c.title}>
                        {c.state === 'working' ? <Circle size={11} className="shrink-0 animate-pulse fill-accent text-accent" />
                          : label === 'Today' ? <Circle size={11} className={cn('shrink-0', active ? 'fill-fg text-fg' : 'fill-mute text-mute')} />
                          : <Hammer size={15} className="shrink-0 text-mute" />}
                        <span className="truncate">{c.title}</span>
                      </button>
                    )}
                    <button aria-label="Conversation options" onClick={() => setItemMenu(itemMenu === c.id ? null : c.id)} className="mr-1 rounded p-1 text-mute opacity-0 hover:text-fg group-hover:opacity-100 focus:opacity-100"><MoreHorizontal size={16} /></button>
                    <Menu open={itemMenu === c.id} onClose={() => setItemMenu(null)} className="right-0 top-10">
                      <MenuItem onClick={() => { setEditing(c.id); setItemMenu(null) }}><Pencil size={14} /> Rename</MenuItem>
                      <MenuItem onClick={() => { deleteChat(c.id); setItemMenu(null) }}><Trash2 size={14} className="text-red-400" /> Delete</MenuItem>
                    </Menu>
                  </div>
                )
              })}
            </section>
          ))}
        </div>

        <div className="relative border-t border-line px-4 py-3">
          <button onClick={() => setAccount((v) => !v)} aria-label="Menu da conta" className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-card">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/20 text-sm font-semibold text-accent">{initials}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm">{user ? user.name : 'Modo demo'}</span>
              <span className="block truncate text-xs text-dim">{user ? user.email : 'Sem conta'}</span>
            </span>
          </button>
          <Menu open={account} onClose={() => setAccount(false)} className="bottom-16 left-4 right-4">
            {user ? (
              <>
                <MenuItem onClick={() => { setAccount(false); openSettings('account') }}><UserIcon size={14} /> Conta</MenuItem>
                <MenuItem onClick={() => { setAccount(false); openSettings('model') }}><Settings size={14} /> Modelo de IA</MenuItem>
                <MenuItem onClick={() => { setAccount(false); openSettings('usage') }}><BarChart3 size={14} /> Utilização</MenuItem>
                {user.role === 'admin' && <MenuItem onClick={() => { setAccount(false); openSettings('admin') }}><Users size={14} /> Utilizadores</MenuItem>}
                <MenuItem onClick={() => { setAccount(false); logout() }}><LogOut size={14} /> Terminar sessão</MenuItem>
              </>
            ) : (
              <>
                {backendOnline && <MenuItem onClick={() => { setAccount(false); useStore.setState({ auth: 'signedOut' }) }}><LogIn size={14} /> Iniciar sessão</MenuItem>}
                <MenuItem onClick={() => { setAccount(false); localStorage.removeItem('forge-ai-state-v1'); location.reload() }}><LogOut size={14} /> Repor dados demo</MenuItem>
              </>
            )}
          </Menu>
        </div>
        <div className="flex justify-between border-t border-line px-5 py-2.5 text-xs text-mute">
          <a href="#terms" className="hover:text-fg">Terms of Use</a>
          <a href="#privacy" className="hover:text-fg">Privacy Policy</a>
          <a href="#cookies" className="hover:text-fg">Cookies</a>
        </div>
      </aside>
    </>
  )
}

function NavItem({ icon, label, onClick, active, kbd }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; kbd?: string }) {
  return (
    <button onClick={onClick} className={cn('group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[17px] hover:bg-card', active && 'bg-card2/70')}>
      <span className="text-fg/90">{icon}</span> {label}
      {kbd && <span className="ml-auto hidden font-mono text-[11px] text-dim group-hover:inline">{kbd}</span>}
    </button>
  )
}
