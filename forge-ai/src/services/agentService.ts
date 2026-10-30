import type { Activity, AgentId, FileNode } from '../types'
import { sleep, uid, walk } from '../lib/utils'
import { CommandService } from './commandService'

/**
 * Agent Service
 * -------------
 * `AgentProvider` is the integration point for a real LLM backend
 * (e.g. an SSE/WebSocket endpoint). The bundled `LocalPlannerAgent` is NOT an AI:
 * it is a transparent, rule-based planner that performs real operations on the
 * in-browser workspace (search, read, write, sandbox commands) so the UI flow can
 * be exercised end-to-end. It labels its replies accordingly.
 */
export interface AgentContext {
  instruction: string
  agent: AgentId
  root: () => FileNode[]
  signal: AbortSignal
  emit: (a: Activity) => void
  update: (id: string, patch: Partial<Activity>) => void
  writeFile: (path: string, content: string) => void
  deleteFile: (path: string) => void
}
export interface AgentProvider { id: string; run(ctx: AgentContext): Promise<string> }

export const AGENTS: { id: AgentId; label: string; desc: string; available: boolean }[] = [
  { id: 'agent', label: 'Agent', desc: 'General-purpose builder', available: true },
  { id: 'team', label: 'Equipa', desc: 'Orquestrador + especialistas', available: true },
  { id: 'code', label: 'Code Agent', desc: 'Focus on writing code', available: true },
  { id: 'debug', label: 'Debug Agent', desc: 'Find and fix issues', available: true },
  { id: 'review', label: 'Review Agent', desc: 'Read-only code review', available: true },
]

const pascal = (s: string) => s.replace(/[^a-zA-Z0-9 ]/g, ' ').split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')

function pickProject(root: FileNode[], text: string) {
  const t = text.toLowerCase()
  return root.find((n) => t.includes(n.name.toLowerCase().slice(0, 6))) ?? root.find((n) => n.name.startsWith('Plataforma')) ?? root[0]
}

function componentTemplate(name: string, kind: string) {
  if (kind === 'login')
    return `import { useState } from 'react'

export function ${name}() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  return (
    <form className="login-card" onSubmit={(e) => e.preventDefault()}>
      <h1>Entrar</h1>
      <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} type="email" /></label>
      <label>Password<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" /></label>
      <button type="submit" className="btn-primary">Login</button>
    </form>
  )
}
`
  if (kind === 'dashboard')
    return `const stats = [
  { label: 'Utilizadores', value: 0 },
  { label: 'Sessões', value: 0 },
  { label: 'Mensagens', value: 0 },
]

export function ${name}() {
  return (
    <main className="dashboard">
      <h1>Dashboard</h1>
      <div className="grid">
        {stats.map((s) => (
          <article key={s.label}><span>{s.label}</span><strong>{s.value}</strong></article>
        ))}
      </div>
    </main>
  )
}
`
  return `interface ${name}Props {
  title?: string
}

export function ${name}({ title = '${name}' }: ${name}Props) {
  return <div className="${name.toLowerCase()}">{title}</div>
}
`
}

