/**
 * Checkpoints: automatic snapshots of a project's files, so any agent task can be undone.
 * Uses a SEPARATE git directory per project (server/.data/checkpoints/<project>.git) with the
 * project folder as work tree — the project's own .git (if any) is never touched.
 * Restoring creates a new commit whose tree equals the target, so history stays linear and a
 * restore can itself be undone.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './db.ts'
import { safe } from './projectFs.ts'

const EXCLUDES = ['node_modules/', 'dist/', 'build/', '.next/', '.nuxt/', '.output/', '.cache/', '.vite/', 'coverage/', '.turbo/', '*.log', '.git/', '*.db-wal', '*.db-shm']

export interface Checkpoint { hash: string; message: string; at: number; files: number }

function gitDir(project: string) { return path.join(DATA_DIR, 'checkpoints', `${project}.git`) }

function git(project: string, args: string[], input?: string): Promise<string> {
  const { root } = safe(project)
  return new Promise((resolve, reject) => {
    const child = execFile('git', [`--git-dir=${gitDir(project)}`, `--work-tree=${root}`, ...args], {
      cwd: root, maxBuffer: 20 * 1024 * 1024, timeout: 60_000,
      env: { ...process.env, GIT_AUTHOR_NAME: 'EGalhardo IA', GIT_AUTHOR_EMAIL: 'egalhardo-ia@localhost', GIT_COMMITTER_NAME: 'EGalhardo IA', GIT_COMMITTER_EMAIL: 'egalhardo-ia@localhost', GIT_TERMINAL_PROMPT: '0' },
    }, (err, stdout, stderr) => (err ? reject(new Error(`git ${args[0]}: ${stderr || err.message}`)) : resolve(stdout)))
    if (input !== undefined) { child.stdin?.end(input) }
  })
}

// Serialise git operations per project (index.lock).
const queues = new Map<string, Promise<unknown>>()
function serial<T>(project: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(project) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(fn)
  queues.set(project, next.catch(() => undefined))
  return next
}

async function ensureRepo(project: string) {
  const dir = gitDir(project)
  if (!fs.existsSync(path.join(dir, 'HEAD'))) {
    fs.mkdirSync(dir, { recursive: true })
    await git(project, ['init', '-q'])
    await git(project, ['config', 'core.autocrlf', 'false'])
    await git(project, ['config', 'gc.auto', '256'])
  }
  fs.mkdirSync(path.join(dir, 'info'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'info', 'exclude'), EXCLUDES.join('\n') + '\n')
}

/** Snapshot the current files. Returns the commit hash (reuses HEAD if nothing changed). */
export function snapshot(project: string, message: string): Promise<string | null> {
  return serial(project, async () => {
    const { root } = safe(project)
    if (!fs.existsSync(root)) return null
    await ensureRepo(project)
    await git(project, ['add', '-A'])
    const hasHead = await git(project, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false)
    const dirty = !hasHead || (await git(project, ['status', '--porcelain'])).trim().length > 0
    if (dirty) await git(project, ['commit', '-q', '--allow-empty', '-m', message.slice(0, 200)])
    return (await git(project, ['rev-parse', 'HEAD'])).trim()
  })
}

export function list(project: string, limit = 50): Promise<Checkpoint[]> {
  return serial(project, async () => {
    if (!fs.existsSync(path.join(gitDir(project), 'HEAD'))) return []
    const out = await git(project, ['log', `-${limit}`, '--format=%H%x1f%ct%x1f%s', '--shortstat']).catch(() => '')
    const res: Checkpoint[] = []
    for (const block of out.split('\n')) {
      if (block.includes('\x1f')) { const [hash, ct, message] = block.split('\x1f'); res.push({ hash, at: Number(ct) * 1000, message, files: 0 }) }
      else if (res.length && /files? changed/.test(block)) res[res.length - 1].files = Number(block.trim().split(' ')[0]) || 0
    }
    return res
  })
}

/** Files that differ between a checkpoint and the current working tree (what a restore would change). */
export function diffSince(project: string, hash: string): Promise<string[]> {
  return serial(project, async () => {
    await ensureRepo(project)
    await git(project, ['add', '-A'])
    return (await git(project, ['diff', '--name-only', '--cached', hash])).split('\n').filter(Boolean)
  })
}

/** Make the project files identical to `hash` (current state is saved first, so this is undoable). */
export function restore(project: string, hash: string, label = 'Restaurado'): Promise<{ hash: string; changed: string[] }> {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) return Promise.reject(new Error('Checkpoint inválido'))
  return serial(project, async () => {
    await ensureRepo(project)
    await git(project, ['cat-file', '-e', `${hash}^{commit}`]).catch(() => { throw new Error('Checkpoint não encontrado') })
    await git(project, ['add', '-A'])
    if ((await git(project, ['status', '--porcelain'])).trim()) await git(project, ['commit', '-q', '-m', 'Estado antes de restaurar'])
    const changed = (await git(project, ['diff', '--name-only', 'HEAD', hash])).split('\n').filter(Boolean)
    // Index + work tree := target tree (removes tracked files that don't exist there).
    await git(project, ['read-tree', '-u', '--reset', hash])
    await git(project, ['clean', '-fdq']) // leftovers created after the snapshot (excluded dirs like node_modules are kept)
    await git(project, ['commit', '-q', '--allow-empty', '-m', `${label} (${hash.slice(0, 7)})`])
    return { hash: (await git(project, ['rev-parse', 'HEAD'])).trim(), changed }
  })
}
