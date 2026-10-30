import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Activity, AgentId, Attachment, Conversation, Message, Workspace } from '../types'
import { seedConversations, seedWorkspaces } from '../services/seed'
import { FileService } from '../services/fileService'
import { AgentService } from '../services/agentService'
import { uid, walk } from '../lib/utils'
import { Api, session, UNAUTHORIZED_EVENT, type PublicConfig, type ProcInfo, type User, type AuthStatus, type RemoteConversation } from '../services/api'

export type View = 'chat' | 'leaderboard'
export type SettingsTab = 'model' | 'keys' | 'account' | 'usage' | 'admin'
export interface Toast { id: string; text: string; tone: 'info' | 'success' | 'error' }
export interface OpenFile { path: string; showDiff: boolean }

interface State {
  conversations: Conversation[]
  workspaces: Workspace[]
  activeId: string | null
  view: View
  agent: AgentId
  sidebarOpen: boolean
  workspaceOpen: boolean
  searchOpen: boolean
  openFile: OpenFile | null
  toasts: Toast[]
  selectedPath: string | null
  /** live = real AI via backend; demo = local rule-based planner */
  mode: 'live' | 'demo'
  backend: PublicConfig | null
  backendOnline: boolean
  project: string
  projects: string[]
  settingsOpen: boolean
  settingsTab: SettingsTab
  /** unknown = still checking; signedOut = show login; signedIn = live; offline = no backend (demo) */
  auth: 'unknown' | 'signedOut' | 'signedIn' | 'offline'
  authStatus: AuthStatus | null
  user: User | null
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  setUser: (u: User) => void
  setBackend: (b: PublicConfig) => void
  continueDemo: () => void
  openSettings: (tab?: SettingsTab) => void
  processes: ProcInfo[]
  previewId: string | null
  refreshProcesses: () => Promise<void>
  openPreview: (id: string | null) => void
  startProcess: (command: string) => Promise<void>
  processAction: (id: string, action: 'stop' | 'restart' | 'remove') => Promise<void>
  setSettings: (v: boolean) => void
  setMode: (m: 'live' | 'demo') => void
  setProject: (p: string) => void
  initBackend: () => Promise<void>
  refreshWorkspace: () => Promise<void>
  saveConfig: (c: Parameters<typeof Api.saveConfig>[0]) => Promise<void>
  createProject: (name: string) => Promise<void>

  setView: (v: View) => void
  setAgent: (a: AgentId) => void
  toggleSidebar: (v?: boolean) => void
  toggleWorkspace: (v?: boolean) => void
  setSearch: (v: boolean) => void
  newChat: () => void
  selectChat: (id: string) => void
  renameChat: (id: string, title: string) => void
  deleteChat: (id: string) => void
  openFileView: (path: string, showDiff?: boolean) => void
  closeFile: () => void
  selectPath: (p: string | null) => void
  toast: (text: string, tone?: Toast['tone']) => void
  dismissToast: (id: string) => void
  setServer: (id: string, status: Workspace['servers'][number]['status']) => void
  send: (text: string, attachments: Attachment[]) => Promise<void>
  stop: () => void
  /** Restore the project files to the checkpoint taken before this agent message's task. */
  undoMessage: (messageId: string) => Promise<void>
}

let controller: AbortController | null = null
/** Login succeeded on the server but the session did not stick: never fail silently. */
let lastAuthError = ''
const assertSignedIn = (get: () => { auth: string }) => {
  if (get().auth !== 'signedIn') throw new Error(`O login foi aceite, mas a sessão não foi confirmada (${lastAuthError || 'sem detalhe'}). Recarrega a página e tenta novamente.`)
}
const SEED_IDS = new Set(seedConversations().map((c) => c.id))

const toRemote = (c: Conversation, project: string) => ({
  title: c.title, project: project || undefined, createdAt: c.createdAt,
  data: { workspaceId: c.workspaceId, messages: c.messages, state: c.state === 'working' ? 'stopped' : c.state },
})
const fromRemote = (r: RemoteConversation): Conversation => ({
  id: r.id, title: r.title, createdAt: r.createdAt, updatedAt: r.updatedAt,
  workspaceId: String(r.workspaceId ?? 'ws-1'), messages: (r.messages as Message[]) ?? [],
  state: r.state === 'working' ? 'stopped' : ((r.state as Conversation['state']) ?? 'idle'),
})

