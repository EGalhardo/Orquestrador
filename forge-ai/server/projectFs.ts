import fs from 'node:fs/promises'
import path from 'node:path'

export const PROJECTS_DIR = path.resolve(import.meta.dirname, 'projects')
const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache'])
const MAX_READ = 200_000

export interface TreeNode { name: string; type: 'file' | 'folder'; size?: number; content?: string; children?: TreeNode[] }

/** Resolve a user/model-supplied path strictly inside the project root. */
export function safe(project: string, rel = '.') {
  if (!/^[\w.-]+$/.test(project)) throw new Error('Invalid project name')
  const root = path.join(PROJECTS_DIR, project)
  const abs = path.resolve(root, rel.replace(/^\/+/, ''))
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`Path escapes project: ${rel}`)
  return { root, abs }
}

export async function listProjects() {
  await fs.mkdir(PROJECTS_DIR, { recursive: true })
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name)
}

export async function createProject(name: string) {
  const { abs } = safe(name)
  await fs.mkdir(abs, { recursive: true })
}

export async function tree(project: string, rel = '.', withContent = true): Promise<TreeNode[]> {
  const { abs } = safe(project, rel)
  const entries = await fs.readdir(abs, { withFileTypes: true })
  const out: TreeNode[] = []
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue
    const p = path.join(rel, e.name)
    if (e.isDirectory()) out.push({ name: e.name, type: 'folder', children: await tree(project, p, withContent) })
    else {
      const st = await fs.stat(path.join(abs, e.name))
      const node: TreeNode = { name: e.name, type: 'file', size: st.size }
      if (withContent && st.size < MAX_READ) node.content = await fs.readFile(path.join(abs, e.name), 'utf8')
      out.push(node)
    }
  }
  return out
}

export async function listFiles(project: string, rel = '.'): Promise<string[]> {
  const files: string[] = []
  const rec = async (r: string) => {
    const { abs } = safe(project, r)
    for (const e of await fs.readdir(abs, { withFileTypes: true })) {
      if (IGNORE.has(e.name)) continue
      const p = r === '.' ? e.name : `${r}/${e.name}`
      if (e.isDirectory()) await rec(p)
      else files.push(p)
    }
  }
  await rec(rel)
  return files
}

/** Resolve symlinks and make sure the real target is still inside the project (links can be created in the sandbox). */
export async function realInside(project: string, rel: string) {
  const { abs, root } = safe(project, rel)
  const real = await fs.realpath(abs)
  const realRoot = await fs.realpath(root)
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new Error(`Path escapes project (symlink): ${rel}`)
  return real
}

export async function readFile(project: string, rel: string) {
  const abs = await realInside(project, rel)
  const st = await fs.stat(abs)
  if (st.size > MAX_READ) throw new Error(`File too large (${st.size} bytes)`)
  return fs.readFile(abs, 'utf8')
}

export async function writeFile(project: string, rel: string, content: string) {
  const { abs } = safe(project, rel)
  // Refuse to write through a symlink that points outside the project.
  try { await realInside(project, path.dirname(rel) || '.') } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  try { const lst = await fs.lstat(abs); if (lst.isSymbolicLink()) await realInside(project, rel) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  let previous: string | null = null
  try { previous = await fs.readFile(abs, 'utf8') } catch { /* new file */ }
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
  return previous
}

export async function deleteFile(project: string, rel: string) {
  const { abs, root } = safe(project, rel)
  if (abs === root) throw new Error('Refusing to delete project root')
  await fs.rm(abs, { recursive: true })
}
