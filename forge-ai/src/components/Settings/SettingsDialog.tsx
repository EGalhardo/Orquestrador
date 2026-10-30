import { X, KeyRound, Cpu, UserRound, BarChart3, Users } from 'lucide-react'
import { useStore, type SettingsTab } from '../../store/useStore'
import { cn } from '../../lib/utils'
import { ModelSettings } from './ModelSettings'
import { AccountSettings } from './AccountSettings'
import { UsageSettings } from './UsageSettings'
import { AdminSettings } from './AdminSettings'
import { KeysSettings } from './KeysSettings'

export function SettingsDialog() {
  const { settingsOpen, setSettings, settingsTab, openSettings, user, auth } = useStore()
  if (!settingsOpen) return null
  const tabs: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { id: 'model', label: 'Modelo de IA', icon: <Cpu size={15} /> },
    ...(auth === 'signedIn' ? [
      { id: 'keys' as const, label: 'Chaves e GitHub', icon: <KeyRound size={15} /> },
      { id: 'account' as const, label: 'Conta', icon: <UserRound size={15} /> },
      { id: 'usage' as const, label: 'Utilização', icon: <BarChart3 size={15} /> },
      ...(user?.role === 'admin' ? [{ id: 'admin' as const, label: 'Utilizadores', icon: <Users size={15} /> }] : []),
    ] : []),
  ]
  const tab = tabs.some((t) => t.id === settingsTab) ? settingsTab : 'model'
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setSettings(false)}>
      <div role="dialog" aria-label="Definições" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl fade-in">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
          <h2 className="text-[17px]">Definições</h2>
          <button aria-label="Fechar" onClick={() => setSettings(false)} className="ml-auto rounded p-1 text-mute hover:bg-card hover:text-fg"><X size={18} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {tabs.length > 1 && (
            <nav role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r">
              {tabs.map((t) => (
                <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => openSettings(t.id)}
                  className={cn('flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm', tab === t.id ? 'bg-card2 text-fg' : 'text-mute hover:bg-card hover:text-fg')}>
                  {t.icon}{t.label}
                </button>
              ))}
            </nav>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'model' && <ModelSettings />}
            {tab === 'keys' && <KeysSettings />}
            {tab === 'account' && <AccountSettings />}
            {tab === 'usage' && <UsageSettings />}
            {tab === 'admin' && <AdminSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}
