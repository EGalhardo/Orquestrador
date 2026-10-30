import { useMemo } from 'react'
import { X, Code2, GitCompare, Copy } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { cn, findByPath, fmtBytes, langBadge } from '../../lib/utils'

type Line = { t: ' ' | '+' | '-'; s: string }
/** Minimal LCS line diff — fine for small files. */
function diff(a: string, b: string): Line[] {
  const A = a.split('\n'), B = b.split('\n')
  const n = A.length, m = B.length
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Line[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: ' ', s: A[i] }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: A[i++] })
    else out.push({ t: '+', s: B[j++] })
  }
  while (i < n) out.push({ t: '-', s: A[i++] })
  while (j < m) out.push({ t: '+', s: B[j++] })
  return out
}

export function FileViewer() {
  const { openFile, closeFile, workspaces, toast } = useStore()
  const node = openFile ? findByPath(workspaces[0].root, openFile.path) : undefined
  const hasDiff = node?.previous !== undefined
  const showDiff = !!openFile?.showDiff && hasDiff
  const lines = useMemo<Line[]>(() => {
    if (!node) return []
    if (showDiff) return diff(node.previous ?? '', node.content ?? '')
    return (node.content ?? '').split('\n').map((s) => ({ t: ' ', s }))
  }, [node, showDiff])

  if (!openFile) return null
  const name = openFile.path.split('/').pop()!
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg fade-in" role="dialog" aria-label={`File ${name}`}>
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Code2 size={17} className="text-mute" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><span className="truncate font-medium">{name}</span><span className="rounded border border-line px-1.5 font-mono text-[10px] font-bold">{langBadge(name)}</span></div>
          <div className="truncate font-mono text-xs text-mute">{openFile.path}{node && ` · ${fmtBytes(node.size ?? 0)}`}</div>
        </div>
        {hasDiff && (
          <button onClick={() => useStore.setState({ openFile: { ...openFile, showDiff: !showDiff } })} className={cn('flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-card', showDiff && 'bg-card2')}>
            <GitCompare size={14} /> {showDiff ? 'Changes' : 'Source'}
          </button>
        )}
        <button aria-label="Copy" onClick={() => { navigator.clipboard?.writeText(node?.content ?? ''); toast('Copied to clipboard') }} className="rounded-lg p-2 text-mute hover:bg-card hover:text-fg"><Copy size={16} /></button>
        <button aria-label="Close file" onClick={closeFile} className="rounded-lg p-2 text-mute hover:bg-card hover:text-fg"><X size={18} /></button>
      </div>
      {!node ? (
        <div className="grid flex-1 place-items-center text-sm text-mute">This file no longer exists in the workspace.</div>
      ) : (
        <div className="flex-1 overflow-auto py-2 font-mono text-[12.5px] leading-6">
          {lines.map((l, i) => (
            <div key={i} className={cn('flex', l.t === '+' && 'bg-green-500/10', l.t === '-' && 'bg-red-500/10')}>
              <span className="w-12 shrink-0 select-none pr-3 text-right text-dim">{i + 1}</span>
              <span className={cn('w-4 shrink-0 select-none', l.t === '+' ? 'text-green-400' : l.t === '-' ? 'text-red-400' : 'text-dim')}>{l.t.trim()}</span>
              <span className="whitespace-pre pr-4 text-fg/90">{l.s || ' '}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
