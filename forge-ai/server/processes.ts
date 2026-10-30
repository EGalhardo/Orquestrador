import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import net from 'node:net'
import { safe } from './projectFs.ts'
import { buildSpawn, sandboxKind, isForbidden } from './sandbox.ts'

/**
 * Background processes (dev servers) + preview proxies.
 *
 * Each process runs in the same sandbox as run_command, but keeps running.
 * Its port is detected from the logs (e.g. "Local: http://localhost:5174/") or from the
 * PORT env var we assign. For every detected port a preview proxy is opened on a public
 * port from PREVIEW_PORTS; the proxy rewrites Host/Origin to localhost (so dev servers with
 * host checks accept it), strips iframe-blocking headers and forwards WebSockets (HMR).
 */
export type ProcStatus = 'starting' | 'running' | 'exited' | 'error' | 'stopped'
export interface ProcInfo {
  id: string; project: string; name: string; command: string; status: ProcStatus
  port: number | null; previewPort: number | null; exitCode: number | null
  startedAt: number; endedAt: number | null
}

const MAX_LOG = 100_000
const MAX_PER_PROJECT = 3
const MAX_TOTAL = 5
const PREVIEW_FROM = Number(process.env.FORGE_PREVIEW_PORT_START || 8790)
const PREVIEW_PORTS = Array.from({ length: 10 }, (_, i) => PREVIEW_FROM + i)
const APP_PORT_FROM = 3100

interface Proc extends ProcInfo { host: string; child: ChildProcess; log: string; proxy: http.Server | null; listeners: Set<(chunk: string) => void> }
const procs = new Map<string, Proc>()
let seq = 0

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
const PORT_RE = /(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/g
/** Ports used by EGalhardo IA itself — never treat them as the user's app on IPv4 loopback. */
const RESERVED = new Set([...(process.env.FORGE_RESERVED_PORTS || '5173,4173,8787,11434').split(',').map(Number), ...Array.from({ length: 10 }, (_, i) => Number(process.env.FORGE_PREVIEW_PORT_START || 8790) + i)])

/**
 * Make well-known dev servers listen exactly where we expect (port + IPv4 loopback),
 * instead of guessing. Unknown commands still get $PORT/$HOST env vars.
 */
export function adaptCommand(root: string, command: string, port: number) {
  let script = command
  const m = command.match(/^(npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.-]+)\s*$/)
  if (m) {
    try { script = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts?.[m[2]] ?? command } catch { /* no package.json */ }
  }
  if (/--port\b|\s-p\s/.test(script + ' ' + command)) return command // user already chose a port
  const sep = m ? ' --' : ''
  if (/\bvite\b/.test(script) && !/\bvite\s+build\b/.test(script)) return `${command}${sep} --port ${port} --strictPort --host 127.0.0.1`
  if (/\bnext\s+dev\b/.test(script)) return `${command}${sep} -p ${port} -H 127.0.0.1`
  if (/\bastro\s+dev\b/.test(script)) return `${command}${sep} --port ${port} --host 127.0.0.1`
  return command
}

function portOpen(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise<boolean>((res) => {
    const s = net.connect({ port, host })
    s.setTimeout(600)
    s.once('connect', () => { s.destroy(); res(true) })
    s.once('error', () => res(false))
    s.once('timeout', () => { s.destroy(); res(false) })
  })
}
async function freePort(from: number, used: Set<number>) {
  for (let p = from; p < from + 200; p++) if (!used.has(p) && !(await portOpen(p))) return p
  throw new Error('No free port available')
}

export const info = (p: Proc): ProcInfo => ({
  id: p.id, project: p.project, name: p.name, command: p.command, status: p.status,
  port: p.port, previewPort: p.previewPort, exitCode: p.exitCode, startedAt: p.startedAt, endedAt: p.endedAt,
})
export const list = (project?: string) => [...procs.values()].filter((p) => !project || p.project === project).map(info)
export const get = (id: string) => procs.get(id)
export function logs(id: string, tail = 8000) { const p = procs.get(id); return p ? p.log.slice(-tail) : null }
export function subscribe(id: string, fn: (chunk: string) => void) {
  const p = procs.get(id); if (!p) return () => undefined
  p.listeners.add(fn); return () => p.listeners.delete(fn)
}

