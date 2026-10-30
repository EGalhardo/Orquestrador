import { useEffect, useState } from 'react'
import { Loader2, Trash2, GitBranch, KeyRound } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Api, type KeyStatus } from '../../services/api'

const AI: { id: 'anthropic' | 'openai' | 'gemini'; label: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'openai', label: 'OpenAI (GPT)' },
  { id: 'gemini', label: 'Google Gemini' },
]

function KeyRow({ name, label, hint, extra, onChange }: { name: string; label: string; hint: string; extra?: string; onChange: (k: KeyStatus) => void }) {
  const toast = useStore((s) => s.toast)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<KeyStatus>, ok: string) => {
    setBusy(true)
    try { onChange(await fn()); setValue(''); toast(ok, 'success') } catch (e) { toast((e as Error).message, 'error') } finally { setBusy(false) }
  }
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        {name === 'github' ? <GitBranch size={15} /> : <KeyRound size={15} />}
        <span>{label}</span>
        <span className="ml-auto text-xs text-mute">{hint ? `Guardada ${hint}${extra ? ` · ${extra}` : ''}` : 'Não configurada'}</span>
      </div>
      <div className="flex gap-2">
        <input type="password" autoComplete="off" aria-label={`Chave ${label}`} value={value} onChange={(e) => setValue(e.target.value)}
          placeholder={hint ? 'Substituir…' : 'Cola aqui'} className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-1.5 font-mono text-sm outline-none focus:border-mute" />
        <button disabled={busy || value.trim().length < 8} onClick={() => run(() => Api.setKey(name, value.trim()), `${label}: guardada`)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-40">{busy ? <Loader2 size={14} className="animate-spin" /> : 'Guardar'}</button>
        {hint && <button aria-label={`Remover ${label}`} disabled={busy} onClick={() => run(() => Api.deleteKey(name), `${label}: removida`)} className="rounded-lg border border-line px-2 text-mute hover:text-red-400"><Trash2 size={14} /></button>}
      </div>
    </div>
  )
}

export function KeysSettings() {
  const [keys, setKeys] = useState<KeyStatus | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { Api.listKeys().then(setKeys).catch((e) => setErr((e as Error).message)) }, [])
  if (err) return <p className="p-5 text-sm text-red-400">{err}</p>
  if (!keys) return <div className="p-5"><Loader2 size={16} className="animate-spin text-mute" /></div>
  return (
    <div className="space-y-5 p-5">
      <section className="space-y-2">
        <h3 className="text-sm">Chaves de IA</h3>
        <p className="text-xs text-mute">Guardadas no servidor e cifradas; nunca voltam a ser mostradas. O fornecedor ativo escolhe-se em “Modelo de IA”.</p>
        {AI.map((p) => <KeyRow key={p.id} name={p.id} label={p.label} hint={keys.ai[p.id]} onChange={setKeys} />)}
      </section>
      <section className="space-y-2">
        <h3 className="text-sm">GitHub</h3>
        <p className="text-xs text-mute">Token pessoal (fine-grained, com permissão “Contents” e “Pull requests” de leitura/escrita) para o agente clonar, fazer push/pull e abrir PRs. É validado ao guardar.</p>
        <KeyRow name="github" label="Token GitHub" hint={keys.github.hint} extra={keys.github.login ? `@${keys.github.login}` : ''} onChange={setKeys} />
      </section>
    </div>
  )
}
