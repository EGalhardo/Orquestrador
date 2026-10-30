import * as pfs from './projectFs.ts'
import { syntaxErrors } from './syntax.ts'
import { exec, checkCommand, DEFAULT_TIMEOUT, MAX_TIMEOUT } from './sandbox.ts'
import * as procs from './processes.ts'
import { inspect, formatInspection } from './inspector.ts'
import { githubAction, GITHUB_ACTIONS, type GithubAuth } from './github.ts'
import { browserAction, BROWSER_ACTIONS } from './browser.ts'
import { parseDataUrl, type ImagePart } from './llm.ts'
import fs from 'node:fs'
import nodePath from 'node:path'

export const TEMPLATES_DIR = nodePath.resolve(import.meta.dirname, 'templates')
export const TEMPLATES: Record<string, string> = {
  'fullstack-react': 'React 19 + React Router + Tailwind 4 frontend, Express API under /api running inside the Vite dev server (one port), SQLite via better-sqlite3 with migrations, node:test API tests. Best for apps that need a backend and data.',
}

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolContext {
  signal?: AbortSignal
  onOutput?: (chunk: string) => void
  /** GitHub credentials of the user running the agent (token may be empty). */
  github?: GithubAuth
  /** Key of the persistent browser session (one per agent run). */
  browserKey?: string
}
export interface ToolResult { refresh?: boolean; image?: ImagePart; screenshot?: string; changedFiles?: string[]; processId?: string; exitCode?: number; command?: string; output: string; isError?: boolean; warning?: boolean; filePath?: string; previous?: string | null; content?: string }

const str = (description: string) => ({ type: 'string', description })

