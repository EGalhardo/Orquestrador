import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { safe } from './projectFs.ts'

/**
 * Command sandbox
 * ---------------
 * Runs shell commands for the agent inside the project folder.
 *
 *  - bwrap  : Linux bubblewrap. Only the project folder (rw) and a shared npm cache (rw) are
 *             visible under /home; the rest of the OS is read-only; PID/IPC namespaces isolated.
 *  - docker : one throw-away container per command (node:20 image), project mounted at /work.
 *  - local  : plain child process in the project folder. NOT isolated — dev fallback only.
 *
 * Select with FORGE_SANDBOX=bwrap|docker|local, otherwise auto-detected in that order.
 */
export type SandboxKind = 'bwrap' | 'docker' | 'local'

export interface ExecOptions {
  timeoutMs?: number
  signal?: AbortSignal
  onOutput?: (chunk: string) => void
  network?: boolean
  /** Extra environment variables (e.g. secrets referenced by the command as $VAR, never inlined). */
  env?: Record<string, string>
}
export interface ExecResult { exitCode: number; output: string; durationMs: number; timedOut: boolean; aborted: boolean; truncated: boolean }

const MAX_OUTPUT = 200_000
export const DEFAULT_TIMEOUT = 180_000
export const MAX_TIMEOUT = 600_000
const CACHE_DIR = path.resolve(import.meta.dirname, '.sandbox-cache')

/** Commands that never finish on their own (dev servers / watchers). Phase 3 adds background processes. */
const LONG_RUNNING = /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch|preview)\b|\bvite(\s+(dev|preview))?\s*$|\b(nodemon|live-server|http-server)\b|--watch\b|\bnext\s+dev\b/
const FORBIDDEN = /\bsudo\b|\bsu\s|\bshutdown\b|\breboot\b|\bmkfs\b|:\(\)\s*\{/

function works(cmd: string, args: string[]) {
  try { return spawnSync(cmd, args, { timeout: 8000, stdio: 'ignore' }).status === 0 } catch { return false }
}

let detected: SandboxKind | null = null
export function sandboxKind(): SandboxKind {
  if (detected) return detected
  const forced = process.env.FORGE_SANDBOX as SandboxKind | undefined
  if (forced === 'bwrap' || forced === 'docker' || forced === 'local') return (detected = forced)
  if (works('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--unshare-pid', 'true'])) return (detected = 'bwrap')
  if (works('docker', ['info'])) return (detected = 'docker')
  return (detected = 'local')
}

export const isLongRunning = (c: string) => LONG_RUNNING.test(c.trim())
export const isForbidden = (c: string) => FORBIDDEN.test(c)

/** Validate a command before running. Returns an error message or null. */
export function checkCommand(command: string): string | null {
  const c = command.trim()
  if (!c) return 'Empty command.'
  if (c.length > 4000) return 'Command too long.'
  if (FORBIDDEN.test(c)) return 'This command is not allowed in the sandbox.'
  if (LONG_RUNNING.test(c)) return 'This is a long-running command (dev server / watcher) that never finishes. Use the start_process tool instead to run it in the background.'
  return null
}

export function buildSpawn(kind: SandboxKind, root: string, command: string, network: boolean, extraEnv: Record<string, string> = {}): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  fs.mkdirSync(path.join(CACHE_DIR, 'npm'), { recursive: true })
  const baseEnv = {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C.UTF-8', CI: '1', FORCE_COLOR: '0', NO_COLOR: '1', TERM: 'dumb',
    npm_config_cache: path.join(CACHE_DIR, 'npm'), npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false',
    ...extraEnv,
  }
  if (kind === 'bwrap') {
    const args = [
      '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc',
      '--tmpfs', '/tmp', '--tmpfs', '/home', '--tmpfs', '/root',
      '--bind', root, root, '--bind', CACHE_DIR, CACHE_DIR,
      '--chdir', root, '--unshare-pid', '--unshare-ipc', '--unshare-uts', '--hostname', 'sandbox',
      '--die-with-parent', '--new-session', '--clearenv',
      ...Object.entries({ ...baseEnv, HOME: '/tmp' }).flatMap(([k, v]) => ['--setenv', k, v]),
      ...(network ? [] : ['--unshare-net']),
      'bash', '-c', command,
    ]
    return { cmd: 'bwrap', args, env: {} }
  }
  if (kind === 'docker') {
    const args = ['run', '--rm', '-i', '--init', '--memory', '1g', '--cpus', '1', '--pids-limit', '256',
      ...(network ? [] : ['--network', 'none']),
      '-v', `${root}:/work`, '-v', `${path.join(CACHE_DIR, 'npm')}:/npm-cache`, '-w', '/work',
      '-e', 'npm_config_cache=/npm-cache', '-e', 'CI=1', '-e', 'NO_COLOR=1',
      ...Object.entries(extraEnv).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      // Long-running servers need their port reachable from the host.
      ...(extraEnv.PORT ? ['-p', `127.0.0.1:${extraEnv.PORT}:${extraEnv.PORT}`] : []),
      process.env.FORGE_DOCKER_IMAGE || 'node:20-bookworm', 'bash', '-c', command]
    return { cmd: 'docker', args, env: process.env }
  }
  // local: scrubbed env (no API keys), cwd = project. Not isolated.
  return { cmd: 'bash', args: ['-c', command], env: { ...baseEnv, HOME: root } }
}

export function exec(project: string, command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  const { root } = safe(project)
  const kind = sandboxKind()
  const timeoutMs = Math.min(Math.max(opts.timeoutMs ?? DEFAULT_TIMEOUT, 1000), MAX_TIMEOUT)
  const { cmd, args, env } = buildSpawn(kind, root, command, opts.network ?? true, opts.env)
  const t0 = Date.now()

  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let truncated = false
    let timedOut = false
    let aborted = false
    let settled = false

    const onData = (b: Buffer) => {
      const s = b.toString('utf8')
      output += s
      if (output.length > MAX_OUTPUT) { output = output.slice(-MAX_OUTPUT); truncated = true }
      opts.onOutput?.(s)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)

    const killTree = () => {
      try { if (child.pid) process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ }
      setTimeout(() => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ } }, 2000).unref()
    }
    const timer = setTimeout(() => { timedOut = true; killTree() }, timeoutMs)
    const onAbort = () => { aborted = true; killTree() }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const finish = (exitCode: number) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode, output, durationMs: Date.now() - t0, timedOut, aborted, truncated })
    }
    child.on('error', (e) => { output += `\n[sandbox] failed to start: ${e.message}`; finish(127) })
    child.on('close', (code, sig) => finish(code ?? (sig ? 128 + 9 : 1)))
  })
}
