import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Api, type UsageSummary } from '../../services/api'

const fmt = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)

/** Token usage of the signed-in user (recorded per agent run). */
export function UsageSettings() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<UsageSummary | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { setData(null); Api.usage(days).then(setData).catch((e) => setErr(e.message)) }, [days])
  if (err) return <p className="p-5 text-sm text-red-300">{err}</p>
  if (!data) return <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-mute" /></div>
  const max = Math.max(1, ...data.byDay.map((d) => d.input + d.output))
  return (
    <div className="space-y-5 p-5 text-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-medium">Utilização</h3>
        <select aria-label="Período" value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-md border border-line bg-bg px-2 py-1 text-xs">
          <option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option>
        </select>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[['Tarefas', data.total.runs], ['Tokens de entrada', data.total.input], ['Tokens de saída', data.total.output]].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-line bg-card px-3 py-2.5"><div className="text-xs text-dim">{k}</div><div className="mt-0.5 font-mono text-lg">{fmt(Number(v))}</div></div>
        ))}
      </div>
      {data.byDay.length > 0 ? (
        <div aria-label="Tokens por dia" className="flex h-28 items-end gap-1 rounded-lg border border-line bg-black/20 p-2">
          {data.byDay.map((d) => (
            <div key={d.day} title={`${d.day}: ${d.input + d.output} tokens, ${d.runs} tarefa(s)`} className="min-w-[4px] max-w-[28px] flex-1 rounded-sm bg-accent/70" style={{ height: `${Math.max(4, ((d.input + d.output) / max) * 100)}%` }} />
          ))}
        </div>
      ) : <p className="rounded-lg border border-line p-4 text-center text-mute">Ainda sem utilização neste período.</p>}
      {data.byModel.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead className="text-dim"><tr><th className="py-1 font-normal">Modelo</th><th className="font-normal">Tarefas</th><th className="font-normal">Entrada</th><th className="font-normal">Saída</th></tr></thead>
          <tbody>{data.byModel.map((m) => (
            <tr key={m.provider + m.model} className="border-t border-line/60"><td className="py-1.5 font-mono">{m.provider}/{m.model}</td><td>{m.runs}</td><td>{fmt(m.input)}</td><td>{fmt(m.output)}</td></tr>
          ))}</tbody>
        </table>
      )}
      <p className="text-xs text-dim">Os custos dependem do fornecedor. O Ollama local é gratuito.</p>
    </div>
  )
}
