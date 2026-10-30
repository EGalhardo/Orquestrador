import { callLLM, LlmError, parseDataUrl, type Msg, type LlmTurn, type ImagePart } from './llm.ts'
import { getGithub } from './config.ts'
import { closeSession } from './browser.ts'
import * as checkpoints from './checkpoints.ts'
import { TOOL_DEFS, runTool, headTail } from './tools.ts'
import type { Config } from './config.ts'
import * as repo from './repo.ts'
import { listFiles } from './projectFs.ts'
import * as procs from './processes.ts'

export type AgentEvent =
  | { type: 'activity'; activity: { id: string; kind: string; label: string; target?: string; status: string; filePath?: string; details?: string; children?: unknown[] }; parentId?: string }
  | { type: 'update'; id: string; patch: Record<string, unknown> }
  | { type: 'file'; path: string; content: string | null; previous: string | null; deleted?: boolean }
  | { type: 'text'; text: string }
  | { type: 'done'; text: string; usage: { input: number; output: number }; steps: number; changed: string[]; commands: { command: string; exitCode: number }[] }
  | { type: 'files_changed' }
  | { type: 'processes_changed' }
  | { type: 'error'; message: string }
  | { type: 'plan'; items: repo.PlanItem[] }
  | { type: 'checkpoint'; before: string; after?: string }

export const MAX_STEPS = Math.max(5, Number(process.env.FORGE_MAX_STEPS) || 150)
/** Rough context budget in tokens (chars/4). Local models get a much smaller window. */
export function contextBudget(cfg: Config) {
  const env = Number(process.env.FORGE_CONTEXT_BUDGET)
  if (env > 0) return env
  return cfg.provider === 'ollama' ? 24_000 : 150_000
}

const PERSONAS: Record<string, string> = {
  agent: 'You are a general-purpose software engineering agent.',
  code: 'You are a coding agent focused on writing clean, complete, production-quality code.',
  debug: 'You are a debugging agent. Find the root cause, explain it briefly, then fix it with minimal changes.',
  review: 'You are a code review agent. Do NOT modify files. Read the code and report issues, risks and concrete suggestions.',
  team: `You are the ORCHESTRATOR (tech lead) of a team of AI agents. You do NOT write code yourself: you plan, delegate and verify.
How to work:
1. Inspect the project (list_files/read_file) and call update_plan with the steps.
2. For each step, call delegate with the right specialist and a precise, self-contained task (files to create/change, API contracts, data shapes, acceptance criteria). Specialists do not see this conversation — give them all the context they need, including decisions made by previous specialists (e.g. API routes and JSON fields).
3. Read each specialist's report. Verify yourself (run_command build/tests, start_process, inspect_app/browser). If something is wrong, delegate a fix with the exact error.
4. Delegate a final review to "reviewer" for non-trivial work, and fix what matters.
Delegate sequentially (one specialist at a time); keep tasks focused (one area each).`,
}

/** Specialists the orchestrator can delegate to. */
export const ROLES: Record<string, { label: string; persona: string; readOnly?: boolean }> = {
  backend: { label: 'Backend', persona: 'You are the BACKEND specialist: APIs, database schema/migrations, validation, server logic and API tests.' },
  frontend: { label: 'Frontend', persona: 'You are the FRONTEND specialist: UI components, pages, routing, state, forms, styling, accessibility and responsive layout. Match the API contract you are given exactly.' },
  tests: { label: 'Testes', persona: 'You are the QA/TEST specialist: write and run automated tests, use the browser tool to exercise the app like a user, and fix the bugs you find (or report them precisely).' },
  fullstack: { label: 'Fullstack', persona: 'You are a FULLSTACK engineer: implement the task end to end.' },
  devops: { label: 'DevOps', persona: 'You are the DEVOPS specialist: project setup, dependencies, scripts, build config, git/GitHub operations.' },
  reviewer: { label: 'Revisor', persona: 'You are the CODE REVIEWER. Do NOT modify files. Read the code, run build/tests if useful, and report concrete problems (file:line, why, how to fix) ordered by severity. Be concise.', readOnly: true },
}
export const SUB_MAX_STEPS = Math.max(5, Number(process.env.FORGE_SUB_MAX_STEPS) || 60)
const WRITE_TOOLS = ['write_file', 'edit_file', 'delete_file', 'append_file', 'use_template']