/** Phase 1 tools: real file operations inside the project folder. No shell execution yet (Phase 2). */
export const TOOL_DEFS: ToolDef[] = [
  { name: 'list_files', description: 'List all files in the project (recursively, ignoring node_modules/.git/dist). Call this first to understand the project.',
    parameters: { type: 'object', properties: { path: str('Sub-folder relative to project root. Default "."') } } },
  { name: 'read_file', description: 'Read the full text content of a file.',
    parameters: { type: 'object', properties: { path: str('File path relative to project root') }, required: ['path'] } },
  { name: 'write_file', description: 'Create a new file or completely overwrite an existing one. Parent folders are created automatically. Always pass the COMPLETE file content.',
    parameters: { type: 'object', properties: { path: str('File path relative to project root'), content: str('Full file content') }, required: ['path', 'content'] } },
  { name: 'edit_file', description: 'Replace one exact occurrence of old_text with new_text in a file. old_text must match exactly and be unique. Prefer this for small changes to large files.',
    parameters: { type: 'object', properties: { path: str('File path'), old_text: str('Exact text to find'), new_text: str('Replacement text') }, required: ['path', 'old_text', 'new_text'] } },
  { name: 'delete_file', description: 'Delete a file or folder.',
    parameters: { type: 'object', properties: { path: str('Path relative to project root') }, required: ['path'] } },
  { name: 'run_command', description: `Run a shell command (bash) in the project root inside an isolated sandbox and return its output and exit code. Use it to install dependencies (npm install), build (npm run build), run tests (npm test), type-check (npx tsc --noEmit) or inspect things (ls, cat, node -e). After changing code, ALWAYS run the build or tests to verify. Dev servers and watchers (npm run dev/start) are NOT supported because they never finish. Default timeout ${DEFAULT_TIMEOUT / 1000}s, max ${MAX_TIMEOUT / 1000}s.`,
    parameters: { type: 'object', properties: { command: str('The bash command, e.g. "npm install" or "npm run build"'), timeout_seconds: { type: 'number', description: 'Optional timeout in seconds' } }, required: ['command'] } },
  { name: 'start_process', description: 'Start a long-running process in the background (dev server, e.g. "npm run dev"). The port is detected automatically and the user gets a live preview. Returns status, port and the first logs. Install dependencies first (run_command "npm install"). If the same command is already running, the existing process is returned.',
    parameters: { type: 'object', properties: { command: str('e.g. "npm run dev"'), name: str('Optional short label, e.g. "frontend"') }, required: ['command'] } },
  { name: 'get_process_logs', description: 'Get recent logs and status of a background process (use to check for runtime/compile errors after changes).',
    parameters: { type: 'object', properties: { id: str('Process id returned by start_process, e.g. "p1"') }, required: ['id'] } },
  { name: 'stop_process', description: 'Stop a background process.',
    parameters: { type: 'object', properties: { id: str('Process id, e.g. "p1"') }, required: ['id'] } },
  { name: 'append_file', description: 'Append text to the end of a file (created if missing). Use it to write LARGE files in several parts: write_file with the first part, then append_file for the rest. Keep each call under ~250 lines.',
    parameters: { type: 'object', properties: { path: str('File path relative to project root'), content: str('Text to append') }, required: ['path', 'content'] } },
  { name: 'update_plan', description: 'Create or update your task plan (shown to the user as a checklist). For any multi-step task, call it FIRST with all steps, then again whenever a step starts (in_progress) or finishes (done). Always send the FULL list. Keep exactly one step in_progress.',
    parameters: { type: 'object', properties: { items: { type: 'array', description: 'All plan steps, in order', items: { type: 'object', properties: { title: str('Short step description'), status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['title', 'status'] } } }, required: ['items'] } },
  { name: 'inspect_app', description: 'Open the running app in a real headless browser and report console errors, uncaught exceptions, failed network requests, visible text and element counts (the user also sees a screenshot). Use it after start_process and after UI changes to VERIFY the app actually renders and works. Requires a running dev server.',
    parameters: { type: 'object', properties: { id: str('Process id of the running server (default: the first running one)'), path: str('URL path to open, e.g. "/" or "/login". Default "/"') } } },
  { name: 'use_template', description: `Scaffold a new project from a tested starter template (copies files; existing files are never overwritten). Use it at the START of a new app instead of writing boilerplate. Then run "npm install". Templates: ${Object.entries(TEMPLATES).map(([k, v]) => `"${k}": ${v}`).join(' ')}`,
    parameters: { type: 'object', properties: { name: { type: 'string', enum: Object.keys(TEMPLATES), description: 'Template name' } }, required: ['name'] } },
  { name: 'read_image', description: 'Look at an image file from the project (png, jpg, gif, webp; max 5 MB) — e.g. a design mockup, logo or screenshot the user added. The image is shown to you so you can describe it or reproduce the design.',
    parameters: { type: 'object', properties: { path: str('Image path relative to project root') }, required: ['path'] } },
  { name: 'browser', description: `Control a real browser (Playwright) that stays open across calls — use it like a QA tester to USE the app: open pages, click buttons, fill and submit forms, and check the result. Each call returns the page URL, errors caused by that action, the list of visible controls (use their labels/text to target elements) and visible text; you also SEE a screenshot. Target elements with "text" (visible text of a button/link), "label" (form field label), "placeholder", or a CSS/Playwright "selector". "open" accepts a path on the project's running server (e.g. "/login") or a public https URL. Actions: ${BROWSER_ACTIONS.join(', ')}.`,
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: [...BROWSER_ACTIONS], description: 'What to do' },
      url: str('For open: path like "/despesas" (project server) or full https URL'),
      text: str('Visible text of the element (button/link/any)'), label: str('Label of a form field'), placeholder: str('Placeholder of a form field'), selector: str('CSS or Playwright selector (fallback)'),
      value: str('For fill/select/check: the value'), key: str('For press: e.g. "Enter", "Tab"'), ms: str('For wait: milliseconds'), port: str('For open: server port (default: first running server)'),
    }, required: ['action'] } },
  { name: 'github', description: `Git + GitHub for this project (runs git in the sandbox with the user's saved GitHub token). Actions: clone {repo: "owner/name" — project must be empty}, status, log, pull, commit {message} (stages all changes), push {branch?}, branch {name} (create + switch), checkout {name}, create_pr {title, body, base?}. Typical flow for a change: branch → edit files → verify → commit → push → create_pr. Never push to the default branch unless the user asked.`,
    parameters: { type: 'object', properties: {
      action: { type: 'string', enum: GITHUB_ACTIONS, description: 'Git operation' },
      repo: str('For clone: "owner/name" or https://github.com/owner/name'), message: str('For commit'), name: str('For branch/checkout'), branch: str('For clone/push (optional)'),
      title: str('For create_pr'), body: str('For create_pr: description (markdown)'), base: str('For create_pr: target branch (default: repo default)'),
    }, required: ['action'] } },
  { name: 'search_files', description: 'Search for a text (case-insensitive) in all project files. Returns matching lines with file:line.',
    parameters: { type: 'object', properties: { query: str('Text to search for') }, required: ['query'] } },
]

type Args = Record<string, string | undefined>

