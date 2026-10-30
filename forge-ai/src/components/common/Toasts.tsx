import { CheckCircle2, Info, XCircle, X } from 'lucide-react'
import { useStore } from '../../store/useStore'

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const dismiss = useStore((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = t.tone === 'success' ? CheckCircle2 : t.tone === 'error' ? XCircle : Info
        const color = t.tone === 'success' ? 'text-green-400' : t.tone === 'error' ? 'text-red-400' : 'text-accent'
        return (
          <div key={t.id} className="pointer-events-auto flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-3 text-sm shadow-xl fade-in">
            <Icon size={16} className={color} /> {t.text}
            <button aria-label="Dismiss" onClick={() => dismiss(t.id)} className="ml-2 text-dim hover:text-fg"><X size={14} /></button>
          </div>
        )
      })}
    </div>
  )
}
