import fs from 'node:fs'
import path from 'node:path'
import { PROJECTS_DIR } from '../projectFs.ts'
import { exec, checkCommand, sandboxKind } from '../sandbox.ts'
import { runTool } from '../tools.ts'

const P = '_sbtest'
const ROOT = path.join(PROJECTS_DIR, P)
fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true })
let failed = 0
const ok = (c: boolean, m: string, extra = '') => { console.log(c ? 'PASS' : 'FAIL', m, c ? '' : extra); if (!c) failed++ }

console.log(`sandbox = ${sandboxKind()}`)
process.env.FORGE_API_KEY = 'sk-secret-should-not-leak'

let r = await exec(P, 'echo hello && pwd')
ok(r.exitCode === 0 && r.output.includes('hello') && r.output.includes(ROOT), 'runs in project root', r.output)

r = await exec(P, 'exit 3')
ok(r.exitCode === 3, 'reports non-zero exit code')

r = await exec(P, 'echo out; echo err 1>&2')
ok(r.output.includes('out') && r.output.includes('err'), 'captures stdout + stderr')

r = await exec(P, 'echo created > made.txt')
ok(fs.existsSync(path.join(ROOT, 'made.txt')), 'can write inside project')

r = await exec(P, 'env')
ok(!r.output.includes('sk-secret') && !r.output.includes('FORGE_API_KEY'), 'API keys not visible in env', r.output.slice(0, 300))

if (sandboxKind() !== 'local') {
  r = await exec(P, 'ls /home/user/forge-ai/server 2>&1; cat /home/user/forge-ai/server/config.ts 2>&1 | head -1')
  ok(!r.output.includes('config.ts\n') && /No such file/.test(r.output), 'server code / config invisible', r.output)
  r = await exec(P, `ls ${PROJECTS_DIR}`)
  ok(r.output.trim() === P, 'other projects invisible', r.output)
  r = await exec(P, 'touch /usr/local/x 2>&1; echo x > /etc/y 2>&1')
  ok(/Read-only|Permission denied/.test(r.output), 'system is read-only', r.output)
  r = await exec(P, 'ps -e | wc -l')
  ok(Number(r.output.trim()) < 8, 'PID namespace isolated (few processes)', r.output)
  r = await exec(P, 'curl -s -m 5 -o /dev/null -w "%{http_code}" https://registry.npmjs.org/ || echo NET_FAIL', { network: false })
  ok(/NET_FAIL|000/.test(r.output), 'network can be disabled', r.output)
}

let t0 = Date.now()
r = await exec(P, 'sleep 30', { timeoutMs: 1500 })
ok(r.timedOut && Date.now() - t0 < 6000, 'timeout kills long command')

const ac = new AbortController()
t0 = Date.now()
setTimeout(() => ac.abort(), 500)
r = await exec(P, 'sleep 30; echo never', { signal: ac.signal })
ok(r.aborted && !r.output.includes('never') && Date.now() - t0 < 5000, 'abort (Stop) kills command')

r = await exec(P, '(sleep 30; echo orphan > orphan.txt) & echo started', { timeoutMs: 1500 })
await new Promise((res) => setTimeout(res, 2500))
ok(!fs.existsSync(path.join(ROOT, 'orphan.txt')), 'background children do not survive')

const chunks: string[] = []
await exec(P, 'for i in 1 2 3; do echo line$i; sleep 0.2; done', { onOutput: (c) => chunks.push(c) })
ok(chunks.length >= 2, 'output is streamed in chunks', String(chunks.length))

r = await exec(P, 'yes | head -c 500000')
ok(r.truncated && r.output.length <= 200_000, 'huge output is capped')

ok(!!checkCommand('npm run dev'), 'rejects npm run dev')
ok(!!checkCommand('npx vite'), 'rejects bare vite dev server')
ok(!!checkCommand('sudo rm -rf /'), 'rejects sudo')
ok(checkCommand('npm run build') === null, 'allows npm run build')
ok(checkCommand('npm test') === null, 'allows npm test')

const tr = await runTool(P, 'run_command', { command: 'echo via-tool && exit 2' })
ok(tr.exitCode === 2 && tr.output.includes('via-tool') && tr.output.includes('Exit code: 2'), 'run_command tool reports output + exit code')
const tr2 = await runTool(P, 'run_command', { command: 'npm run dev' })
ok(!!tr2.isError, 'run_command tool refuses dev server')

fs.rmSync(ROOT, { recursive: true, force: true })
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
