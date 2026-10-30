import { useState } from 'react'
import { Loader2, Eye, EyeOff, ShieldCheck } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Logo } from '../common/Logo'
import { cn } from '../../lib/utils'

/** Sign in / create account. The first account created on a server becomes its administrator. */
export function AuthScreen() {
  const { authStatus, login, register, continueDemo } = useStore()
  const firstRun = authStatus ? !authStatus.hasUsers : false
  const canSignup = authStatus?.signupOpen ?? false
  const [tab, setTab] = useState<'login' | 'register'>(firstRun ? 'register' : 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mode = firstRun ? 'register' : canSignup ? tab : 'login'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      if (mode === 'register') await register(name.trim(), email.trim(), password)
      else await login(email.trim(), password)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  const input = 'mt-1.5 w-full rounded-lg border border-line bg-bg px-3 py-2.5 text-[15px] outline-none transition focus:border-mute'
  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm fade-in">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo className="h-9" />
          <h1 className="text-[22px] font-medium">{firstRun ? 'Configurar a EGalhardo IA' : mode === 'register' ? 'Criar conta' : 'Entrar na EGalhardo IA'}</h1>
          <p className="text-sm text-mute">
            {firstRun ? 'Cria a primeira conta. Ela será a de administrador deste servidor.' : mode === 'register' ? 'Os teus projetos e conversas ficam guardados na tua conta.' : 'Continua onde ficaste.'}
          </p>
        </div>

        {!firstRun && canSignup && (
          <div role="tablist" className="mb-5 grid grid-cols-2 rounded-lg border border-line bg-card p-1 text-sm">
            {(['login', 'register'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setError('') }}
                className={cn('rounded-md py-1.5 transition', tab === t ? 'bg-card2 text-fg' : 'text-mute hover:text-fg')}>
                {t === 'login' ? 'Entrar' : 'Criar conta'}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={submit} className="space-y-4" aria-label={mode === 'register' ? 'Criar conta' : 'Entrar'}>
          {mode === 'register' && (
            <label className="block text-sm text-mute">Nome
              <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
            </label>
          )}
          <label className="block text-sm text-mute">Email
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          </label>
          <label className="block text-sm text-mute">Palavra-passe
            <span className="relative block">
              <input required aria-label="Palavra-passe" aria-describedby={mode === 'register' ? 'pw-hint' : undefined} type={show ? 'text' : 'password'} minLength={mode === 'register' ? 8 : undefined}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} className={cn(input, 'pr-10')} />
              <button type="button" aria-label={show ? 'Esconder palavra-passe' : 'Mostrar palavra-passe'} onClick={() => setShow((v) => !v)}
                className="absolute right-2 top-1/2 mt-[3px] -translate-y-1/2 rounded p-1 text-dim hover:text-fg">{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </span>
            {mode === 'register' && <span id="pw-hint" className="mt-1 block text-xs text-dim">Pelo menos 8 caracteres.</span>}
          </label>

          {error && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

          <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-fg py-2.5 text-[15px] font-medium text-bg transition hover:bg-white disabled:opacity-50">
            {busy && <Loader2 size={16} className="animate-spin" />}
            {mode === 'register' ? (firstRun ? 'Criar conta de administrador' : 'Criar conta') : 'Entrar'}
          </button>
        </form>

        {!firstRun && !canSignup && <p className="mt-4 text-center text-xs text-dim">O registo está fechado. Pede uma conta ao administrador.</p>}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-dim"><ShieldCheck size={13} className="text-green-500" /> Sessão segura, guardada só neste servidor.</p>
        <button onClick={continueDemo} className="mx-auto mt-3 block text-xs text-mute underline hover:text-fg">Explorar em modo demo</button>
      </div>
    </main>
  )
}