/** Actionable hints for common failures (appended to tool output). */
export function hintFor(output: string, exitCode: number | null | undefined) {
  if (exitCode === 127 || /: not found|command not found|Cannot find module/.test(output))
    return '\n\nHINT: a binary or module is missing. If node_modules exists but is incomplete, "npm install" may report "up to date" without fixing it — run "rm -rf node_modules && npm install" with run_command.'
  if (/EADDRINUSE/.test(output)) return '\n\nHINT: the port is already in use. Stop the other process (see running processes) or let the tool pick the port via $PORT.'
  return ''
}

/** Keep the beginning (where errors usually are) and the end (final status) of long output. */
export function headTail(text: string, head: number, tail: number) {
  if (text.length <= head + tail) return text
  return `${text.slice(0, head)}\n\n…(${text.length - head - tail} chars omitted)…\n\n${text.slice(-tail)}`
}

/** Write, but refuse to replace a syntactically valid file with a broken one. */
async function checkedWrite(project: string, path: string, content: string): Promise<{ previous: string | null; rejected?: string }> {
  const errs = syntaxErrors(path, content)
  if (errs.length) {
    let prev: string | null = null
    try { prev = await pfs.readFile(project, path) } catch { /* new file */ }
    if (prev !== null && syntaxErrors(path, prev).length === 0)
      return { previous: prev, rejected: `REJECTED: the new content for ${path} has syntax errors, so the original file was kept unchanged.\n${errs.join('\n')}\nSend the COMPLETE corrected file with write_file.` }
  }
  return { previous: await pfs.writeFile(project, path, content) }
}

/** After any write, append syntax errors so the model can self-correct. */
export async function runTool(project: string, name: string, args: Args, ctx: ToolContext = {}): Promise<ToolResult> {
  const r = await runToolRaw(project, name, args, ctx)
  if (!r.isError && r.content != null && r.filePath && !(r as { skipSyntax?: boolean }).skipSyntax) {
    const errs = syntaxErrors(r.filePath, r.content)
    if (errs.length) return { ...r, warning: true, output: `${r.output}\n\n⚠ SYNTAX ERRORS in ${r.filePath}:\n${errs.join('\n')}\nFix them now (read_file then write_file with corrected full content).` }
  }
  return r
}