export const LocalPlannerAgent: AgentProvider = {
  id: 'local-planner',
  async run(ctx) {
    const { instruction, signal, emit, update } = ctx
    const text = instruction.toLowerCase()
    const step = async <T,>(a: Omit<Activity, 'id' | 'status'>, fn: () => Promise<T> | T, minMs = 350): Promise<T> => {
      const id = uid()
      const t0 = performance.now()
      emit({ ...a, id, status: 'loading' })
      try {
        await sleep(minMs, signal)
        const r = await fn()
        update(id, { status: 'success', durationMs: Math.round(performance.now() - t0) })
        return r
      } catch (e) {
        if ((e as Error).name === 'AbortError') update(id, { status: 'warning', details: 'Stopped by user' })
        else update(id, { status: 'error', details: String(e) })
        throw e
      }
    }
    const bash = async (cmd: string) => {
      const id = uid()
      emit({ id, kind: 'bash', label: 'used Bash', target: cmd, status: 'loading' })
      const r = await CommandService.run(cmd, ctx.root(), signal).catch((e) => { update(id, { status: 'warning', details: 'Stopped by user' }); throw e })
      update(id, { status: r.exitCode === 0 ? 'success' : r.exitCode === 127 ? 'warning' : 'error', durationMs: r.durationMs, details: r.output })
      return r
    }

    await step({ kind: 'thinking', label: 'Thinking', details: `Planning steps for: "${instruction}"` }, () => undefined, 600)
    const project = pickProject(ctx.root(), text)
    const base = project.name

    // Real project scan
    const files: string[] = []
    await step({ kind: 'search', label: 'Searching project', target: base }, () => {
      walk([project], (n, p) => { if (n.type === 'file' && /\.(tsx?|jsx?|css|json)$/.test(n.name)) files.push(p) })
    })
    await bash(`ls ${base}`)

    const summary: string[] = []
    const isReview = ctx.agent === 'review' || /anali|review|revê|problem|identif/.test(text)
    const wantsTest = /test/.test(text)
    const wantsDelete = /apag|delete|remov/.test(text)
    const wantsCreate = /cria|create|nova|novo|build|constr|add|adiciona|component|página|page/.test(text)
    const wantsEdit = /alter|muda|change|edit|corrig|fix|refactor|melhor|azul|blue|debug|erro|error|bug/.test(text) || ctx.agent === 'debug'

    const readTargets = files.filter((p) => /\.(tsx|ts)$/.test(p) && !p.includes('/ui/') && !p.includes('generated')).slice(0, 3)
    for (const p of readTargets) await step({ kind: 'read', label: 'Reading file', target: p }, () => undefined, 250)

    if (isReview) {
      const r = await bash('npx tsc --noEmit')
      summary.push(r.exitCode === 0 ? `Scanned ${files.length} source files in \`${base}\`; the static bracket check found no issues.` : `Static check reported problems:\n${r.output}`)
    } else if (wantsDelete) {
      const target = files.find((p) => /Widget\d+\.tsx$/.test(p))
      if (target) {
        await step({ kind: 'delete', label: 'Delete', target, filePath: target }, () => ctx.deleteFile(target))
        summary.push(`Deleted \`${target}\`.`)
      } else summary.push('No safe deletion candidate was found.')
    } else if (wantsCreate || (!wantsEdit && !wantsTest)) {
      const kind = /login/.test(text) ? 'login' : /dashboard|painel/.test(text) ? 'dashboard' : 'component'
      const nameWords = instruction.match(/(?:chamad[oa]|named|called)\s+([\w-]+)/i)?.[1]
      const name = pascal(nameWords ?? (kind === 'login' ? 'LoginPage' : kind === 'dashboard' ? 'DashboardPage' : 'NewComponent'))
      const path = `${base}/src/components/${kind === 'component' ? 'ui' : 'pages'}/${name}.tsx`
      await step({ kind: 'create', label: 'Create', target: path, filePath: path }, () => ctx.writeFile(path, componentTemplate(name, kind)), 700)
      summary.push(`Created \`${path}\`.`)
      await bash('npx tsc --noEmit')
    }
    if (wantsEdit && !isReview) {
      const target = readTargets.find((p) => p.endsWith('.tsx')) ?? readTargets[0]
      if (target) {
        let src = ''
        walk(ctx.root(), (n, p) => { if (p === target) src = n.content ?? '' })
        let next = src
        if (/azul|blue/.test(text)) next = src.replace(/<button/g, '<button style={{ background: "#2563eb", color: "white" }}')
        if (next === src) next = `// Reviewed by agent on ${new Date().toLocaleString()} — ${instruction.slice(0, 60)}\n` + src
        await step({ kind: 'edit', label: 'Edit', target, filePath: target }, () => ctx.writeFile(target, next), 600)
        summary.push(`Edited \`${target}\`.`)
        await bash('npx tsc --noEmit')
      }
    }
    if (wantsTest) {
      await step({ kind: 'test', label: 'Testing', target: 'npm test' }, () => undefined, 500)
      const r = await bash('npm test')
      summary.push(r.exitCode === 0 ? 'Checks passed.' : 'Checks failed — see the log above.')
    }
    await step({ kind: 'completed', label: 'Completed', details: `${files.length} files analysed` }, () => undefined, 150)

    return `${summary.join('\n')}\n\nLocal planner mode: no AI model is connected. Actions above ran against the in-browser workspace. Connect an \`AgentProvider\` in \`src/services/agentService.ts\` to use a real model.`
  },
}

export const AgentService = { provider: LocalPlannerAgent as AgentProvider }