export const DELEGATE_DEF = {
  name: 'delegate',
  description: `Assign a task to a specialist sub-agent, which works autonomously in the same project (with file, shell, server, browser and GitHub tools) and returns a report. Roles: ${Object.entries(ROLES).map(([k, v]) => `"${k}" (${v.label})`).join(', ')}. Give a complete, self-contained task description.`,
  parameters: { type: 'object', properties: {
    role: { type: 'string', enum: Object.keys(ROLES), description: 'Specialist' },
    task: { type: 'string', description: 'What to do, with all needed context, file names, contracts and acceptance criteria' },
  }, required: ['role', 'task'] },
}

const KIND: Record<string, string> = { read_image: 'read', browser: 'search', github: 'command', delegate: 'command', append_file: 'edit', update_plan: 'thinking', inspect_app: 'search', use_template: 'create', list_files: 'search', read_file: 'read', write_file: 'create', edit_file: 'edit', delete_file: 'delete', search_files: 'search', run_command: 'bash', start_process: 'command', get_process_logs: 'read', stop_process: 'command' }
const LABEL: Record<string, string> = { read_image: 'Viewed image', browser: 'Browser', github: 'GitHub', append_file: 'Append', update_plan: 'Updated plan', inspect_app: 'Inspected app in browser', use_template: 'Applied template', list_files: 'Listing files', read_file: 'Reading file', write_file: 'Write', edit_file: 'Edit', delete_file: 'Delete', search_files: 'Searching project', run_command: 'used Bash', start_process: 'Started server', get_process_logs: 'Reading server logs', stop_process: 'Stopped server' }

/** Conversation histories live in SQLite (agent_histories); one active run per conversation. */
export const resetHistory = (conversationId: string) => repo.clearHistory(conversationId)

/**
 * Keep the context bounded: very old tool outputs are shortened (the model already acted on them).
 * The most recent turns are kept intact.
 */
export function compact(h: Msg[], keepRecent = 12) {
  const cutoff = h.length - keepRecent
  for (let i = 0; i < cutoff; i++) {
    const m = h[i]
    if (m.role === 'user' && m.auto && m.images?.length) { m.images = undefined; m.content += ' (imagem antiga removida para poupar contexto)' }
    if (m.role === 'tool') for (const r of m.results ?? []) if (r.output.length > 600) r.output = `${r.output.slice(0, 300)}\n…(old output shortened)…\n${r.output.slice(-200)}`
    if (m.role === 'assistant') for (const c of m.toolCalls ?? []) if (c.args?.content && c.args.content.length > 600) c.args = { ...c.args, content: `${c.args.content.slice(0, 200)}\n…(old content shortened; read the file for the current version)…` }
  }
}

/** Gemini free tier has small per-model daily quotas; these models have separate quotas. */
export const GEMINI_FALLBACKS = (process.env.FORGE_GEMINI_FALLBACKS || 'gemini-3.8-flash,gemini-3.7-flash,gemini-3.6-flash,gemini-3.5-flash,gemini-3-flash-preview,gemini-flash-latest,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite').split(',').map((s) => s.trim()).filter(Boolean)

/** Gemini models whose DAILY quota ran out, per API key, until the next reset (midnight US Pacific). */
const quotaOut = new Map<string, number>()
const qKey = (apiKey: string, model: string) => `${apiKey.slice(-12)}|${model}`
function nextPacificMidnight(now = Date.now()) {
  // Pacific is UTC-7 (summer) / UTC-8; using 07:00 UTC is at worst one hour early (a harmless extra try).
  const d = new Date(now); const r = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 7)
  return r > now ? r : r + 86400000
}
export const isQuotaOut = (apiKey: string, model: string) => (quotaOut.get(qKey(apiKey, model)) ?? 0) > Date.now()
export const markQuotaOut = (apiKey: string, model: string) => quotaOut.set(qKey(apiKey, model), nextPacificMidnight())

/** Should we switch to another model instead of failing? (quota exhausted, or still overloaded after all retries) */
export function shouldSwitchModel(e: unknown) {
  return e instanceof LlmError && (e.hardQuota || e.status === 503 || e.status === 529 || e.status === 404)
}

export const estimateTokens = (h: Msg[]) => Math.ceil(JSON.stringify(h).length / 4)

