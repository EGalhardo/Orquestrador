import { useEffect, useState } from 'react'
import { Loader2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Api, type ProviderId } from '../../services/api'
import { cn } from '../../lib/utils'

const PROVIDERS: { id: ProviderId; label: string; hint: string; keyUrl?: string }[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', hint: 'Recomendado para código. Chave começa por sk-ant-', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'openai', label: 'OpenAI (GPT)', hint: 'Chave começa por sk-', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', label: 'Google Gemini', hint: 'Tem um nível gratuito. Chave do Google AI Studio', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'ollama', label: 'Ollama (local)', hint: 'Grátis e local. Não precisa de chave; o Ollama tem de estar a correr no mesmo computador que o servidor.' },
]

export function ModelSettings() {
  const { settingsOpen, setSettings, backend, backendOnline, saveConfig, mode, setMode, toast, setBackend } = useStore()
  const [provider, setProvider] = useState<ProviderId>('anthropic')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settingsOpen && backend) { setProvider(backend.provider); setModel(backend.model); setBaseUrl(backend.baseUrl); setApiKey('') }
  }, [settingsOpen, backend])

  const info = PROVIDERS.find((p) => p.id === provider)!
  const changeProvider = (p: ProviderId) => { setProvider(p); setModel(backend?.defaults?.[p] ?? ''); setBaseUrl('') }

  const save = async () => {
    setSaving(true)
    try {
      await saveConfig({ provider, model, baseUrl, ...(apiKey ? { apiKey } : {}) })
      setMode('live'); setSettings(false)
    } catch (e) { toast((e as Error).message, 'error') } finally { setSaving(false) }
  }

  return (
    <div className="p-0">
        {!backendOnline ? (
          <div className="space-y-3 p-5 text-sm">
            <div className="flex gap-2 rounded-lg border border-yellow-600/40 bg-yellow-500/10 p-3 text-yellow-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" />O servidor da EGalhardo IA não está a responder. A app está em modo Demo.</div>
            <p className="text-mute">Arranca o servidor com <code className="rounded bg-black/40 px-1">npm run dev:all</code> e recarrega a página.</p>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map((p) => (
                <button key={p.id} onClick={() => changeProvider(p.id)} className={cn('rounded-lg border px-3 py-2.5 text-left text-sm transition', provider === p.id ? 'border-accent bg-accent/10' : 'border-line hover:bg-card')}>{p.label}</button>
              ))}
            </div>
            <p className="text-xs text-mute">{info.hint} {info.keyUrl && <a href={info.keyUrl} target="_blank" rel="noreferrer" className="text-accent underline">Obter chave ↗</a>}</p>

            <label className="block text-sm">Modelo
              <input value={model} onChange={(e) => setModel(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-mute" />
            </label>
            {provider !== 'ollama' && (
              <label className="block text-sm">Chave de API
                <input type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder={backend?.provider === provider && backend.keyHint ? `Guardada (${backend.keyHint}) — deixa vazio para manter` : 'Cola aqui a tua chave'}
                  className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm outline-none focus:border-mute" />
              </label>
            )}
            <details className="text-sm text-mute">
              <summary className="cursor-pointer select-none">Avançado</summary>
              <label className="mt-2 block">URL base (opcional)
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="deixa vazio para usar o padrão" className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus:border-mute" />
              </label>
            </details>
            <p className="flex items-start gap-2 text-xs text-dim"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-green-500" />A chave é enviada só para o servidor da EGalhardo IA e guardada cifrada (AES-256-GCM) na tua conta. Nunca é devolvida ao browser.</p>

            <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
              <button onClick={() => { setMode(mode === 'live' ? 'demo' : 'live'); setSettings(false) }} className="text-xs text-mute underline hover:text-fg">
                {mode === 'live' ? 'Usar modo Demo (sem IA)' : 'Voltar ao modo Live'}
              </button>
              <button onClick={save} disabled={saving || (provider !== 'ollama' && !apiKey && !(backend?.provider === provider && backend.configured))}
                className="flex items-center gap-2 rounded-lg bg-fg px-4 py-2 text-sm font-medium text-bg hover:bg-white disabled:opacity-40">
                {saving && <Loader2 size={14} className="animate-spin" />} Guardar e ligar
              </button>
            </div>
            {backend?.keyHint && backend.provider === provider && (
              <div className="-mt-2 text-right">
                <button onClick={async () => { try { setBackend(await Api.clearKey()); toast('Chave removida', 'success') } catch (e) { toast((e as Error).message, 'error') } }} className="text-xs text-dim underline hover:text-red-400">Remover chave guardada</button>
              </div>
            )}
          </div>
        )}
    </div>
  )
}
