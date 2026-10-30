import { Code2 } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { langBadge } from '../../lib/utils'

export function FileCard({ path }: { path: string }) {
  const open = useStore((s) => s.openFileView)
  const name = path.split('/').pop()!
  return (
    <button
      onClick={() => open(path, true)}
      className="flex w-full items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 text-left transition hover:border-mute/50 hover:bg-card2"
      aria-label={`Open ${name}`}
    >
      <Code2 size={17} className="shrink-0 text-mute" />
      <span className="truncate text-[16px]">{name}</span>
      <span className="ml-auto shrink-0 rounded-md border border-line bg-black/30 px-2 py-0.5 font-mono text-[11px] font-bold text-fg/80">{langBadge(name)}</span>
    </button>
  )
}
