import { Check, Circle, Loader2, ListChecks } from 'lucide-react'
import type { PlanItem } from '../../types'
import { cn } from '../../lib/utils'

/** The agent's task plan (from the update_plan tool) as a live checklist. */
export function PlanCard({ items, working }: { items: PlanItem[]; working: boolean }) {
  const done = items.filter((i) => i.status === 'done').length
  return (
    <section aria-label="Plano da tarefa" className="my-2 rounded-xl border border-line bg-card/60 p-3 fade-in">
      <header className="mb-2 flex items-center gap-2 text-[14px] text-fg/90">
        <ListChecks size={16} className="text-mute" />
        <span className="font-medium">Plano</span>
        <span className="ml-auto font-mono text-[12px] text-mute">{done}/{items.length}</span>
      </header>
      <div className="mb-2 h-1 overflow-hidden rounded-full bg-black/30" role="progressbar" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
        <div className="h-full bg-accent transition-all" style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }} />
      </div>
      <ol className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2 text-[14px]">
            <span className="mt-0.5 shrink-0">
              {it.status === 'done' ? <Check size={15} className="text-emerald-400" />
                : it.status === 'in_progress' ? (working ? <Loader2 size={15} className="animate-spin text-accent" /> : <Circle size={15} className="text-accent" />)
                : <Circle size={15} className="text-mute/60" />}
            </span>
            <span className={cn(it.status === 'done' ? 'text-mute line-through decoration-mute/40' : it.status === 'in_progress' ? 'text-fg' : 'text-fg/70')}>{it.title}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
