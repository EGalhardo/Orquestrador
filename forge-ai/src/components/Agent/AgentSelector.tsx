import { useState } from 'react'
import { ChevronDown, Check, Sparkles, Code2, Bug, Eye, Users } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { AGENTS } from '../../services/agentService'
import type { AgentId } from '../../types'
import { Menu } from '../common/Menu'

const ICON: Record<AgentId, typeof Sparkles> = { agent: Sparkles, team: Users, code: Code2, debug: Bug, review: Eye }

export function AgentSelector() {
  const { agent, setAgent } = useStore()
  const [open, setOpen] = useState(false)
  const current = AGENTS.find((a) => a.id === agent)!
  const Icon = ICON[agent]
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[16px] hover:bg-card2">
        <Icon size={17} /> {current.label} <ChevronDown size={14} className="text-mute" />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} className="bottom-11 left-0 w-60">
        {AGENTS.map((a) => {
          const I = ICON[a.id]
          return (
            <button key={a.id} role="menuitemradio" aria-checked={a.id === agent} disabled={!a.available}
              onClick={() => { setAgent(a.id); setOpen(false) }}
              className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-card2 disabled:opacity-40">
              <I size={16} className="mt-0.5 text-mute" />
              <span className="flex-1"><span className="block text-sm">{a.label}</span><span className="block text-xs text-mute">{a.desc}</span></span>
              {a.id === agent && <Check size={15} className="mt-0.5 text-accent" />}
            </button>
          )
        })}
      </Menu>
    </div>
  )
}