/**
 * Mid-run context management. Stage 1: shorten old outputs (compact). Stage 2: drop the oldest
 * turns, cutting only at a user message or before an assistant turn so tool calls stay paired
 * with their results, and leave a note so the model knows to re-read files. The first user
 * message (the original request) is always kept.
 */
export function fitContext(h: Msg[], budget: number): boolean {
  if (estimateTokens(h) <= budget) return false
  compact(h, 6)
  if (estimateTokens(h) <= budget * 0.9) return true
  const firstUser = Math.max(0, h.findIndex((m) => m.role === 'user'))
  const isNote = (m?: Msg) => m?.role === 'user' && m.content.startsWith('[Context note]')
  const hasNote = isNote(h[firstUser + 2])
  let dropped = 0
  while (estimateTokens(h) > budget * 0.7) {
    const start = firstUser + (hasNote || dropped ? 3 : 1)
    let end = start + 1
    while (end < h.length && h[end].role !== 'assistant') end++ // group = [assistant, tool results, later user msgs]
    if (end >= h.length - 4) break // always keep the most recent turns
    h.splice(start, end - start)
    dropped++
    if (dropped === 1 && !hasNote) h.splice(firstUser + 1, 0, { role: 'assistant', text: 'Continuing.', toolCalls: [] }, { role: 'user', content: '[Context note]' })
  }
  if (dropped || hasNote) {
    const prev = hasNote ? Number((h[firstUser + 2] as { content: string }).content.match(/(\d+) older/)?.[1] ?? 0) : 0
    ;(h[firstUser + 2] as { content: string }).content = `[Context note] ${prev + dropped} older step(s) were removed to fit the context window. The files on disk are the source of truth: use list_files / read_file to re-check anything you need. Continue from the current plan.`
  }
  return true
}

function planText(plan: repo.PlanItem[]) {
  if (!plan.length) return 'No plan yet. For multi-step work call update_plan first.'
  const mark = { done: '[x]', in_progress: '[>]', pending: '[ ]' }
  return plan.map((p, i) => `${mark[p.status] ?? '[ ]'} ${i + 1}. ${p.title}`).join('\n')
}

export function normalisePlan(raw: unknown): repo.PlanItem[] | null {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return null } }
  if (!Array.isArray(v)) return null
  const items = v.map((x) => ({ title: String((x as { title?: unknown })?.title ?? x ?? '').trim().slice(0, 200), status: (['pending', 'in_progress', 'done'].includes((x as { status?: string })?.status ?? '') ? (x as { status: string }).status : 'pending') as repo.PlanItem['status'] })).filter((x) => x.title)
  return items.slice(0, 40)
}

export interface RunOptions {
  userId: number; config: Config; conversationId: string; project: string; agent: string; instruction: string; signal: AbortSignal; emit: (e: AgentEvent) => void
  /** Images attached by the user to this instruction. */
  images?: ImagePart[]
  /** Set when this run is a specialist working for the orchestrator (ephemeral: no DB history/plan/checkpoint/usage). */
  sub?: { role: string; browserKey: string }
}