async function runToolRaw(project: string, name: string, args: Args, ctx: ToolContext): Promise<ToolResult> {
  try {
    switch (name) {
      case 'start_process': {
        const command = String(args.command ?? '').trim()
        const started = await procs.start(project, command, args.name)
        const p = await procs.waitReady(started.id)
        const log = (procs.logs(started.id, 3000) ?? '').trim()
        if (!p) return { output: 'Process vanished.', isError: true }
        const state = p.status === 'running' ? `RUNNING on port ${p.port}. The user can see the live preview.` : p.status === 'starting' ? 'STILL STARTING (no port detected yet). Check again with get_process_logs.' : `ENDED with status ${p.status} (exit ${p.exitCode}). Read the logs, fix the problem and start it again.`
        return { output: `Process ${p.id}: ${state}\nCommand: ${p.command}\n\nLogs:\n${log || '(no output yet)'}${hintFor(log, p.exitCode)}`, isError: p.status === 'error' || p.status === 'exited', processId: p.id }
      }
      case 'get_process_logs': {
        const id = String(args.id ?? '')
        const p = procs.get(id)
        if (!p || p.project !== project) return { output: `No process "${id}" in this project. Running: ${procs.list(project).map((x) => `${x.id} (${x.command}, ${x.status})`).join(', ') || 'none'}`, isError: true }
        return { output: `Process ${id} — ${p.status}${p.port ? ` on port ${p.port}` : ''}\n\n${(procs.logs(id, 6000) ?? '').trim() || '(no output)'}` }
      }
      case 'stop_process': {
        const id = String(args.id ?? '')
        const p = procs.get(id)
        if (!p || p.project !== project) return { output: `No process "${id}" in this project.`, isError: true }
        procs.stop(id)
        return { output: `Stopped ${id}.` }
      }
      case 'run_command': {
        const command = String(args.command ?? args.cmd ?? '').trim()
        const bad = checkCommand(command)
        if (bad) return { output: bad, isError: true, command }
        const secs = Number(args.timeout_seconds)
        const r = await exec(project, command, { signal: ctx.signal, onOutput: ctx.onOutput, timeoutMs: Number.isFinite(secs) && secs > 0 ? secs * 1000 : undefined })
        if (r.aborted) throw new DOMException('Aborted', 'AbortError')
        const tail = headTail(r.output, 4_000, 8_000)
        const status = r.timedOut ? `TIMED OUT after ${Math.round(r.durationMs / 1000)}s (process killed)` : `Exit code: ${r.exitCode}`
        return { output: `$ ${command}\n${tail.trim() || '(no output)'}\n\n${status}${r.exitCode !== 0 ? hintFor(r.output, r.exitCode) : ''}`, exitCode: r.timedOut ? 124 : r.exitCode, command, isError: false }
      }
      case 'read_image': {
        const path = need(args, 'path')
        const ext = path.toLowerCase().match(/\.(png|jpe?g|gif|webp)$/)?.[1]
        if (!ext) return { output: 'Formato não suportado. Usa png, jpg, gif ou webp.', isError: true }
        const abs = await pfs.realInside(project, path)
        const st = fs.statSync(abs)
        if (st.size > 5 * 1024 * 1024) return { output: `Imagem demasiado grande (${Math.round(st.size / 1024)} KB, máximo 5 MB).`, isError: true }
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
        const data = fs.readFileSync(abs).toString('base64')
        return { output: `Imagem ${path} (${Math.round(st.size / 1024)} KB) — está anexada a seguir para a veres.`, image: { mime, data, name: path }, screenshot: `data:${mime};base64,${data}` }
      }
      case 'browser': {
        const action = need(args, 'action')
        const running = procs.list(project).filter((p) => p.status === 'running' && p.port)
        const r = await browserAction(ctx.browserKey ?? `p:${project}`, action, args, { ports: () => procs.list(project).filter((p) => p.status === 'running' && p.port).map((p) => p.port as number), defaultPort: running[0]?.port ?? undefined, signal: ctx.signal })
        const img = r.screenshot ? parseDataUrl(r.screenshot, 'browser') : null
        return { output: r.output, isError: r.isError, screenshot: r.screenshot, image: img ?? undefined, warning: !r.isError && /⚠/.test(r.output) }
      }
      case 'github': {
        const r = await githubAction(project, ctx.github ?? { token: '', login: '' }, need(args, 'action'), args, ctx.signal)
        return { output: r.output, isError: r.isError, refresh: ['clone', 'pull', 'checkout'].includes(String(args.action)) }
      }
      case 'append_file': {
        const path = need(args, 'path')
        const add = args.content ?? ''
        if (!add) return { output: 'Missing content.', isError: true }
        let prev: string | null = null
        try { prev = await pfs.readFile(project, path) } catch { /* new */ }
        const content = (prev ?? '') + add
        await pfs.writeFile(project, path, content)
        return { output: `Appended ${add.length} chars to ${path} (now ${content.length} chars, ${content.split('\n').length} lines)`, filePath: path, previous: prev, content, skipSyntax: true } as ToolResult
      }
      case 'inspect_app': {
        const running = procs.list(project).filter((p) => p.status === 'running' && p.port)
        const p = args.id ? running.find((x) => x.id === args.id) : running[0]
        if (!p) return { output: `No running server${args.id ? ` "${args.id}"` : ''} with a port in this project. Start one with start_process first. Processes: ${procs.list(project).map((x) => `${x.id} (${x.command}, ${x.status})`).join(', ') || 'none'}`, isError: true }
        const rel = '/' + String(args.path ?? '/').replace(/^\/+/, '')
        try {
          const r = await inspect(`http://127.0.0.1:${p.port}${rel}`, { signal: ctx.signal })
          const problems = r.consoleErrors.length + r.pageErrors.length + r.failedRequests.length
          const img = r.screenshot ? parseDataUrl(r.screenshot, 'inspect_app') : null
          return { output: formatInspection(r), screenshot: r.screenshot, image: img ?? undefined, warning: problems > 0 || !r.text }
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e
          return { output: `Browser inspection unavailable: ${(e as Error).message}. Verify with get_process_logs and curl via run_command instead.`, isError: true }
        }
      }
      case 'use_template': {
        const name = need(args, 'name')
        if (!TEMPLATES[name]) return { output: `Unknown template "${name}". Available: ${Object.keys(TEMPLATES).join(', ')}`, isError: true }
        const src = nodePath.join(TEMPLATES_DIR, name)
        const { root } = pfs.safe(project)
        const created: string[] = [], skipped: string[] = []
        const walk = (dir: string) => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name === 'dist') continue
            const abs = nodePath.join(dir, e.name), rel = nodePath.relative(src, abs)
            if (e.isDirectory()) { walk(abs); continue }
            const dest = nodePath.join(root, rel)
            if (fs.existsSync(dest)) { skipped.push(rel); continue }
            fs.mkdirSync(nodePath.dirname(dest), { recursive: true })
            fs.copyFileSync(abs, dest)
            created.push(rel)
          }
        }
        walk(src)
        const guide = fs.existsSync(nodePath.join(root, 'AGENTS.md')) ? fs.readFileSync(nodePath.join(root, 'AGENTS.md'), 'utf8') : ''
        return { output: `Template "${name}" applied. Created ${created.length} files:\n${created.join('\n')}${skipped.length ? `\nKept existing (not overwritten): ${skipped.join(', ')}` : ''}\n\nNext: run_command "npm install", then build your features on top of it.\n\n${guide}`, changedFiles: created }
      }
      case 'list_files': {
        const files = await pfs.listFiles(project, args.path || '.')
        return { output: files.join('\n') || '(empty project)' }
      }
      case 'read_file': {
        const content = await pfs.readFile(project, need(args, 'path'))
        return { output: content, filePath: args.path }
      }
      case 'write_file': {
        const content = args.content ?? args.new_text ?? args.text ?? ''
        if (!content) return { output: 'Missing content. Pass the full file content in "content".', isError: true }
        const w = await checkedWrite(project, need(args, 'path'), content)
        if (w.rejected) return { output: w.rejected, isError: true }
        const previous = w.previous
        return { output: `${previous === null ? 'Created' : 'Updated'} ${args.path} (${content.length} chars)`, filePath: args.path, previous, content }
      }
      case 'edit_file': {
        const path = need(args, 'path')
        const newT = args.new_text ?? args.content ?? ''
        let src: string | null = null
        try { src = await pfs.readFile(project, path) } catch { /* missing */ }
        // Tolerate common model mistakes: editing a non-existent file, or omitting old_text with full content.
        if (src === null || !args.old_text) {
          if (!newT) return { output: src === null ? `${path} does not exist. Use write_file with the full content to create it.` : 'Missing old_text. Use read_file, then pass an exact snippet as old_text, or use write_file to replace the whole file.', isError: true }
          const w = await checkedWrite(project, path, newT)
          if (w.rejected) return { output: w.rejected, isError: true }
          const previous = w.previous
          return { output: `${previous === null ? 'Created' : 'Rewrote'} ${path} (${newT.length} chars)`, filePath: path, previous, content: newT }
        }
        const oldT = args.old_text
        const count = src.split(oldT).length - 1
        if (count === 0) {
          // Retry ignoring leading/trailing whitespace differences per line.
          const norm = (t: string) => t.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).join('\n')
          const lines = src.split('\n'), target = norm(oldT).split('\n')
          for (let i = 0; i + target.length <= lines.length; i++) {
            if (norm(lines.slice(i, i + target.length).join('\n')) === target.join('\n')) {
              const content = [...lines.slice(0, i), newT, ...lines.slice(i + target.length)].join('\n')
              const w = await checkedWrite(project, path, content)
              if (w.rejected) return { output: w.rejected, isError: true }
              return { output: `Edited ${path} (whitespace-tolerant match)`, filePath: path, previous: src, content }
            }
          }
          return { output: `old_text not found in ${path}. Current content:\n${src.slice(0, 3000)}`, isError: true }
        }
        if (count > 1) return { output: `old_text matches ${count} times in ${path}. Include more surrounding context.`, isError: true }
        const content = src.replace(oldT, () => newT)
        const w = await checkedWrite(project, path, content)
        if (w.rejected) return { output: w.rejected, isError: true }
        return { output: `Edited ${path}`, filePath: path, previous: src, content }
      }
      case 'delete_file': {
        await pfs.deleteFile(project, need(args, 'path'))
        return { output: `Deleted ${args.path}`, filePath: args.path }
      }
      case 'search_files': {
        const q = need(args, 'query').toLowerCase()
        const hits: string[] = []
        for (const f of await pfs.listFiles(project)) {
          let text: string
          try { text = await pfs.readFile(project, f) } catch { continue }
          text.split('\n').forEach((line, i) => { if (line.toLowerCase().includes(q) && hits.length < 100) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 200)}`) })
        }
        return { output: hits.join('\n') || 'No matches.' }
      }
      default:
        return { output: `Unknown tool: ${name}`, isError: true }
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return { output: (e as Error).message, isError: true }
  }
}

function need(a: Args, k: string) {
  const v = a[k]
  if (v === undefined || v === '') throw new Error(`Missing argument: ${k}`)
  return v
}
