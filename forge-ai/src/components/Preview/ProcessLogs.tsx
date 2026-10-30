import { useEffect, useRef, useState } from 'react'
import { Api } from '../../services/api'

/** Live-streamed logs of a background process. */
export function ProcessLogs({ id }: { id: string }) {
  const [log, setLog] = useState('')
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    setLog('')
    return Api.streamLogs(id, (chunk) => setLog((l) => (l + chunk).slice(-60_000)))
  }, [id])
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight }, [log])
  return (
    <pre ref={ref} aria-live="polite" className="h-full overflow-auto whitespace-pre-wrap break-all bg-black/40 p-3 font-mono text-[11.5px] leading-relaxed text-fg/80">
      {log || 'Sem output ainda…'}
    </pre>
  )
}
