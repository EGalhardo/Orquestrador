import type { FileNode } from '../types'
import { findByPath, sleep, walk } from '../lib/utils'

export interface CommandResult { output: string; exitCode: number; durationMs: number }

/**
 * Sandboxed command runner operating on the in-browser workspace.
 * Supports a small set of read-only shell builtins; other commands return
 * a clear "not available" result. Replace with a remote sandbox adapter.
 */
export const CommandService = {
  async run(cmd: string, root: FileNode[], signal?: AbortSignal): Promise<CommandResult> {
    const t0 = performance.now()
    const [bin, ...args] = cmd.trim().split(/\s+/)
    let output = ''
    let exitCode = 0
    await sleep(250 + Math.random() * 500, signal)
    switch (bin) {
      case 'ls': {
        const n = args[0] ? findByPath(root, args[0]) : undefined
        const list = args[0] ? n?.children : root
        if (!list) { output = `ls: ${args[0]}: No such file or directory`; exitCode = 1 } else output = list.map((c) => c.name + (c.type === 'folder' ? '/' : '')).join('\n')
        break
      }
      case 'cat': {
        const n = findByPath(root, args[0] ?? '')
        if (!n || n.type !== 'file') { output = `cat: ${args[0]}: No such file`; exitCode = 1 } else output = n.content ?? ''
        break
      }
      case 'find': case 'grep': {
        const q = args[args.length - 1] ?? ''
        const hits: string[] = []
        walk(root, (n, p) => { if (n.type === 'file' && (p.includes(q) || n.content?.includes(q))) hits.push(p) })
        output = hits.slice(0, 20).join('\n') || '(no matches)'
        break
      }
      case 'wc': {
        let files = 0; walk(root, (n) => { if (n.type === 'file') files++ })
        output = `${files} files`
        break
      }
      case 'npx': case 'npm': {
        // Static checks we can genuinely perform in-browser: bracket balance per file.
        const problems: string[] = []
        walk(root, (n, p) => {
          if (n.type !== 'file' || !/\.(tsx?|jsx?)$/.test(n.name) || !n.content) return
          const bal = (o: string, c: string) => n.content!.split(o).length - n.content!.split(c).length
          if (bal('{', '}') || bal('(', ')')) problems.push(`${p}: unbalanced brackets`)
        })
        exitCode = problems.length ? 1 : 0
        output = `$ ${cmd}\n` + (problems.length ? problems.join('\n') : '✓ static check passed (browser sandbox)')
        break
      }
      default:
        output = `${bin}: command not available in browser sandbox`
        exitCode = 127
    }
    return { output, exitCode, durationMs: Math.round(performance.now() - t0) }
  },
}
