// Phase 5: context fitting, plan, retries/backoff, truncation, Gemini thought signatures, checkpoints, new tools, inspector.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
process.env.FORGE_LLM_TIMEOUT_S ||= '2'
process.env.FORGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-p5-'))
const { fitContext, estimateTokens, normalisePlan } = await import('../agent.ts')
const { callLLM, backoffMs } = await import('../llm.ts')
const cp = await import('../checkpoints.ts')
const { runTool } = await import('../tools.ts')
const { PROJECTS_DIR } = await import('../projectFs.ts')
const { findChromium, inspect } = await import('../inspector.ts')
type Msg = import('../llm.ts').Msg

let fail = 0
const ok = (c: boolean, n: string) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++ }

// ---------- fitContext ----------
const big = 'y'.repeat(8000)
const h: Msg[] = [{ role: 'user', content: 'ORIGINAL REQUEST' }]
for (let i = 0; i < 60; i++) h.push(
  { role: 'assistant', text: 'step ' + i, toolCalls: [{ id: 'c' + i, name: 'read_file', args: { path: `f${i}.js` } }, { id: 'd' + i, name: 'run_command', args: { command: 'x' } }] },
  { role: 'tool', results: [{ id: 'c' + i, name: 'read_file', output: big }, { id: 'd' + i, name: 'run_command', output: big }] })
const lastBefore = JSON.stringify(h.slice(-4))
ok(fitContext(h, 20_000), 'fitContext reports compaction when over budget')
ok(estimateTokens(h) <= 20_000, `fits budget (${estimateTokens(h)} tokens)`)
ok((h[0] as { content: string }).content === 'ORIGINAL REQUEST', 'original request kept')
ok(h[2].role === 'user' && (h[2] as { content: string }).content.startsWith('[Context note]'), 'context note inserted')
ok(JSON.stringify(h.slice(-4)) === lastBefore, 'most recent turns untouched')
let paired = true
for (let i = 0; i < h.length; i++) {
  const m = h[i]
  if (m.role === 'assistant' && m.toolCalls.length) { const n = h[i + 1]; if (n?.role !== 'tool' || n.results.map((r) => r.id).join() !== m.toolCalls.map((c) => c.id).join()) paired = false }
  if (m.role === 'tool' && h[i - 1]?.role !== 'assistant') paired = false
}
ok(paired, 'every tool call still paired with its result')
let alternates = true
for (let i = 1; i < h.length; i++) if (h[i].role === 'user' && h[i - 1].role === 'user') alternates = false
ok(alternates, 'no two consecutive user messages')
const n1 = h.length
for (let i = 60; i < 80; i++) h.push({ role: 'assistant', text: '', toolCalls: [{ id: 'e' + i, name: 'read_file', args: { path: 'z' } }] }, { role: 'tool', results: [{ id: 'e' + i, name: 'read_file', output: big }] })
fitContext(h, 20_000)
ok(h.filter((m) => m.role === 'user' && m.content.startsWith('[Context note]')).length === 1 && /older step/.test((h[2] as { content: string }).content), `second compaction reuses the note (${n1}→${h.length} msgs)`)
ok(!fitContext([{ role: 'user', content: 'hi' }], 1000), 'small history untouched')

// ---------- plan ----------
ok(normalisePlan([{ title: 'A', status: 'done' }, { title: 'B', status: 'weird' }, { title: '' }])?.map((p) => p.status).join() === 'done,pending', 'normalisePlan fixes statuses / drops empty')
ok(normalisePlan('[{"title":"X","status":"in_progress"}]')?.[0].status === 'in_progress', 'normalisePlan accepts JSON string')
ok(normalisePlan('nope') === null && normalisePlan({}) === null, 'normalisePlan rejects invalid')

// ---------- backoff ----------
ok(backoffMs(1, '3') === 3000, 'retry-after seconds honoured')
ok(backoffMs(1, null, '{"retryDelay": "7s"}') === 7250 && backoffMs(1, null, 'Please retry in 4.5s.') === 4750, 'Google retryDelay / "retry in Xs" honoured')
ok(backoffMs(3) >= 4000 && backoffMs(3) < 4400 && backoffMs(9) <= 60_400, 'exponential backoff')