export async function start(project: string, command: string, name?: string): Promise<ProcInfo> {
  const { root } = safe(project)
  const cmd = command.trim()
  if (!cmd) throw new Error('Empty command')
  if (isForbidden(cmd)) throw new Error('This command is not allowed in the sandbox.')
  const alive = [...procs.values()].filter((p) => p.status === 'starting' || p.status === 'running')
  // Same command already running in this project → return it instead of starting a duplicate.
  const dup = alive.find((p) => p.project === project && p.command === cmd)
  if (dup) return info(dup)
  if (alive.filter((p) => p.project === project).length >= MAX_PER_PROJECT) throw new Error(`Limit reached: max ${MAX_PER_PROJECT} running processes per project. Stop one first.`)
  if (alive.length >= MAX_TOTAL) throw new Error(`Limit reached: max ${MAX_TOTAL} running processes. Stop one first.`)

  const usedApp = new Set(alive.map((p) => p.port ?? 0))
  const appPort = await freePort(APP_PORT_FROM, usedApp)
  const effective = adaptCommand(root, cmd, appPort)
  const { cmd: bin, args, env } = buildSpawn(sandboxKind(), root, effective, true, { PORT: String(appPort), HOST: '127.0.0.1', BROWSER: 'none' })
  const child = spawn(bin, args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const id = `p${++seq}`
  const p: Proc = {
    id, project, name: name?.trim() || cmd, command: cmd, status: 'starting', port: null, previewPort: null,
    exitCode: null, startedAt: Date.now(), endedAt: null, host: '127.0.0.1', child, log: effective !== cmd ? `[forge] running: ${effective}\n` : '', proxy: null, listeners: new Set(),
  }
  procs.set(id, p)

  const onData = (b: Buffer) => {
    const s = stripAnsi(b.toString('utf8'))
    p.log = (p.log + s).slice(-MAX_LOG)
    p.listeners.forEach((fn) => fn(s))
    if (!p.port) for (const m of s.matchAll(PORT_RE)) { void adopt(p, Number(m[2]), m[1]); break }
  }
  child.stdout!.on('data', onData)
  child.stderr!.on('data', onData)
  child.on('error', (e) => { p.log += `\n[forge] failed to start: ${e.message}\n`; p.status = 'error' })
  child.on('close', (code) => {
    if (p.status !== 'stopped') p.status = code === 0 ? 'exited' : 'error'
    p.exitCode = code
    p.endedAt = Date.now()
    p.proxy?.close(); p.proxy = null
    p.log += `\n[forge] process ended (exit ${code ?? 'signal'})\n`
    p.listeners.forEach((fn) => fn(`\n[forge] process ended (exit ${code ?? 'signal'})\n`))
  })

  // Fallback: the app may honour $PORT without printing a URL.
  const poll = setInterval(async () => {
    if (p.port || p.status !== 'starting') return clearInterval(poll)
    if (await portOpen(appPort)) { clearInterval(poll); void adopt(p, appPort, '127.0.0.1') }
  }, 700)
  setTimeout(() => clearInterval(poll), 120_000).unref()
  return info(p)
}

async function adopt(p: Proc, port: number, hostHint: string) {
  if (p.port || !port) return
  // Candidate addresses, most specific first. "localhost" may be IPv6 (::1) on modern Node.
  const hosts = hostHint.includes('::') ? ['::1'] : hostHint === 'localhost' ? ['::1', '127.0.0.1'] : ['127.0.0.1']
  const usable = (h: string) => !(h === '127.0.0.1' && RESERVED.has(port))
  for (let i = 0; i < 20; i++) {
    for (const h of hosts.filter(usable)) {
      if (await portOpen(port, h)) {
        if (p.port || p.status === 'stopped' || p.status === 'error' || p.status === 'exited') return
        p.port = port; p.host = h; p.status = 'running'
        try { await openProxy(p) } catch (e) { p.log += `\n[forge] preview proxy failed: ${(e as Error).message}\n` }
        return
      }
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  p.log += `\n[forge] port ${port} from the logs is not reachable (or reserved by EGalhardo IA); waiting for $PORT…\n`
}

/** Wait until the process has a port (or ended) — used by the agent tool. */
export async function waitReady(id: string, timeoutMs = 25_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const p = procs.get(id)
    if (!p || p.status !== 'starting') break
    await new Promise((r) => setTimeout(r, 300))
  }
  const p = procs.get(id)
  if (p && p.status === 'running' && !p.previewPort) await new Promise((r) => setTimeout(r, 500))
  return p ? info(p) : null
}

function openProxy(p: Proc) {
  const used = new Set([...procs.values()].map((x) => x.previewPort).filter(Boolean) as number[])
  const target = p.port!
  const rewrite = (h: http.IncomingHttpHeaders) => {
    const headers = { ...h, host: `localhost:${target}` }
    if (headers.origin) headers.origin = `http://localhost:${target}`
    if (headers.referer) headers.referer = String(headers.referer).replace(/^https?:\/\/[^/]+/, `http://localhost:${target}`)
    delete headers['accept-encoding'] // keep it simple: no compressed passthrough issues
    return headers
  }
  const server = http.createServer((req, res) => {
    const up = http.request({ host: p.host, port: target, method: req.method, path: req.url, headers: rewrite(req.headers) }, (r) => {
      const headers = { ...r.headers }
      delete headers['x-frame-options']
      if (headers['content-security-policy']) headers['content-security-policy'] = String(headers['content-security-policy']).replace(/frame-ancestors[^;]*;?/gi, '')
      if (headers.location) headers.location = String(headers.location).replace(new RegExp(`^https?://(localhost|127\\.0\\.0\\.1):${target}`), '')
      res.writeHead(r.statusCode ?? 502, headers)
      r.pipe(res)
    })
    up.on('error', (e) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<body style="font-family:system-ui;background:#1f1e1c;color:#ecebe8;padding:2rem"><h3>A app não está a responder</h3><p>${e.message}</p><p>Vê os logs do processo na EGalhardo IA.</p></body>`)
    })
    req.pipe(up)
  })
  // WebSocket upgrade (Vite/Next HMR)
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(target, p.host, () => {
      const h = rewrite(req.headers)
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n')
      if (head.length) up.write(head)
      socket.pipe(up).pipe(socket)
    })
    up.on('error', () => socket.destroy())
    socket.on('error', () => up.destroy())
  })

  return new Promise<void>((resolve, reject) => {
    const candidates = PREVIEW_PORTS.filter((x) => !used.has(x))
    const tryNext = () => {
      const port = candidates.shift()
      if (!port) return reject(new Error('No free preview port'))
      server.once('error', tryNext)
      server.listen(port, '0.0.0.0', () => { server.removeAllListeners('error'); p.proxy = server; p.previewPort = port; resolve() })
    }
    tryNext()
  })
}

export function stop(id: string) {
  const p = procs.get(id)
  if (!p) return false
  if (p.status === 'starting' || p.status === 'running') {
    p.status = 'stopped'
    try { process.kill(-p.child.pid!, 'SIGTERM') } catch { /* gone */ }
    setTimeout(() => { try { process.kill(-p.child.pid!, 'SIGKILL') } catch { /* gone */ } }, 2500).unref()
  }
  p.proxy?.close(); p.proxy = null
  return true
}

export async function restart(id: string) {
  const p = procs.get(id)
  if (!p) throw new Error('Unknown process')
  stop(id)
  for (let i = 0; i < 30 && p.endedAt === null; i++) await new Promise((r) => setTimeout(r, 100))
  procs.delete(id)
  return start(p.project, p.command, p.name)
}

export function remove(id: string) { stop(id); procs.delete(id) }

/** Kill everything when the API server exits. */
export function stopAll() { for (const id of procs.keys()) stop(id) }
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { stopAll(); setTimeout(() => process.exit(0), 300) })
process.once('exit', stopAll)
