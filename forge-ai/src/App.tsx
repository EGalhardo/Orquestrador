import { useEffect } from 'react'
import { useStore } from './store/useStore'
import { Sidebar } from './components/Sidebar/Sidebar'
import { ChatView } from './components/Chat/ChatView'
import { WorkspacePanel } from './components/Workspace/WorkspacePanel'
import { SearchDialog } from './components/Search/SearchDialog'
import { Leaderboard } from './components/Leaderboard/Leaderboard'
import { Toasts } from './components/common/Toasts'
import { SettingsDialog } from './components/Settings/SettingsDialog'
import { AuthScreen } from './components/Auth/AuthScreen'
import { Logo } from './components/common/Logo'

export default function App() {
  const view = useStore((s) => s.view)
  const auth = useStore((s) => s.auth)
  useEffect(() => { useStore.getState().initBackend() }, [])
  // Keep process list fresh (cheap GET, only in live mode and when the tab is visible).
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') useStore.getState().refreshProcesses() }, 3000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); useStore.getState().setSearch(true) }
      if (mod && e.shiftKey && e.key.toLowerCase() === 'o') { e.preventDefault(); useStore.getState().newChat() }
      if (e.key === 'Escape') useStore.getState().closeFile()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  if (auth === 'unknown') return <div className="grid h-dvh place-items-center" aria-busy="true"><Logo className="h-8 animate-pulse opacity-60" /></div>
  if (auth === 'signedOut') return <><AuthScreen /><Toasts /></>
  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar />
      {view === 'leaderboard' ? <Leaderboard /> : <ChatView />}
      <WorkspacePanel />
      <SearchDialog />
      <SettingsDialog />
      <Toasts />
    </div>
  )
}