// ---------- LLM: retries, truncation, thought signature ----------
let hits = 0; const bodies: any[] = []
let mode: 'retry' | 'quota' = 'retry'
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    hits++; bodies.push(JSON.parse(b))
    if (mode === 'quota') { res.writeHead(429); return res.end(JSON.stringify({ error: { message: 'Quota exceeded for metric generate_requests_per_day' } })) }
    if (hits === 1) { res.writeHead(503, { 'retry-after': '0' }); return res.end('{"error":{"message":"overloaded"}}') }
    if (hits === 2) { res.writeHead(429, { 'retry-after': '0' }); return res.end('{"error":{"message":"slow down"}}') }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '', tool_calls: [
      { id: 'k1', function: { name: 'list_files', arguments: '{}' }, extra_content: { google: { thought_signature: 'SIG123' } } },
      { id: 'k2', function: { name: 'write_file', arguments: '{"path":"a.js","content":"cons' } }] } }], usage: { prompt_tokens: 5, completion_tokens: 7 } }))
  })
})
await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`
const cfg = { provider: 'openai' as const, model: 'm', apiKey: 'k', baseUrl: base }
const retries: number[] = []
const t = await callLLM(cfg, 'sys', [{ role: 'user', content: 'go' }], [], { signal: new AbortController().signal, onRetry: (i) => retries.push(i.attempt) })
ok(hits === 3 && retries.join() === '1,2', `retried 503 and 429 then succeeded (hits=${hits})`)
ok(t.truncated, 'finish_reason=length → truncated')
ok(!!t.toolCalls[1].argsError && !t.toolCalls[0].argsError, 'invalid JSON args flagged with argsError')
ok((t.toolCalls[0].extra as any)?.google?.thought_signature === 'SIG123', 'thought signature captured')
hits = 3; bodies.length = 0
await callLLM(cfg, 'sys', [{ role: 'user', content: 'go' }, { role: 'assistant', text: '', toolCalls: [t.toolCalls[0]] }, { role: 'tool', results: [{ id: 'k1', name: 'list_files', output: 'x' }] }], [], new AbortController().signal)
ok(bodies[0].messages[2].tool_calls[0].extra_content?.google?.thought_signature === 'SIG123', 'thought signature echoed back to provider')
bodies.length = 0
await callLLM({ ...cfg, model: 'other-model' }, 'sys', [{ role: 'user', content: 'go' }, { role: 'assistant', text: '', toolCalls: [t.toolCalls[0]] }, { role: 'tool', results: [{ id: 'k1', name: 'list_files', output: 'x' }] }], [], new AbortController().signal)
ok(bodies[0].messages[2].tool_calls[0].extra_content === undefined, 'signature from another model not echoed (non-Gemini provider)')
ok(t.toolCalls[0].model === 'm', 'tool calls tagged with producing model')
mode = 'quota'; hits = 0
let quotaErr = ''
try { await callLLM(cfg, 's', [{ role: 'user', content: 'x' }], [], new AbortController().signal) } catch (e) { quotaErr = (e as Error).message }
ok(hits === 1 && /429/.test(quotaErr), 'daily quota 429 is NOT retried')
{
  const { shouldSwitchModel } = await import('../agent.ts')
  const { LlmError } = await import('../llm.ts')
  ok(shouldSwitchModel(new LlmError(429, 'q', true)) && shouldSwitchModel(new LlmError(503, 'x')) && !shouldSwitchModel(new LlmError(400, 'bad')) && !shouldSwitchModel(new Error('x')), 'model switch only on quota/overload')
}
mode = 'retry'; hits = 0
const ac = new AbortController()
const pAbort = callLLM(cfg, 's', [{ role: 'user', content: 'x' }], [], { signal: ac.signal, onRetry: () => ac.abort() }).then(() => 'resolved', (e) => (e as Error).name)
ok((await pAbort) === 'AbortError', 'abort during retry wait stops immediately')
srv.close()
// Hung provider: per-request timeout → retried, then succeeds
{
  let n = 0
  const hang = http.createServer((req, res) => { n++; if (n === 1) return; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] })) })
  await new Promise<void>((r) => hang.listen(0, '127.0.0.1', r))
  const why: string[] = []
  const r2 = await callLLM({ provider: 'openai', model: 'm', apiKey: 'k', baseUrl: `http://127.0.0.1:${(hang.address() as { port: number }).port}` }, 's', [{ role: 'user', content: 'x' }], [], { signal: new AbortController().signal, onRetry: (i) => why.push(i.reason) })
  ok(r2.text === 'ok' && n === 2 && /timeout/.test(why[0] ?? ''), 'hung request times out and is retried')
  hang.closeAllConnections(); hang.close()
}

