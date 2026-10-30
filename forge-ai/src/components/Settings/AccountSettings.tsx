import { useEffect, useState } from 'react'
import { Loader2, LogOut, MonitorSmartphone } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Api } from '../../services/api'

const input = 'mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-mute'

export function AccountSettings() {
  const { user, setUser, toast, logout } = useStore()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState<'' | 'profile' | 'pw' | 'sessions'>('')
  const [sessions, setSessions] = useState<number | null>(null)
  useEffect(() => { Api.me().then((u) => setSessions(u.sessions ?? null)).catch(() => undefined) }, [])
  if (!user) return null

  const run = async (k: typeof busy, fn: () => Promise<void>) => {
    setBusy(k)
    try { await fn() } catch (e) { toast((e as Error).message, 'error') } finally { setBusy('') }
  }
  const dirty = name.trim() !== user.name || email.trim().toLowerCase() !== user.email

  return (
    <div className="space-y-6 p-5 text-sm">
      <section className="space-y-3">
        <h3 className="text-[15px] font-medium">Perfil</h3>
        <label className="block text-mute">Nome<input value={name} onChange={(e) => setName(e.target.value)} className={input} /></label>
        <label className="block text-mute">Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} /></label>
        <div className="flex items-center justify-between">
          <span className="text-xs text-dim">{user.role === 'admin' ? 'Administrador' : 'Utilizador'} · desde {new Date(user.createdAt).toLocaleDateString('pt-PT')}</span>
          <button disabled={!dirty || busy === 'profile'} onClick={() => run('profile', async () => { setUser(await Api.updateMe({ name: name.trim(), email: email.trim() })); toast('Perfil atualizado', 'success') })}
            className="flex items-center gap-2 rounded-lg bg-fg px-3 py-1.5 font-medium text-bg disabled:opacity-40">{busy === 'profile' && <Loader2 size={14} className="animate-spin" />}Guardar</button>
        </div>
      </section>

      <section className="space-y-3 border-t border-line pt-5">
        <h3 className="text-[15px] font-medium">Palavra-passe</h3>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run('pw', async () => { await Api.changePassword(cur, next); setCur(''); setNext(''); setSessions(1); toast('Palavra-passe alterada. As outras sessões foram terminadas.', 'success') }) }}>
          <input type="text" autoComplete="username" value={user.email} readOnly hidden />
          <label className="block text-mute">Atual<input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} className={input} /></label>
          <label className="block text-mute">Nova (mín. 8 caracteres)<input type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} className={input} /></label>
          <div className="text-right"><button type="submit" disabled={busy === 'pw' || !cur || next.length < 8} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 hover:bg-card disabled:opacity-40">{busy === 'pw' && <Loader2 size={14} className="animate-spin" />}Alterar palavra-passe</button></div>
        </form>
      </section>

      <section className="flex items-center gap-3 border-t border-line pt-5">
        <MonitorSmartphone size={18} className="shrink-0 text-mute" />
        <div className="min-w-0 flex-1">
          <div>Sessões ativas: {sessions ?? '…'}</div>
          <div className="text-xs text-dim">Termina a sessão nos outros browsers e dispositivos.</div>
        </div>
        <button disabled={busy === 'sessions' || (sessions ?? 0) <= 1} onClick={() => run('sessions', async () => { const r = await Api.closeOtherSessions(); setSessions(1); toast(`${r.closed} sessão(ões) terminada(s)`, 'success') })}
          className="rounded-lg border border-line px-3 py-1.5 hover:bg-card disabled:opacity-40">Terminar outras</button>
      </section>

      <div className="border-t border-line pt-4">
        <button onClick={logout} className="flex items-center gap-2 text-red-300 hover:text-red-200"><LogOut size={15} /> Terminar sessão</button>
      </div>
    </div>
  )
}
