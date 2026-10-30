import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../../lib/utils'

/** Lightweight popover menu with outside-click + Escape handling. */
export function Menu({ open, onClose, children, className }: { open: boolean; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.parentElement?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open, onClose])
  if (!open) return null
  return (
    <div ref={ref} role="menu" className={cn('absolute z-50 min-w-48 rounded-xl border border-line bg-card p-1 shadow-2xl shadow-black/40 fade-in', className)}>
      {children}
    </div>
  )
}
export function MenuItem({ children, onClick, active }: { children: ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button role="menuitem" onClick={onClick} className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-card2', active && 'bg-card2')}>
      {children}
    </button>
  )
}
