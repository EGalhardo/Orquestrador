import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { PROJECTS_DIR } from '../projectFs.ts'
import * as procs from '../processes.ts'
import { runTool } from '../tools.ts'
import { exec } from '../sandbox.ts'

let failed = 0
const ok = (c: boolean, m: string, extra = '') => { console.log(c ? 'PASS' : 'FAIL', m, c ? '' : extra); if (!c) failed++ }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const portOpen = (port: number) => new Promise<boolean>((res) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true) }); s.once('error', () => res(false)) })

// ---------- project with a real Vite app ----------
const P = '_proctest'
const ROOT = path.join(PROJECTS_DIR, P)
fs.rmSync(ROOT, { recursive: true, force: true })
fs.cpSync(path.join(PROJECTS_DIR, 'demo-app'), ROOT, { recursive: true, filter: (s) => s !== path.join(PROJECTS_DIR, 'demo-app', 'dist') && !s.startsWith(path.join(PROJECTS_DIR, 'demo-app', 'node_modules')) })
if (!fs.existsSync(path.join(ROOT, 'node_modules', '.bin', 'vite'))) { const i = await exec(P, 'rm -rf node_modules && npm install', { timeoutMs: 300_000 }); console.log('npm install exit', i.exitCode) }

// 0. command adaptation (regression: vite collided with Forge's own port 5173)
ok(procs.adaptCommand(ROOT, 'npm run dev', 3105) === 'npm run dev -- --port 3105 --strictPort --host 127.0.0.1', 'vite script gets explicit port/host')
ok(procs.adaptCommand(ROOT, 'npx vite', 3105) === 'npx vite --port 3105 --strictPort --host 127.0.0.1', 'direct vite gets explicit port/host')
ok(procs.adaptCommand(ROOT, 'npm run dev -- --port 4000', 3105) === 'npm run dev -- --port 4000', 'user-chosen port is respected')
ok(procs.adaptCommand(ROOT, 'npm run build', 3105) === 'npm run build', 'build scripts untouched')
ok(procs.adaptCommand(ROOT, 'node server.js', 3105) === 'node server.js', 'unknown commands untouched (use $PORT)')

// 1. dev server via agent tool
const r = await runTool(P, 'start_process', { command: 'npm run dev' })
ok(!r.isError && /RUNNING on port \d+/.test(r.output), 'start_process starts vite and detects port', r.output.slice(0, 400))
const p1 = procs.get(r.processId!)!
ok(!!p1.previewPort, 'preview proxy port assigned', String(p1.previewPort))

// 2. page through proxy (Host rewritten, no iframe blocking)
const res = await fetch(`http://127.0.0.1:${p1.previewPort}/`, { headers: { host: 'example-preview.e2b.app' } })
const html = await res.text()
ok(res.status === 200 && html.includes('id="root"') && html.includes('/@vite/client'), 'proxy serves the app (foreign Host accepted)', `${res.status} ${html.slice(0, 200)}`)
ok(!html.includes('Forge — AI Dev Workspace'), 'preview is the USER app, not Forge itself')
ok(p1.port !== 5173 && p1.port !== 8787, 'dev server does not use Forge ports', String(p1.port))
ok(!res.headers.get('x-frame-options'), 'no X-Frame-Options (iframe allowed)')
const js = await fetch(`http://127.0.0.1:${p1.previewPort}/src/App.jsx`)
ok(js.status === 200 && (await js.text()).includes('Olá'), 'proxy serves transformed source modules')

// 3. HMR websocket upgrade through the proxy
const wsOk = await new Promise<string>((resolve) => {
  const s = net.connect(p1.previewPort!, '127.0.0.1', () => {
    s.write(`GET /?token=x HTTP/1.1\r\nHost: preview.e2b.app\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: vite-hmr\r\n\r\n`)
  })
  s.once('data', (d) => { resolve(d.toString().split('\r\n')[0]); s.destroy() })
  s.once('error', (e) => resolve('error ' + e.message))
  setTimeout(() => resolve('timeout'), 4000)
})
ok(/101|400|403/.test(wsOk), 'websocket upgrade is forwarded to the dev server', wsOk)

// 4. duplicate start returns same process
const again = await procs.start(P, 'npm run dev')
ok(again.id === p1.id, 'same command is not started twice')

// 5. logs tool
const lg = await runTool(P, 'get_process_logs', { id: p1.id })
ok(/VITE|Local/.test(lg.output), 'get_process_logs returns server logs', lg.output.slice(0, 200))

// 6. app honouring $PORT without printing a URL
fs.writeFileSync(path.join(ROOT, 'srv.cjs'), "require('http').createServer((q,s)=>s.end('silent-ok')).listen(process.env.PORT,'127.0.0.1')")
const silent = await procs.start(P, 'node srv.cjs', 'silent')
const sReady = await procs.waitReady(silent.id, 10_000)
ok(sReady?.status === 'running' && !!sReady.previewPort, 'port detected via $PORT fallback', JSON.stringify(sReady))
if (sReady?.previewPort) ok((await (await fetch(`http://127.0.0.1:${sReady.previewPort}/`)).text()) === 'silent-ok', 'silent app reachable through proxy')

// 7. crash detection
const crash = await runTool(P, 'start_process', { command: 'node -e "console.error(\'boom: missing module\'); process.exit(3)"' })
ok(!!crash.isError && /ENDED/.test(crash.output) && crash.output.includes('boom'), 'crashing process reported with logs', crash.output.slice(0, 300))

// 8. limit per project (2 running + 1 more allowed = 3)
const third = await procs.start(P, 'node -e "setInterval(()=>{},1000)"', 'idle')
let limitErr = ''
try { await procs.start(P, 'node -e "setInterval(()=>{},999)"') } catch (e) { limitErr = (e as Error).message }
ok(/Limit reached/.test(limitErr), 'max processes per project enforced', limitErr)

// 9. stop → dev server and proxy both closed, no survivors
const appPort = p1.port!, prevPort = p1.previewPort!
await runTool(P, 'stop_process', { id: p1.id })
await sleep(3000)
ok(!(await portOpen(appPort)) && !(await portOpen(prevPort)), 'stop closes dev server and preview proxy')
procs.stop(silent.id); procs.stop(third.id)
await sleep(3000)
const survivors = (await exec('demo-app', 'true')) && fs.readFileSync('/proc/loadavg', 'utf8') // noop to keep types happy
void survivors
const ps = (await import('node:child_process')).execSync("ps -eo args | grep -E 'srv.cjs|setInterval|vite' | grep -v grep || true").toString()
ok(!ps.includes('srv.cjs') && !ps.includes('setInterval') && !ps.includes(`${P}/node_modules/.bin/vite`), 'no orphan processes after stop', ps)

// 10. restart
const re = await procs.start(P, 'npm run dev')
const reReady = await procs.waitReady(re.id)
const re2 = await procs.restart(re.id)
const re2Ready = await procs.waitReady(re2.id)
ok(reReady?.status === 'running' && re2Ready?.status === 'running', 'restart brings the server back', JSON.stringify(re2Ready))
procs.stopAll()
await sleep(2500)

fs.rmSync(ROOT, { recursive: true, force: true })
console.log(failed ? `${failed} FAILED` : 'ALL PASSED')
process.exit(failed ? 1 : 0)