/** Debounced upload of changed conversations (object identity changes on every update). */
let lastSaved = new Map<string, Conversation>()
let syncTimer: ReturnType<typeof setTimeout> | null = null
async function flushSync() {
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null }
  const s = useStore.getState()
  if (s.auth !== 'signedIn') return
  const dirty = s.conversations.filter((c) => lastSaved.get(c.id) !== c)
  for (const c of dirty) {
    lastSaved.set(c.id, c)
    try { await Api.saveConversation(c.id, toRemote(c, s.project)) }
    catch { lastSaved.delete(c.id) } // retried on next change
  }
}
const scheduleSync = (delay: number) => { if (syncTimer) clearTimeout(syncTimer); syncTimer = setTimeout(() => { flushSync() }, delay) }
let refreshTimer: ReturnType<typeof setTimeout> | null = null
/** Debounced reload of the file tree after commands (they may create/delete files). */
const scheduleRefresh = () => {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => { refreshTimer = null; useStore.getState().refreshWorkspace() }, 400)
}

const patchConv = (s: State, id: string, fn: (c: Conversation) => Conversation) => ({
  conversations: s.conversations.map((c) => (c.id === id ? fn(c) : c)),
})
const patchLastMsg = (c: Conversation, fn: (m: Message) => Message): Conversation => ({
  ...c, messages: c.messages.map((m, i) => (i === c.messages.length - 1 ? fn(m) : m)),
})
const addChild = (list: Activity[], pid: string, child: Activity): Activity[] => {
  let found = false
  const walk = (l: Activity[]): Activity[] => l.map((a) => { if (a.id === pid) { found = true; return { ...a, children: [...(a.children ?? []), child] } } return a.children ? { ...a, children: walk(a.children) } : a })
  const out = walk(list)
  return found ? out : [...list, child]
}
const deepUpdate = (list: Activity[], id: string, patch: Partial<Activity>): Activity[] =>
  list.map((a) => (a.id === id ? { ...a, ...patch } : a.children ? { ...a, children: deepUpdate(a.children, id, patch) } : a))

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      conversations: seedConversations(),
      workspaces: seedWorkspaces(),
      activeId: 'c-1',
      view: 'chat',
      agent: 'agent',
      sidebarOpen: typeof window !== 'undefined' ? window.innerWidth >= 1024 : true,
      workspaceOpen: typeof window !== 'undefined' ? window.innerWidth >= 1280 : true,
      searchOpen: false,
      openFile: null,
      toasts: [],
      selectedPath: null,
      mode: 'demo',
      backend: null,
      backendOnline: false,
      project: 'demo-app',
      projects: [],
      settingsOpen: false,
      settingsTab: 'model',
      auth: 'unknown',
      authStatus: null,
      user: null,
      openSettings: (settingsTab = 'model') => set({ settingsOpen: true, settingsTab }),
      setUser: (user) => set({ user }),
      setBackend: (backend) => set({ backend }),
      login: async (email, password) => { await Api.login(email, password); await get().initBackend(); assertSignedIn(get) },
      register: async (name, email, password) => { await Api.register(name, email, password); await get().initBackend(); assertSignedIn(get) },
      logout: async () => {
        controller?.abort()
        await flushSync().catch(() => undefined)
        await Api.logout().catch(() => undefined)
        // Nothing from this account stays in the browser.
        set((s) => ({ user: null, auth: 'signedOut', conversations: [], activeId: null, processes: [], previewId: null, projects: [], openFile: null, backend: null,
          settingsOpen: false, workspaces: s.workspaces.map((w, i) => (i === 0 ? { ...w, root: [], servers: [] } : w)) }))
        get().authStatus || set({ authStatus: await Api.authStatus().catch(() => null) })
      },
      continueDemo: () => set({ auth: 'offline', mode: 'demo', conversations: seedConversations(), activeId: 'c-1', workspaces: seedWorkspaces() }),
      processes: [],
      previewId: null,
      refreshProcesses: async () => {
        if (get().mode !== 'live' || get().auth !== 'signedIn') return
        try {
          const processes = await Api.listProcesses()
          const prev = get().processes
          // Auto-open the preview the first time a server of the current project becomes ready.
          const ready = processes.find((p) => p.project === get().project && p.status === 'running' && p.previewPort && !prev.some((q) => q.id === p.id && q.status === 'running'))
          set({ processes, backendOnline: true })
          if (ready && !get().previewId) { set({ previewId: ready.id, openFile: null }); get().toast(`Servidor pronto na porta ${ready.port}`, 'success') }
          const cur = get().previewId
          if (cur && !processes.some((p) => p.id === cur)) set({ previewId: null })
        } catch { /* backend offline: keep last state */ }
      },
      openPreview: (previewId) => set({ previewId, openFile: null }),
      startProcess: async (command) => {
        try {
          const p = await Api.startProcess(get().project, command)
          await get().refreshProcesses()
          get().toast(p.status === 'running' ? `A correr na porta ${p.port}` : 'A iniciar…', 'success')
        } catch (e) { get().toast((e as Error).message, 'error') }
      },
      processAction: async (id, action) => {
        try {
          if (action === 'stop') await Api.stopProcess(id)
          if (action === 'restart') await Api.restartProcess(id)
          if (action === 'remove') { await Api.removeProcess(id); if (get().previewId === id) set({ previewId: null }) }
          await get().refreshProcesses()
        } catch (e) { get().toast((e as Error).message, 'error') }
      },
      setSettings: (settingsOpen) => set({ settingsOpen }),
      setMode: (mode) => { set({ mode }); get().refreshWorkspace() },
      setProject: (project) => set({ project }),

      initBackend: async () => {
        let status: AuthStatus
        try { status = await Api.authStatus() } catch { set({ backendOnline: false, mode: 'demo', auth: 'offline' }); return }
        set({ backendOnline: true, authStatus: status })
        let user: User
        try { user = await Api.me() } catch (e) {
          lastAuthError = (e as Error).message
          set({ auth: 'signedOut', user: null, mode: 'live' }); return
        }
        lastAuthError = ''
        // The session is valid from here on: data loading problems must not bounce the user to the login page.
        set({ user, auth: 'signedIn', mode: 'live' })
        const [backend, projects, remote] = await Promise.all([
          Api.getConfig().catch((e) => { get().toast(`Falha a carregar as definições: ${e.message}`, 'error'); return null }),
          Api.listProjects().catch((e) => { get().toast(`Falha a carregar os projetos: ${e.message}`, 'error'); return [] as string[] }),
          Api.listConversations().catch((e) => { get().toast(`Falha a carregar as conversas: ${e.message}`, 'error'); return null }),
        ])
        const project = projects.includes(get().project) ? get().project : projects[0] ?? ''
        let conversations = (remote ?? []).map(fromRemote)
        // First sign-in on this browser: bring over conversations made before accounts existed.
        if (remote && !remote.length) {
          const local = get().conversations.filter((c) => !SEED_IDS.has(c.id) && c.messages.length)
          for (const c of local) await Api.saveConversation(c.id, toRemote(c, project)).catch(() => undefined)
          if (local.length) conversations = local
        }
        lastSaved = new Map(conversations.map((c) => [c.id, c]))
        const activeId = conversations.some((c) => c.id === get().activeId) ? get().activeId : null
        set((s) => ({ backend, projects, project, conversations, activeId,
          workspaces: s.workspaces.map((w, i) => (i === 0 ? { ...w, servers: [] } : w)) }))
        await get().refreshWorkspace()
        await get().refreshProcesses()
        if (backend && !backend.configured) set({ settingsOpen: true, settingsTab: 'model' })
      },
      refreshWorkspace: async () => {
        if (get().mode !== 'live') { set((s) => ({ workspaces: s.workspaces.map((w, i) => (i === 0 ? { ...w, root: seedWorkspaces()[0].root, servers: seedWorkspaces()[0].servers } : w)) })); return }
        set((s) => ({ workspaces: s.workspaces.map((w, i) => (i === 0 ? { ...w, servers: [] } : w)) }))
        try {
          let root = await Api.loadWorkspace()
          // Preserve "previous" content (diffs) of files the agent changed earlier.
          const prev = new Map<string, string>()
          walk(get().workspaces[0].root, (n, p) => { if (n.type === 'file' && n.previous !== undefined) prev.set(p, n.previous) })
          for (const [p, v] of prev) root = FileService.setPrevious(root, p, v)
          set((s) => ({ workspaces: s.workspaces.map((w, i) => (i === 0 ? { ...w, root } : w)), projects: root.map((r) => r.name) }))
        } catch (e) { get().toast(`Falha a carregar o workspace: ${(e as Error).message}`, 'error') }
      },
      saveConfig: async (c) => {
        const backend = await Api.saveConfig(c)
        set({ backend })
        get().toast(backend.configured ? `Ligado a ${backend.provider} · ${backend.model}` : 'Configuração guardada', 'success')
      },
      createProject: async (name) => {
        await Api.createProject(name)
        set({ project: name })
        await get().refreshWorkspace()
        get().toast(`Projecto ${name} criado`, 'success')
      },

      setView: (view) => set({ view }),
      setAgent: (agent) => set({ agent }),
      toggleSidebar: (v) => set((s) => ({ sidebarOpen: v ?? !s.sidebarOpen })),
      toggleWorkspace: (v) => set((s) => ({ workspaceOpen: v ?? !s.workspaceOpen })),
      setSearch: (searchOpen) => set({ searchOpen }),
      newChat: () => set({ activeId: null, view: 'chat', openFile: null }),
      selectChat: (id) => set({ activeId: id, view: 'chat', openFile: null }),
      renameChat: (id, title) => set((s) => patchConv(s, id, (c) => ({ ...c, title }))),
      deleteChat: (id) => {
        set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id), activeId: s.activeId === id ? null : s.activeId }))
        lastSaved.delete(id)
        if (get().auth === 'signedIn') Api.deleteConversation(id).catch((e) => get().toast(`Falha a apagar no servidor: ${e.message}`, 'error'))
        get().toast('Conversation deleted')
      },
      openFileView: (path, showDiff = false) => set({ openFile: { path, showDiff }, selectedPath: path, previewId: null }),
      closeFile: () => set({ openFile: null }),
      selectPath: (selectedPath) => set({ selectedPath }),
      toast: (text, tone = 'info') => {
        const id = uid()
        set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
        setTimeout(() => get().dismissToast(id), 3500)
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      setServer: (id, status) =>
        set((s) => ({ workspaces: s.workspaces.map((w) => ({ ...w, servers: w.servers.map((sv) => (sv.id === id ? { ...sv, status } : sv)) })) })),

      undoMessage: async (messageId) => {
        const conv = get().conversations.find((c) => c.messages.some((m) => m.id === messageId))
        const msg = conv?.messages.find((m) => m.id === messageId)
        if (!conv || !msg?.checkpoint || msg.checkpoint.undone) return
        const setUndone = (undone: boolean) => set((s) => patchConv(s, conv.id, (c) => ({ ...c, messages: c.messages.map((m) => (m.id === messageId && m.checkpoint ? { ...m, checkpoint: { ...m.checkpoint, undone } } : m)) })))
        try {
          const r = await Api.restoreCheckpoint(get().project, msg.checkpoint.before)
          setUndone(true)
          scheduleRefresh()
          get().toast(`Alterações desfeitas (${r.changed.length} ficheiro${r.changed.length === 1 ? '' : 's'})`, 'success')
        } catch (e) {
          get().toast(`Não foi possível desfazer: ${(e as Error).message}`, 'error')
        }
      },

      stop: () => {
        const id = get().activeId
        if (get().mode === 'live' && id) Api.stop(id).catch(() => undefined)
        controller?.abort()
      },

      send: async (text, attachments) => {
        if (controller) return
        let convId = get().activeId
        const now = Date.now()
        if (!convId) {
          convId = uid()
          const conv: Conversation = { id: convId, title: text.slice(0, 60), createdAt: now, updatedAt: now, workspaceId: get().workspaces[0].id, messages: [], state: 'idle' }
          set((s) => ({ conversations: [conv, ...s.conversations], activeId: convId }))
        }
        const id = convId
        const agent = get().agent
        set((s) => patchConv(s, id, (c) => ({
          ...c, state: 'working', updatedAt: now,
          messages: [...c.messages,
            { id: uid(), role: 'user', content: text, createdAt: now, attachments },
            { id: uid(), role: 'agent', content: '', createdAt: now, activities: [], agent }],
        })))
        set((s) => ({ workspaces: s.workspaces.map((w, i) => (i === 0 ? { ...w, env: 'busy' } : w)) }))

        controller = new AbortController()
        const t0 = Date.now()
        const wsIdx = 0
        const onMsg = (fn: (m: Message) => Message) => set((s) => patchConv(s, id, (c) => patchLastMsg(c, fn)))
        if (get().mode === 'live') {
          const project = get().project
          let finalText = ''
          let failed: string | null = null
          try {
            await Api.run({ conversationId: id, project, agent, instruction: text + (attachments.some((a) => !a.dataUrl) ? `\n\n(Anexos indicados pelo utilizador: ${attachments.filter((a) => !a.dataUrl).map((a) => a.name).join(', ')})` : ''), images: attachments.filter((a) => a.dataUrl).slice(0, 6).map((a) => ({ name: a.name, dataUrl: a.dataUrl! })) }, (e) => {
              switch (e.type) {
                case 'activity': {
                  const a = e.activity
                  const withPrefix = { ...a, kind: a.kind as Activity['kind'], status: a.status as Activity['status'], filePath: a.filePath ? `${project}/${a.filePath}` : undefined, target: a.filePath ? `${project}/${a.filePath}` : a.target }
                  const pid = e.parentId
                  onMsg((m) => ({ ...m, activities: pid ? addChild(m.activities ?? [], pid, withPrefix) : [...(m.activities ?? []), withPrefix] }))
                  break
                }
                case 'update': onMsg((m) => ({ ...m, activities: deepUpdate(m.activities ?? [], e.id, e.patch as Partial<Activity>) })); break
                case 'file': {
                  const full = `${project}/${e.path}`
                  set((s) => ({ workspaces: s.workspaces.map((w, i) => {
                    if (i !== wsIdx) return w
                    if (e.deleted) return { ...w, root: FileService.remove(w.root, full) }
                    const root = FileService.write(w.root, full, e.content ?? '')
                    return { ...w, root: e.previous === null ? root : FileService.setPrevious(root, full, e.previous) }
                  }) }))
                  break
                }
                case 'done': {
                  const ch = e.changed ?? []
                  const cmds = e.commands ?? []
                  const lines: string[] = []
                  if (ch.length) lines.push(`Ficheiros alterados (${ch.length}): ${ch.map((c) => `\`${c}\``).join(', ')}`)
                  else if (agent !== 'review') lines.push('⚠ Nenhum ficheiro foi alterado pelas ferramentas de ficheiros nesta tarefa.')
                  if (cmds.length) lines.push(`Comandos executados (${cmds.length}): ${cmds.map((c) => `\`${c.command}\` ${c.exitCode === 0 ? '✓' : `✕ ${c.exitCode}`}`).join(', ')}`)
                  finalText = `${e.text}\n\n${lines.join('\n')}\n_${e.steps} passos · ${e.usage.input.toLocaleString()} tokens de entrada · ${e.usage.output.toLocaleString()} de saída_`
                  break
                }
                case 'plan': onMsg((m) => ({ ...m, plan: e.items })); break
                case 'checkpoint': onMsg((m) => ({ ...m, checkpoint: { before: e.before, after: e.after } })); break
                case 'files_changed': scheduleRefresh(); break
                case 'processes_changed': get().refreshProcesses(); break
                case 'error': failed = e.message; break
              }
            }, controller.signal)
            if (failed === 'aborted') throw new DOMException('Aborted', 'AbortError')
            if (failed) throw new Error(failed)
            onMsg((m) => ({ ...m, content: finalText || 'Concluído.', elapsedMs: Date.now() - t0, createdAt: Date.now() }))
            scheduleRefresh()
            set((s) => patchConv(s, id, (c) => ({ ...c, state: 'done', updatedAt: Date.now() })))
            get().toast('Tarefa concluída', 'success')
          } catch (e) {
            const aborted = (e as Error).name === 'AbortError'
            onMsg((m) => ({ ...m, content: aborted ? 'Tarefa interrompida pelo utilizador.' : `Erro: ${(e as Error).message}`, elapsedMs: Date.now() - t0,
              activities: [...(m.activities ?? []).map((a) => (a.status === 'loading' ? { ...a, status: 'warning' as const } : a)), { id: uid(), kind: 'error', label: aborted ? 'Stopped' : 'Error', status: aborted ? 'warning' : 'error', details: aborted ? undefined : (e as Error).message }] }))
            set((s) => patchConv(s, id, (c) => ({ ...c, state: aborted ? 'stopped' : 'error', updatedAt: Date.now() })))
            if (!aborted) get().toast((e as Error).message.slice(0, 120), 'error')
          } finally {
            controller = null
            set((s) => ({ workspaces: s.workspaces.map((w, i) => (i === 0 ? { ...w, env: 'ready' } : w)) }))
          }
          return
        }

        try {
          const result = await AgentService.provider.run({
            instruction: text + (attachments.length ? ` (attachments: ${attachments.map((a) => a.name).join(', ')})` : ''),
            agent,
            signal: controller.signal,
            root: () => get().workspaces[wsIdx].root,
            emit: (a) => onMsg((m) => ({ ...m, activities: [...(m.activities ?? []), a] })),
            update: (aid, patch) => onMsg((m) => ({ ...m, activities: deepUpdate(m.activities ?? [], aid, patch) })),
            writeFile: (p, content) => set((s) => ({ workspaces: s.workspaces.map((w, i) => (i === wsIdx ? { ...w, root: FileService.write(w.root, p, content) } : w)) })),
            deleteFile: (p) => set((s) => ({ workspaces: s.workspaces.map((w, i) => (i === wsIdx ? { ...w, root: FileService.remove(w.root, p) } : w)) })),
          })
          onMsg((m) => ({ ...m, content: result, elapsedMs: Date.now() - t0, createdAt: Date.now() }))
          set((s) => patchConv(s, id, (c) => ({ ...c, state: 'done', updatedAt: Date.now() })))
          get().toast('Task completed', 'success')
        } catch (e) {
          const aborted = (e as Error).name === 'AbortError'
          onMsg((m) => ({ ...m, content: aborted ? 'Task stopped by user.' : `Task failed: ${String(e)}`, elapsedMs: Date.now() - t0,
            activities: [...(m.activities ?? []), { id: uid(), kind: 'error', label: aborted ? 'Stopped' : 'Error', status: aborted ? 'warning' : 'error' }] }))
          set((s) => patchConv(s, id, (c) => ({ ...c, state: aborted ? 'stopped' : 'error', updatedAt: Date.now() })))
          get().toast(aborted ? 'Agent stopped' : 'Task failed', aborted ? 'info' : 'error')
        } finally {
          controller = null
          set((s) => ({ workspaces: s.workspaces.map((w, i) => (i === 0 ? { ...w, env: 'ready' } : w)) }))
        }
      },
    }),
    {
      name: 'forge-ai-state-v1',
      // Signed-in conversations live on the server; only anonymous/demo ones are cached locally.
      partialize: (s) => ({ conversations: s.auth === 'signedIn' ? [] : s.conversations, activeId: s.activeId, agent: s.agent, project: s.project }),
      onRehydrateStorage: () => (s) => {
        // Any task interrupted by a reload is marked stopped.
        s?.conversations.forEach((c) => { if (c.state === 'working') c.state = 'stopped' })
      },
    },
  ),
)

export const useActiveConversation = () => useStore((s) => s.conversations.find((c) => c.id === s.activeId) ?? null)
export const useIsWorking = () => useStore((s) => s.conversations.some((c) => c.state === 'working'))

if (typeof window !== 'undefined') {
  useStore.subscribe((s, prev) => {
    if (s.auth !== 'signedIn' || s.conversations === prev.conversations) return
    // While the agent streams, save at most every few seconds; otherwise quickly.
    scheduleSync(s.conversations.some((c) => c.state === 'working') ? 4000 : 800)
  })
  window.addEventListener('beforeunload', () => { flushSync() })
  window.addEventListener(UNAUTHORIZED_EVENT, () => {
    const st = useStore.getState()
    if (st.auth !== 'signedIn') return
    session.clear()
    useStore.setState({ auth: 'signedOut', user: null, conversations: [], activeId: null, processes: [], previewId: null })
    st.toast('A sessão terminou. Inicia sessão novamente.', 'error')
  })
}
