import { useEffect, useState } from 'react'
import { Loader2, Trash2, ShieldCheck, UserPlus, Ban, RotateCcw } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { Api, type AdminUser } from '../../services/api'
import { cn } from '../../lib/utils'

const input = 'w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-mute'

/** User management (admins only). */
export function AdminSettings() {
  const { user, toast } = useStore()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [signupOpen, setSignupOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const load = async () => {
    const [u, s] = await Promise.all([Api.adminUsers(), Api.adminSettings()])
    setUsers(u); setSignupOpen(s.signupOpen)
  }
  useEffect(() => { load().catch((e) => toast(e.message, 'error')) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); await load(); if (ok) toast(ok, 'success') } catch (e) { toast((e as Error).message, 'error') }
  }
  if (!users) return <div className="grid h-40 place-items-center"><Loader2 className="animate-spin text-mute" /></div>

  return (
    <div className="space-y-5 p-5 text-sm">
      <label className="flex items-center justify-between gap-3 rounded-lg border border-line bg-card px-3 py-2.5">
        <span><span className="block">Registo público</span><span className="text-xs text-dim">Permite que qualquer pessoa com o link crie conta.</span></span>
        <input type="checkbox" aria-label="Registo público" checked={signupOpen} onChange={(e) => act(() => Api.adminSetSettings({ signupOpen: e.target.checked }), e.target.checked ? 'Registo aberto' : 'Registo fechado')} className="h-4 w-4 accent-[var(--color-accent,#d97757)]" />
      </label>

      <section>
        <h3 className="mb-2 text-[15px] font-medium">Utilizadores ({users.length})</h3>
        <ul className="divide-y divide-line/60 rounded-lg border border-line">
          {users.map((u) => (
            <li key={u.id} className={cn('flex items-center gap-3 px-3 py-2.5', u.disabled && 'opacity-50')}>
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/20 text-xs font-semibold text-accent">{u.name.slice(0, 2).toUpperCase()}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate">{u.name}{u.role === 'admin' && <ShieldCheck size={13} className="text-accent" aria-label="admin" />}{u.id === user?.id && <span className="text-xs text-dim">(tu)</span>}{u.disabled && <span className="text-xs text-red-300">desativado</span>}</div>
                <div className="truncate text-xs text-dim">{u.email} · {u.projects ?? 0} proj. · {u.conversations ?? 0} conv. · {(u.tokens ?? 0).toLocaleString('pt-PT')} tokens</div>
              </div>
              {u.id !== user?.id && (
                <div className="flex items-center gap-0.5">
                  <button title={u.role === 'admin' ? 'Retirar admin' : 'Tornar admin'} aria-label={u.role === 'admin' ? `Retirar admin a ${u.email}` : `Tornar ${u.email} admin`} onClick={() => act(() => Api.adminUpdateUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }))} className={cn('rounded p-1.5 hover:bg-card2', u.role === 'admin' ? 'text-accent' : 'text-mute')}><ShieldCheck size={15} /></button>
                  <button title={u.disabled ? 'Reativar' : 'Desativar'} aria-label={u.disabled ? `Reativar ${u.email}` : `Desativar ${u.email}`} onClick={() => act(() => Api.adminUpdateUser(u.id, { disabled: !u.disabled }))} className="rounded p-1.5 text-mute hover:bg-card2 hover:text-fg">{u.disabled ? <RotateCcw size={15} /> : <Ban size={15} />}</button>
                  <button title="Apagar" aria-label={`Apagar ${u.email}`} onClick={() => { if (confirm(`Apagar a conta ${u.email}? As conversas dela serão apagadas; os ficheiros dos projetos ficam no disco.`)) act(() => Api.adminDeleteUser(u.id), 'Conta apagada') }} className="rounded p-1.5 text-mute hover:bg-card2 hover:text-red-400"><Trash2 size={15} /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <form className="space-y-2 rounded-lg border border-line p-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); await act(() => Api.adminCreateUser(form), `Conta criada para ${form.email}`); setForm({ name: '', email: '', password: '' }); setBusy(false) }}>
        <h3 className="flex items-center gap-2 font-medium"><UserPlus size={15} /> Criar conta</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          <input required aria-label="Nome" placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} />
          <input required type="email" aria-label="Email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
          <input required minLength={8} type="password" autoComplete="new-password" aria-label="Palavra-passe inicial" placeholder="Palavra-passe" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={input} />
        </div>
        <div className="text-right"><button type="submit" disabled={busy} className="rounded-lg bg-fg px-3 py-1.5 font-medium text-bg disabled:opacity-40">Criar</button></div>
      </form>
    </div>
  )
}
