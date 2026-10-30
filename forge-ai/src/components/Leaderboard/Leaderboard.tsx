import { useEffect, useState } from 'react'
import { PanelLeft, Trophy } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { leaderboard } from '../../services/seed'
import { cn } from '../../lib/utils'

export function Leaderboard() {
  const { sidebarOpen, toggleSidebar } = useStore()
  const [loading, setLoading] = useState(true)
  useEffect(() => { const t = setTimeout(() => setLoading(false), 500); return () => clearTimeout(t) }, [])
  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <header className="flex h-16 shrink-0 items-center gap-2 px-3 sm:px-6">
        {!sidebarOpen && <button aria-label="Open sidebar" onClick={() => toggleSidebar(true)} className="rounded-lg p-2 text-mute hover:bg-card hover:text-fg"><PanelLeft size={19} /></button>}
        <h1 className="text-[17px]">Leaderboard</h1>
        <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-[11px] text-dim">demo data</span>
      </header>
      <div className="mx-auto w-full max-w-4xl px-4 pb-10 sm:px-8">
        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <div className="grid grid-cols-[48px_1fr_70px] gap-2 border-b border-line px-4 py-3 text-xs uppercase tracking-wider text-dim sm:grid-cols-[56px_1fr_90px_90px_160px]">
            <span>#</span><span>User</span><span className="text-right">Tasks</span><span className="hidden text-right sm:block">Projects</span><span className="hidden sm:block">Activity</span>
          </div>
          {loading ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="px-4 py-3"><div className="skeleton h-6" /></div>) :
            leaderboard.map((u, i) => (
              <div key={u.name} className="grid grid-cols-[48px_1fr_70px] items-center gap-2 border-b border-line/60 px-4 py-3 last:border-0 hover:bg-card sm:grid-cols-[56px_1fr_90px_90px_160px] fade-in">
                <span className={cn('font-mono', i < 3 ? 'text-accent' : 'text-mute')}>{i < 3 ? <Trophy size={15} /> : i + 1}</span>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-card2 text-xs">{u.name.split(' ').map((w) => w[0]).join('')}</span>
                  <span className="truncate">{u.name}</span>
                </span>
                <span className="text-right font-mono">{u.tasks}</span>
                <span className="hidden text-right font-mono text-mute sm:block">{u.projects}</span>
                <span className="hidden items-center gap-2 sm:flex">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-card2"><span className="block h-full bg-accent" style={{ width: `${u.activity}%` }} /></span>
                  <span className="w-8 text-right font-mono text-xs text-mute">{u.activity}</span>
                </span>
              </div>
            ))}
        </div>
      </div>
    </main>
  )
}