export async function runAgent(opts: RunOptions) {
  const { project, signal, emit } = opts
  const sub = opts.sub
  const cfg = { ...opts.config }
  const exhausted = new Set<string>()
  if (cfg.provider === 'gemini' && isQuotaOut(cfg.apiKey ?? '', cfg.model)) {
    const alt = GEMINI_FALLBACKS.find((m) => !isQuotaOut(cfg.apiKey ?? '', m))
    if (alt) cfg.model = alt // skip models known to be out of daily quota
  }
  const maxSteps = sub ? SUB_MAX_STEPS : MAX_STEPS
  const role = sub ? ROLES[sub.role] ?? ROLES.fullstack : null
  const readOnly = opts.agent === 'review' || !!role?.readOnly
  const browserKey = sub?.browserKey ?? `run:${opts.conversationId}:${Date.now()}`
  const toolCtx = { github: getGithub(opts.userId), browserKey }
  let plan: repo.PlanItem[] = sub ? [] : repo.loadPlan(opts.conversationId)
  const buildSystem = async () => {
  const files = await listFiles(project).catch(() => [])
  const persona = role ? `${role.persona}
You are a member of an AI team led by an orchestrator, who gave you ONE task. Do only that task, completely. Work autonomously; don't ask questions.
When finished, reply (no tool calls) with a concise REPORT for the orchestrator: files created/changed, contracts (routes, fields, component names) others must know, how you verified it, and anything left unresolved.` : PERSONAS[opts.agent] ?? PERSONAS.agent
  return `${persona}
You work inside the project "${project}". All paths are relative to its root.
Running background processes: ${procs.list(project).filter((p) => p.status === 'running' || p.status === 'starting').map((p) => `${p.id} "${p.command}" (${p.status}${p.port ? `, port ${p.port}` : ''})`).join('; ') || 'none'}
Current files (${files.length}):
${files.slice(0, 300).join('\n')}${files.length > 300 ? `\n…and ${files.length - 300} more` : ''}

Current plan:
${planText(plan)}

Rules:
- For any task with more than ~3 steps, call update_plan FIRST with the full list of steps, and update it as you progress (one step in_progress at a time). Work through the plan step by step until every step is done.
- For a NEW app in an empty or near-empty project, start with use_template (when it fits) instead of writing boilerplate, then run "npm install", then read AGENTS.md.
- Use the tools to inspect and change files. Read a file before editing it.
- To CREATE a new file use write_file (path + full content). Use edit_file only for existing files.
- Keep files small and focused (split into components/modules, ideally < 250 lines). For a larger file, write the first part with write_file and the rest with append_file.
- Work autonomously: never ask the user for clarification when you can make a reasonable choice. If a tool returns an error, fix your call and try again.
- Only stop calling tools when the whole task (every plan step) is done.
- Write COMPLETE, working code. Never leave placeholders like "// rest of code" or "TODO".
- You can run shell commands with run_command (sandboxed, project root). Install dependencies with "npm install" when package.json changes or node_modules is missing.
- After changing code, VERIFY it: run "npm run build" and the tests (npm test) if present. If it fails, read the error, fix the code and run it again until it passes.
- To run a dev server (npm run dev / start) use start_process, never run_command. The user then sees a live preview. Don't start the same server twice (it hot-reloads).
- To test interactions like a user (fill forms, click, select), use the browser tool (open/fill/click/select/state); it reports console errors and failed requests caused by each action.
- If the user attached images or asks about an image file in the project, use read_image to look at it (e.g. a design to replicate).
- For GitHub (clone, commit, push, pull, branches, PRs) use the github tool; never print tokens.
- Then call inspect_app to open it in a real browser: fix every console error, exception and failed request it reports, and check the visible text matches what you built. Inspect each important page (path).
- Test API endpoints with curl via run_command (e.g. curl -s localhost:PORT/api/...).
- Answer in the same language as the user. Finish with a short summary of what you built and how it was verified.`
  }

  const history: Msg[] = sub ? [] : repo.loadHistory<Msg>(opts.conversationId)
  const persist = () => { if (!sub) try { repo.saveHistory(opts.conversationId, history) } catch { /* best effort */ } }
  compact(history)
  history.push({ role: 'user', content: opts.instruction, ...(opts.images?.length ? { images: opts.images.slice(0, 6) } : {}) })
  const usage = { input: 0, output: 0 }
  let stepsTaken = 0
  const budget = contextBudget(cfg)
  // Checkpoint before the task so everything it does can be undone.
  const before = readOnly || sub ? null : await checkpoints.snapshot(project, `Antes: ${opts.instruction.slice(0, 120)}`).catch((e) => { console.warn('[checkpoint]', e.message); return null })
  try {
    return await loop()
  } finally {
    persist()
    if (!sub) await closeSession(browserKey).catch(() => undefined)
    if (before) {
      const after = await checkpoints.snapshot(project, `Depois: ${opts.instruction.slice(0, 120)}`).catch(() => null)
      if (after && after !== before) emit({ type: 'checkpoint', before, after })
    }
    if (!sub) repo.recordUsage({ userId: opts.userId, conversationId: opts.conversationId, provider: cfg.provider, model: cfg.model, input: usage.input, output: usage.output, steps: stepsTaken })
  }

  /** Run a specialist sub-agent for the orchestrator; its activity is nested under `parentId`. */
  async function delegate(roleName: string, task: string, parentId: string) {
    let report = '', subChanged: string[] = [], subSteps = 0
    const subUsage = { input: 0, output: 0 }
    await runAgent({
      ...opts, config: { ...cfg }, agent: 'agent', instruction: `${task}\n\n(Plano geral da equipa, para contexto:\n${planText(plan)})`, images: undefined,
      sub: { role: roleName, browserKey },
      emit: (e) => {
        if (e.type === 'activity') emit({ ...e, parentId: e.parentId ?? parentId })
        else if (e.type === 'done') { report = e.text; subChanged = e.changed; subSteps = e.steps; subUsage.input = e.usage.input; subUsage.output = e.usage.output }
        else if (e.type === 'plan' || e.type === 'checkpoint') { /* specialist plans stay internal */ }
        else if (e.type === 'text') { /* intermediate narration not shown */ }
        else emit(e)
      },
    })
    usage.input += subUsage.input; usage.output += subUsage.output
    return { report, changed: subChanged, steps: subSteps }
  }

  async function loop() {

  let n = 0
  let nudges = 0
  const changed = new Set<string>()
  const commands: { command: string; exitCode: number }[] = []
  const toolImages: ImagePart[] = []
  for (let step = 1; step <= maxSteps; step++) {
    stepsTaken = step
    const thinkId = `t${step}-${Date.now()}`
    emit({ type: 'activity', activity: { id: thinkId, kind: 'thinking', label: 'Thinking', status: 'loading' } })
    const t0 = Date.now()
    if (fitContext(history, budget)) emit({ type: 'activity', activity: { id: `c${step}-${Date.now()}`, kind: 'thinking', label: 'Compacted context', status: 'success', details: `~${estimateTokens(history)} tokens after compaction (budget ${budget})` } })
    let turn: LlmTurn
    try {
      const tools = opts.agent === 'team' && !sub ? [...TOOL_DEFS.filter((t) => !WRITE_TOOLS.includes(t.name)), DELEGATE_DEF]
        : readOnly ? TOOL_DEFS.filter((t) => !WRITE_TOOLS.includes(t.name) && t.name !== 'github') : TOOL_DEFS
      const call = () => callLLM(cfg, buildSystemCached, history, tools, {
        signal,
        onRetry: ({ attempt, waitMs, reason }) => emit({ type: 'update', id: thinkId, patch: { label: `Waiting to retry (${attempt}) · ${Math.ceil(waitMs / 1000)}s`, status: 'loading', details: reason, retry: { attempt, waitMs, reason } } }),
      })
      const buildSystemCached = await buildSystem()
      for (;;) {
        try { turn = await call(); break } catch (e) {
          if (cfg.provider !== 'gemini' || !shouldSwitchModel(e) || signal.aborted) throw e
          exhausted.add(cfg.model)
          if ((e as LlmError).hardQuota) markQuotaOut(cfg.apiKey ?? '', cfg.model)
          const next = GEMINI_FALLBACKS.find((m) => !exhausted.has(m) && !isQuotaOut(cfg.apiKey ?? '', m))
          if (!next) throw e
          const why = (e as LlmError).hardQuota ? 'quota esgotada' : `indisponível (${(e as LlmError).status})`
          emit({ type: 'activity', activity: { id: `m${step}-${Date.now()}`, kind: 'thinking', label: 'Switched model', target: `${cfg.model} → ${next}`, status: 'warning', details: `${cfg.model}: ${why}. A continuar com ${next}.` } })
          cfg.model = next
        }
      }
    } catch (e) {
      emit({ type: 'update', id: thinkId, patch: { label: 'Thinking', retry: null, status: (e as Error).name === 'AbortError' ? 'warning' : 'error', durationMs: Date.now() - t0, details: (e as Error).message } })
      throw e
    }
    usage.input += turn.usage.input; usage.output += turn.usage.output
    emit({ type: 'update', id: thinkId, patch: { label: 'Thinking', status: 'success', durationMs: Date.now() - t0, details: turn.text || undefined, retry: null } })
    history.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls })

    if (!turn.toolCalls.length && nudges < 2 && opts.agent !== 'review' && changed.size === 0 && /```|\b(read_file|write_file|edit_file|list_files|search_files)\s*[({]/i.test(turn.text)) {
      // Model described code instead of applying it — remind it to use the tools.
      nudges++
      emit({ type: 'activity', activity: { id: `n${nudges}-${Date.now()}`, kind: 'thinking', label: 'Reminding agent to apply changes with tools', status: 'success' } })
      history.push({ role: 'user', content: 'You described tool calls or code as plain text instead of actually calling the tools. Call the tools now (read_file / write_file / edit_file) using the function-calling interface. Do not explain, just call them. If the task is already fully complete, reply with a short summary and no code.' })
      continue
    }
    if (!turn.toolCalls.length && !turn.text.trim() && nudges < 2) {
      // Empty reply (no text, no tools) — ask the model to continue instead of silently finishing.
      nudges++
      history.pop() // drop the empty assistant turn (some APIs reject empty assistant content)
      const reminder = 'Continue the task now by calling the tools (list_files, read_file, write_file, edit_file, run_command).'
      const last = history[history.length - 1]
      if (last?.role === 'user') last.content += `\n\n${reminder}`
      else history.push({ role: 'user', content: reminder })
      continue
    }
    if (!turn.toolCalls.length && turn.truncated && nudges < 3) {
      nudges++
      history.push({ role: 'user', content: 'Your previous reply was cut off at the output limit. Continue exactly where you stopped. If you were writing a file, use smaller pieces: write_file for the first part, append_file for the rest.' })
      continue
    }
    if (!turn.toolCalls.length) {
      emit({ type: 'done', text: turn.text.trim() || 'O modelo terminou sem resposta. Tenta reformular o pedido ou usar um modelo mais capaz.', usage, steps: step, changed: [...changed], commands })
      return
    }
    if (turn.text) emit({ type: 'text', text: turn.text })

    const results: { id: string; name: string; output: string; isError?: boolean }[] = []
    try {
      for (const call of turn.toolCalls) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        const id = `a${++n}-${Date.now()}`
        if (call.argsError) {
          const msg = `Your arguments for ${call.name} were not valid JSON${turn.truncated ? ' because the response hit the output token limit' : ''} (${call.argsError}). Nothing was executed. Split large content: write_file with the first ~200 lines, then append_file for the remaining parts.`
          emit({ type: 'activity', activity: { id, kind: 'thinking', label: 'Output too long — retrying in parts', target: call.args?.path ?? call.name, status: 'warning', details: msg } })
          results.push({ id: call.id, name: call.name, output: msg, isError: true })
          continue
        }
        if (call.name === 'update_plan') {
          const items = normalisePlan((call.args as Record<string, unknown>).items)
          if (!items) { results.push({ id: call.id, name: call.name, output: 'Invalid plan. Pass items: [{title, status}] with status pending|in_progress|done.', isError: true }); continue }
          plan = items
          if (!sub) repo.savePlan(opts.conversationId, plan)
          emit({ type: 'plan', items: plan })
          const done = plan.filter((p) => p.status === 'done').length
          emit({ type: 'activity', activity: { id, kind: 'thinking', label: 'Updated plan', target: `${done}/${plan.length}`, status: 'success', details: planText(plan) } })
          results.push({ id: call.id, name: call.name, output: `Plan saved (${done}/${plan.length} done). ${done === plan.length ? 'All steps done — verify, then finish with a summary.' : 'Continue with the next step.'}` })
          continue
        }
        if (call.name === 'delegate' && opts.agent === 'team' && !sub) {
          const roleName = ROLES[String(call.args.role)] ? String(call.args.role) : 'fullstack'
          const task = String(call.args.task ?? '').trim()
          if (!task) { results.push({ id: call.id, name: call.name, output: 'Missing "task".', isError: true }); continue }
          emit({ type: 'activity', activity: { id, kind: 'command', label: `Sub-agente ${ROLES[roleName].label}`, target: task.slice(0, 140), status: 'loading', children: [] } })
          const d0 = Date.now()
          const d = await delegate(roleName, task, id)
          for (const f of d.changed) changed.add(f)
          emit({ type: 'update', id, patch: { status: d.report ? 'success' : 'warning', durationMs: Date.now() - d0, details: d.report || '(sem relatório)' } })
          results.push({ id: call.id, name: call.name, output: `REPORT from ${roleName} (${d.steps} steps; files changed: ${d.changed.join(', ') || 'none'}):\n${d.report || '(no report)'}`.slice(0, 20_000) })
          emit({ type: 'files_changed' })
          continue
        }
        const isCmd = call.name === 'run_command'
        const A = call.args as Record<string, string | undefined>
        const target = isCmd || call.name === 'start_process' ? String(A.command ?? '')
          : call.name === 'browser' ? `${A.action ?? ''} ${A.url ?? A.text ?? A.label ?? A.placeholder ?? A.selector ?? ''}${A.value ? ` = "${String(A.value).slice(0, 40)}"` : ''}`.trim()
          : call.name === 'github' ? `${A.action ?? ''} ${A.repo ?? A.name ?? A.title ?? A.message ?? A.branch ?? ''}`.trim()
          : A.path ?? A.query ?? A.id ?? '.'
        const isFile = ['write_file', 'edit_file', 'delete_file', 'append_file'].includes(call.name)
        emit({ type: 'activity', activity: { id, kind: KIND[call.name] ?? 'command', label: LABEL[call.name] ?? call.name, target, status: 'loading', filePath: isFile ? call.args.path : undefined } })
        const s0 = Date.now()
        // Stream command output to the UI (throttled).
        let live = ''
        let lastFlush = 0
        const onOutput = isCmd ? (chunk: string) => {
          live = (live + chunk).slice(-4000)
          if (Date.now() - lastFlush > 250) { lastFlush = Date.now(); emit({ type: 'update', id, patch: { details: live } }) }
        } : undefined
        let r
        try {
          r = await runTool(project, call.name, call.args, { signal, onOutput, ...toolCtx })
        } catch (e) {
          if ((e as Error).name === 'AbortError') emit({ type: 'update', id, patch: { status: 'warning', durationMs: Date.now() - s0, details: `${live}\n[stopped by user]`.trim() } })
          throw e
        }
        if (!r.isError && isFile && r.filePath) {
          changed.add(r.filePath.replace(/^\.?\/+/, ''))
          emit({ type: 'file', path: r.filePath, content: r.content ?? null, previous: r.previous ?? null, deleted: call.name === 'delete_file' })
          if (call.name === 'write_file') emit({ type: 'update', id, patch: { kind: r.previous === null ? 'create' : 'edit' } })
        }
        let status = r.isError ? 'error' : r.warning ? 'warning' : 'success'
        if (r.screenshot) emit({ type: 'update', id, patch: { screenshot: r.screenshot } })
        if (r.image && toolImages.length < 3) toolImages.push(r.image)
        if (r.refresh) emit({ type: 'files_changed' })
        if (r.changedFiles?.length) { for (const f of r.changedFiles) changed.add(f); emit({ type: 'files_changed' }) }
        if (['start_process', 'stop_process'].includes(call.name)) emit({ type: 'processes_changed' })
        if (call.name === 'start_process' && r.processId) emit({ type: 'update', id, patch: { processId: r.processId } })
        if (isCmd && r.exitCode !== undefined) {
          commands.push({ command: r.command ?? target, exitCode: r.exitCode })
          status = r.exitCode === 0 ? 'success' : 'error'
          emit({ type: 'files_changed' })
        }
        emit({ type: 'update', id, patch: { status, durationMs: Date.now() - s0, details: headTail(r.output, 1500, 2500) } })
        results.push({ id: call.id, name: call.name, output: r.output.slice(0, 60_000), isError: r.isError })
      }
    } finally {
      // Every tool call MUST get a result, otherwise the provider rejects the next request.
      for (const call of turn.toolCalls.slice(results.length)) results.push({ id: call.id, name: call.name, output: 'Not executed: the user stopped the task.', isError: true })
      history.push({ role: 'tool', results })
      // Screenshots / images from tools: shown to the model right after the tool results (vision).
      if (toolImages.length) {
        history.push({ role: 'user', auto: true, content: `[Imagens produzidas pelas ferramentas neste passo: ${toolImages.map((i) => i.name ?? 'imagem').join(', ')}. Analisa-as e continua.]`, images: toolImages.splice(0) })
      }
      // Persist after every step so a server crash/restart doesn't lose a long task's progress.
      persist()
    }
  }
  const left = plan.filter((p) => p.status !== 'done').length
  emit({ type: 'done', text: sub ? `O especialista atingiu o limite de ${maxSteps} passos sem terminar. Alterações feitas até aqui: ${[...changed].join(', ') || 'nenhuma'}.` : `Parei após ${maxSteps} passos${left ? ` (faltam ${left} passo(s) do plano)` : ''}. Envia "continua" para prosseguir.`, usage, steps: maxSteps, changed: [...changed], commands })
  }
}