// ---------- checkpoints ----------
const proj = `zz-p5-${process.pid}`
const root = path.join(PROJECTS_DIR, proj)
fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true })
fs.writeFileSync(path.join(root, 'a.txt'), 'one')
fs.writeFileSync(path.join(root, 'node_modules', 'x', 'i.js'), 'dep')
try {
  const c1 = await cp.snapshot(proj, 'first')
  ok(!!c1 && /^[0-9a-f]{40}$/.test(c1!), 'snapshot creates a commit')
  ok((await cp.snapshot(proj, 'same')) === c1, 'no-op snapshot reuses HEAD')
  fs.writeFileSync(path.join(root, 'a.txt'), 'two'); fs.writeFileSync(path.join(root, 'b.txt'), 'new'); fs.mkdirSync(path.join(root, 'src')); fs.writeFileSync(path.join(root, 'src', 'c.js'), 'c')
  const c2 = await cp.snapshot(proj, 'second')
  ok(c2 !== c1, 'changed files → new snapshot')
  ok((await cp.diffSince(proj, c1!)).sort().join() === 'a.txt,b.txt,src/c.js', 'diffSince lists changed files')
  const r = await cp.restore(proj, c1!)
  ok(fs.readFileSync(path.join(root, 'a.txt'), 'utf8') === 'one' && !fs.existsSync(path.join(root, 'b.txt')) && !fs.existsSync(path.join(root, 'src', 'c.js')), 'restore brings back old content and removes new files')
  ok(fs.existsSync(path.join(root, 'node_modules', 'x', 'i.js')), 'restore keeps node_modules')
  ok(r.changed.length === 3, 'restore reports changed files')
  await cp.restore(proj, c2!)
  ok(fs.readFileSync(path.join(root, 'a.txt'), 'utf8') === 'two' && fs.existsSync(path.join(root, 'src', 'c.js')), 'a restore can itself be undone')
  ok(!fs.existsSync(path.join(root, '.git')), "project's own .git not created")
  ok((await cp.list(proj)).length >= 4, 'list returns history')
  let bad = ''; try { await cp.restore(proj, 'zzz;rm') } catch (e) { bad = (e as Error).message }
  ok(/inválido/.test(bad), 'invalid hash rejected')

  // ---------- new tools ----------
  const w = await runTool(proj, 'write_file', { path: 'big.js', content: 'const a = [\n' })
  const a1 = await runTool(proj, 'append_file', { path: 'big.js', content: '  1,\n  2,\n' })
  ok(!a1.isError && !a1.warning, 'append_file on partial file: no premature syntax error')
  await runTool(proj, 'append_file', { path: 'big.js', content: ']\nexport default a\n' })
  ok(fs.readFileSync(path.join(root, 'big.js'), 'utf8') === 'const a = [\n  1,\n  2,\n]\nexport default a\n' && !!w, 'append_file builds the full file')
  const tpl = await runTool(proj, 'use_template', { name: 'fullstack-react' })
  ok(!tpl.isError && fs.existsSync(path.join(root, 'server', 'app.js')) && fs.existsSync(path.join(root, 'vite.config.js')), 'use_template copies files')
  ok(/AGENTS|Estrutura/.test(tpl.output) && (tpl.changedFiles?.length ?? 0) > 8, 'use_template returns guide + file list')
  fs.writeFileSync(path.join(root, 'src', 'App.jsx'), 'mine')
  await runTool(proj, 'use_template', { name: 'fullstack-react' })
  ok(fs.readFileSync(path.join(root, 'src', 'App.jsx'), 'utf8') === 'mine', 'use_template never overwrites existing files')
  ok((await runTool(proj, 'use_template', { name: 'nope' })).isError === true, 'unknown template rejected')
  ok((await runTool(proj, 'inspect_app', {})).isError === true, 'inspect_app without a server → clear error')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

// ---------- inspector ----------
if (!findChromium()) console.log('SKIP inspector (no Chromium)')
else {
  const page = http.createServer((req, res) => {
    if (req.url === '/missing.js') { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<meta charset="utf-8"><title>T</title><h1>Olá Forge</h1><button>Go</button><script>console.error("boom-console"); setTimeout(()=>{throw new Error("boom-uncaught")},10)</script><script src="/missing.js"></script>')
  })
  await new Promise<void>((r) => page.listen(0, '127.0.0.1', r))
  const r = await inspect(`http://127.0.0.1:${(page.address() as { port: number }).port}/`)
  ok(r.title === 'T' && /Olá Forge/.test(r.text), 'inspector reads title and visible text')
  ok(r.consoleErrors.some((e) => /boom-console/.test(e)), 'inspector captures console.error')
  ok(r.pageErrors.some((e) => /boom-uncaught/.test(e)), 'inspector captures uncaught exceptions')
  ok(r.failedRequests.some((e) => /missing\.js/.test(e)), 'inspector captures failed requests')
  ok(r.elements.buttons === 1 && (r.screenshot ?? '').startsWith('data:image/jpeg;base64,'), 'element counts + screenshot')
  page.close()
}
fs.rmSync(process.env.FORGE_DATA_DIR!, { recursive: true, force: true })
if (fail) { console.log(`FAILED ${fail}`); process.exit(1) } else console.log('ALL PASSED')
process.exit(0)
