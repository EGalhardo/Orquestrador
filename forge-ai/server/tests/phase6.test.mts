// Phase 6: GitHub integration, images (vision), interactive browser, AI team (orchestrator), secrets.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { execFileSync } from 'node:child_process'
process.env.FORGE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-p6-'))
process.env.FORGE_GITHUB_ALLOW_LOCAL = '1'
const { db } = await import('../db.ts')
const repo = await import('../repo.ts')
const cfgMod = await import('../config.ts')
const gh = await import('../github.ts')
const { runTool } = await import('../tools.ts')
const { PROJECTS_DIR } = await import('../projectFs.ts')
const { callLLM } = await import('../llm.ts')
const { urlAllowed, browserAction, closeSession } = await import('../browser.ts')
const { findChromium } = await import('../inspector.ts')
const { runAgent } = await import('../agent.ts')
const { sandboxKind } = await import('../sandbox.ts')

let fail = 0
const ok = (c: boolean, n: string) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++ }
const listen = (srv: http.Server) => new Promise<number>((r) => srv.listen(0, '127.0.0.1', () => r((srv.address() as { port: number }).port)))
const readBody = (req: http.IncomingMessage) => new Promise<string>((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)) })

db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (1, 'a@b.c', 'A', 'x', 'admin', 0)").run()
const TOKEN = 'ghp_SECRETtoken1234567890'
const projects: string[] = []
const newProject = (tag: string) => { const p = `zz-p6-${tag}-${process.pid}`; fs.mkdirSync(path.join(PROJECTS_DIR, p), { recursive: true }); projects.push(p); return p }

try {
  // ---------- secrets ----------
  cfgMod.setSecret(1, 'gemini', 'AIzaFAKEkey000011112222')
  cfgMod.setSecret(1, 'github', TOKEN, { github_login: 'octo' })
  let s = cfgMod.listSecrets(1)
  ok(s.ai.gemini === '••••2222' && s.github.hint === '••••7890' && s.github.login === 'octo', 'secrets listed as hints only')
  ok(!JSON.stringify(s).includes(TOKEN) && !JSON.stringify(db.prepare('SELECT keys_enc FROM user_settings').all()).includes(TOKEN), 'token never stored/returned in clear')
  ok(cfgMod.getGithub(1).token === TOKEN, 'getGithub decrypts for server-side use')
  cfgMod.setConfig(1, { provider: 'gemini', model: 'gemini-3.6-flash' })
  ok(cfgMod.getConfig(1).apiKey === 'AIzaFAKEkey000011112222' && cfgMod.getGithub(1).token === TOKEN, 'AI config and GitHub token coexist')
  cfgMod.deleteSecret(1, 'github'); s = cfgMod.listSecrets(1)
  ok(s.github.hint === '' && s.github.login === '' && cfgMod.getConfig(1).apiKey !== '', 'deleting GitHub token keeps AI keys')

  // ---------- github: URL parsing ----------
  ok(gh.repoUrl('octo/app') === 'https://github.com/octo/app.git' && gh.repoUrl('https://github.com/octo/app.git') === 'https://github.com/octo/app.git' && gh.repoUrl('git@github.com:octo/app') === 'https://github.com/octo/app.git', 'repoUrl normalises owner/name, https and ssh')
  let bad = ''; process.env.FORGE_GITHUB_ALLOW_LOCAL = '0'; try { gh.repoUrl('https://evil.com/x/y') } catch (e) { bad = (e as Error).message }; process.env.FORGE_GITHUB_ALLOW_LOCAL = '1'
  ok(/inválido/.test(bad), 'non-GitHub hosts rejected')
  ok(gh.parseRemote('https://github.com/o/r.git')?.repo === 'r' && gh.parseRemote('git@github.com:o/r')?.owner === 'o', 'parseRemote')

  // ---------- github: real git flow against a local bare repo (inside the sandbox) ----------
  // The sandbox has its own /tmp: keep the test remote in a host path it can read (read-only).
  const tmp = fs.mkdtempSync(path.join(import.meta.dirname, '.tmp-git-'))
  projects.push('__tmpgit__:' + tmp)
  const bare = path.join(tmp, 'origin.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  const seed = path.join(tmp, 'seed')
  execFileSync('git', ['clone', '-q', bare, seed])
  fs.writeFileSync(path.join(seed, 'README.md'), '# hello\n')
  execFileSync('git', ['-C', seed, '-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-qam', 'init', '--allow-empty'])
  execFileSync('git', ['-C', seed, 'add', '-A']); execFileSync('git', ['-C', seed, '-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-qm', 'readme'])
  execFileSync('git', ['-C', seed, 'push', '-q', 'origin', 'main'])
  // The sandbox only binds the project dir; put the bare repo INSIDE a path the sandbox can see is not possible,
  // so for the test we let the sandbox read it via the read-only root bind (bwrap binds / read-only). Push needs write:
  // Serve it with git daemon on loopback (the sandbox shares the network namespace; /home is hidden).
  const { spawn } = await import('node:child_process')
  const net = await import('node:net')
  const gport = await new Promise<number>((r) => { const t = net.createServer(); t.listen(0, '127.0.0.1', () => { const p = (t.address() as { port: number }).port; t.close(() => r(p)) }) })
  const daemon = spawn('git', ['daemon', '--export-all', '--enable=receive-pack', `--base-path=${tmp}`, `--port=${gport}`, '--listen=127.0.0.1', '--reuseaddr', tmp], { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 800))
  const remote = `git://127.0.0.1:${gport}/origin.git`
  const proj = newProject('git')
  const auth = { token: TOKEN, login: 'octo' }
  const ctx = { github: auth }
  let r = await runTool(proj, 'github', { action: 'clone', repo: remote }, ctx)
  if (r.isError) console.log(r.output)
  ok(!r.isError && fs.existsSync(path.join(PROJECTS_DIR, proj, 'README.md')), `clone into empty project (${sandboxKind()})`)
  ok(!r.output.includes(TOKEN) && !fs.readFileSync(path.join(PROJECTS_DIR, proj, '.git', 'config'), 'utf8').includes(TOKEN), 'token not in output nor .git/config')
  r = await runTool(proj, 'github', { action: 'clone', repo: remote }, ctx)
  ok(r.isError === true && /não está vazio/.test(r.output), 'clone refuses non-empty project')
  fs.writeFileSync(path.join(PROJECTS_DIR, proj, 'app.js'), 'console.log(1)\n')
  r = await runTool(proj, 'github', { action: 'status' }, ctx)
  ok(/app\.js/.test(r.output), 'status shows untracked file')
  r = await runTool(proj, 'github', { action: 'branch', name: 'feature/x' }, ctx)
  ok(!r.isError && /feature\/x/.test(r.output), 'branch creates and switches')
  r = await runTool(proj, 'github', { action: 'commit', message: 'Add "app" $(whoami)' }, ctx)
  ok(!r.isError && /Add "app" \$\(whoami\)/.test(execFileSync('git', ['-C', path.join(PROJECTS_DIR, proj), 'log', '-1', '--format=%s']).toString()), 'commit with special chars in message (no shell injection)')
  ok(/octo/.test(execFileSync('git', ['-C', path.join(PROJECTS_DIR, proj), 'log', '-1', '--format=%an']).toString()), 'commit author = GitHub login')
  r = await runTool(proj, 'github', { action: 'commit', message: 'again' }, ctx)
  ok(/Nada para fazer commit/.test(r.output), 'commit with no changes is a clear no-op')
  r = await runTool(proj, 'github', { action: 'push' }, ctx)
  ok(!r.isError && execFileSync('git', ['--git-dir', bare, 'log', '-1', '--format=%s', 'feature/x']).toString().startsWith('Add "app"'), 'push: branch arrives on the remote')
  // Someone else pushes to main; pull brings it in.
  fs.writeFileSync(path.join(seed, 'NEWS.md'), 'novidade\n'); execFileSync('git', ['-C', seed, 'add', '-A']); execFileSync('git', ['-C', seed, '-c', 'user.name=s', '-c', 'user.email=s@x', 'commit', '-qm', 'news']); execFileSync('git', ['-C', seed, 'push', '-q', 'origin', 'main'])
  r = await runTool(proj, 'github', { action: 'checkout', name: 'main' }, ctx)
  r = await runTool(proj, 'github', { action: 'pull' }, ctx)
  ok(!r.isError && fs.existsSync(path.join(PROJECTS_DIR, proj, 'NEWS.md')), 'pull brings remote commits')
  r = await runTool(proj, 'github', { action: 'checkout', name: 'feature/x' }, ctx)
  ok(!r.isError && fs.existsSync(path.join(PROJECTS_DIR, proj, 'app.js')), 'checkout switches back to the feature branch')
  r = await runTool(proj, 'github', { action: 'branch', name: '../../etc' }, ctx)
  ok(r.isError === true && /inválido/.test(r.output), 'branch name validated')
  fs.writeFileSync(path.join(PROJECTS_DIR, proj, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\ntouch /tmp/forge-hook-ran\nexit 1\n', { mode: 0o755 })
  fs.writeFileSync(path.join(PROJECTS_DIR, proj, 'b.js'), 'x\n')
  r = await runTool(proj, 'github', { action: 'commit', message: 'hooks off' }, ctx)
  ok(!r.isError && !fs.existsSync('/tmp/forge-hook-ran'), 'repository hooks are disabled')

  // create_pr via mocked GitHub API
  const calls: { method: string; url: string; auth: string; body: string }[] = []
  const api = http.createServer(async (req, res) => {
    const body = await readBody(req)
    calls.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization), body })
    res.setHeader('content-type', 'application/json')
    if (req.url === '/user') return res.end(JSON.stringify({ login: 'octo' }))
    if (req.url === '/repos/octo/app' && req.method === 'GET') return res.end(JSON.stringify({ default_branch: 'main' }))
    if (req.url === '/repos/octo/app/pulls' && req.method === 'POST') { res.statusCode = 201; return res.end(JSON.stringify({ number: 7, html_url: 'https://github.com/octo/app/pull/7' })) }
    res.statusCode = 404; res.end('{}')
  })
  process.env.FORGE_GITHUB_API = `http://127.0.0.1:${await listen(api)}`
  execFileSync('git', ['-C', path.join(PROJECTS_DIR, proj), 'remote', 'set-url', 'origin', 'https://github.com/octo/app.git'])
  r = await runTool(proj, 'github', { action: 'create_pr', title: 'Nova feature', body: 'Descrição' }, ctx)
  const prCall = calls.find((c) => c.url.endsWith('/pulls'))
  ok(!r.isError && /#7/.test(r.output) && prCall?.auth === `Bearer ${TOKEN}` && JSON.parse(prCall.body).head === 'feature/x' && JSON.parse(prCall.body).base === 'main', 'create_pr: head=current branch, base=default branch, bearer token')
  r = await runTool(proj, 'github', { action: 'create_pr', title: 'x' }, { github: { token: '', login: '' } })
  ok(r.isError === true && /token/.test(r.output), 'create_pr without token → clear message')
  ok((await gh.verifyToken(TOKEN)).login === 'octo', 'verifyToken returns login')
  api.close(); daemon.kill()

  // ---------- images ----------
  const bodies: any[] = []
  const llm = http.createServer(async (req, res) => { bodies.push(JSON.parse(await readBody(req))); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url?.includes('/v1/messages') ? { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} } : { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] })) })
  const base = `http://127.0.0.1:${await listen(llm)}`
  const img = { mime: 'image/png', data: 'iVBORw0KGgo=', name: 'a.png' }
  await callLLM({ provider: 'openai', model: 'm', apiKey: 'k', baseUrl: base }, 's', [{ role: 'user', content: 'vê', images: [img] }], [], new AbortController().signal)
  const oc = bodies[0].messages[1].content
  ok(Array.isArray(oc) && oc[1].type === 'image_url' && oc[1].image_url.url === 'data:image/png;base64,iVBORw0KGgo=', 'OpenAI/Gemini: image sent as image_url data URL')
  await callLLM({ provider: 'anthropic', model: 'm', apiKey: 'k', baseUrl: base }, 's', [
    { role: 'user', content: 'go' },
    { role: 'assistant', text: '', toolCalls: [{ id: 't1', name: 'inspect_app', args: {} }] },
    { role: 'tool', results: [{ id: 't1', name: 'inspect_app', output: 'ok' }] },
    { role: 'user', auto: true, content: 'screenshot', images: [img] },
  ], [], new AbortController().signal)
  const am = bodies[1].messages
  ok(am.length === 3 && am[2].content[0].type === 'tool_result' && am[2].content.some((b: any) => b.type === 'image' && b.source.data === img.data), 'Anthropic: tool result + screenshot merged into one user turn')
  await callLLM({ provider: 'ollama', model: 'm', apiKey: '', baseUrl: base }, 's', [{ role: 'user', content: 'vê', images: [img] }], [], new AbortController().signal)
  ok(typeof bodies[2].messages[1].content === 'string' && /omitida/.test(bodies[2].messages[1].content), 'Ollama: images replaced by a text note')
  llm.close()

  const pImg = newProject('img')
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5f8e0e90000000049454e44ae426082', 'hex')
  fs.writeFileSync(path.join(PROJECTS_DIR, pImg, 'logo.png'), png)
  r = await runTool(pImg, 'read_image', { path: 'logo.png' })
  ok(!r.isError && r.image?.mime === 'image/png' && r.image.data === png.toString('base64'), 'read_image returns the image for the model')
  ok((await runTool(pImg, 'read_image', { path: 'x.svg' })).isError === true, 'read_image rejects unsupported formats')
  fs.symlinkSync('/etc/passwd', path.join(PROJECTS_DIR, pImg, 'leak.png'))
  fs.symlinkSync('/etc/passwd', path.join(PROJECTS_DIR, pImg, 'leak.txt'))
  ok((await runTool(pImg, 'read_image', { path: 'leak.png' })).isError === true && /symlink/.test((await runTool(pImg, 'read_file', { path: 'leak.txt' })).output), 'symlink escape blocked (read_image and read_file)')
  r = await runTool(pImg, 'write_file', { path: 'leak.txt', content: 'x' })
  ok(r.isError === true && fs.readFileSync('/etc/passwd', 'utf8').length > 10, 'write through outside symlink blocked')

  // ---------- browser ----------
  ok(urlAllowed('http://127.0.0.1:3000/', [3000]).ok && !urlAllowed('http://127.0.0.1:8787/api/auth/me', [3000]).ok && !urlAllowed('http://localhost:22/', []).ok, 'loopback limited to project ports')
  ok(!urlAllowed('http://192.168.1.1/', []).ok && !urlAllowed('http://169.254.169.254/latest', []).ok && !urlAllowed('http://10.0.0.5/', []).ok && !urlAllowed('file:///etc/passwd', []).ok, 'private IPs, metadata and file:// blocked')
  ok(urlAllowed('https://example.com/', []).ok, 'public https allowed')
  if (!findChromium()) console.log('SKIP browser session (no Chromium)')
  else {
    const secret = http.createServer((_q, res) => res.end('SECRET-INTERNAL'))
    const secretPort = await listen(secret)
    const app = http.createServer(async (req, res) => {
      if (req.url === '/api/login' && req.method === 'POST') { const b = JSON.parse(await readBody(req)); res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ ok: b.email === 'ana@x.pt' })) }
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(`<title>Login</title><h1>Entrar</h1><label for=e>Email</label><input id=e><label>Palavra-passe <input type=password id=p></label>
<select id=s aria-label="Perfil"><option>Utilizador</option><option>Admin</option></select>
<button onclick="fetch('/api/login',{method:'POST',body:JSON.stringify({email:document.getElementById('e').value})}).then(r=>r.json()).then(j=>{document.getElementById('out').textContent=j.ok?'Bem-vinda, Ana':'Erro de login'})">Entrar na conta</button>
<p id=out></p><img src="http://127.0.0.1:${secretPort}/x.png"><button onclick="boom()">Partir</button>`)
    })
    const port = await listen(app)
    const key = 'test-session'
    const ports = () => [port]
    let b = await browserAction(key, 'open', { url: '/' }, { ports, defaultPort: port })
    ok(!b.isError && /Página: http:\/\/127\.0\.0\.1:\d+\/ · "Login"/.test(b.output) && /input\[text\] "Email"/.test(b.output) && !!b.screenshot, 'open: title, labelled controls, screenshot')
    ok(/bloqueados pela política de rede/.test(b.output) && new RegExp(`${secretPort}`).test(b.output), 'sub-request to another local port blocked')
    b = await browserAction(key, 'fill', { label: 'Email', value: 'ana@x.pt' }, { ports })
    ok(!b.isError && /= "ana@x\.pt"/.test(b.output), 'fill by label')
    b = await browserAction(key, 'select', { label: 'Perfil', value: 'Admin' }, { ports })
    ok(!b.isError && /select "Perfil" = "Admin"/.test(b.output), 'select option by label')
    b = await browserAction(key, 'click', { text: 'Entrar na conta' }, { ports })
    ok(!b.isError && /Bem-vinda, Ana/.test(b.output), 'click by visible text → app reacts (fetch to own API)')
    b = await browserAction(key, 'click', { text: 'Partir' }, { ports })
    ok(/Exceções \(1\)/.test(b.output) && /boom/.test(b.output), 'errors caused by an action are reported')
    b = await browserAction(key, 'click', { text: 'Não existe' }, { ports })
    ok(b.isError === true && /Controlos visíveis/.test(b.output), 'missing element → error with available controls')
    b = await browserAction(key, 'open', { url: `http://127.0.0.1:${secretPort}/` }, { ports })
    ok(b.isError === true && /bloqueado/.test(b.output), 'open of a non-project local port refused')
    b = await browserAction(key, 'open', { url: 'http://127.0.0.1:8787/api/auth/me' }, { ports })
    ok(b.isError === true, 'Forge API not reachable from the agent browser')
    await closeSession(key)
    app.close(); secret.close()
  }

  // ---------- orchestrator (team) with a scripted fake model ----------
  const seen: { system: string; tools: string[] }[] = []
  let orchTurn = 0, subTurn = 0
  const fake = http.createServer(async (req, res) => {
    const body = JSON.parse(await readBody(req))
    const system = String(body.messages[0].content)
    const tools = (body.tools ?? []).map((t: any) => t.function.name)
    seen.push({ system, tools })
    const reply = (message: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message }], usage: { prompt_tokens: 10, completion_tokens: 5 } })) }
    const call = (name: string, args: unknown) => reply({ content: '', tool_calls: [{ id: `c${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] })
    if (system.includes('ORCHESTRATOR')) {
      orchTurn++
      if (orchTurn === 1) return call('update_plan', { items: [{ title: 'Backend', status: 'in_progress' }, { title: 'Rever', status: 'pending' }] })
      if (orchTurn === 2) return call('delegate', { role: 'backend', task: 'Cria api.txt com o texto API OK' })
      if (orchTurn === 3) return call('delegate', { role: 'reviewer', task: 'Revê api.txt' })
      return reply({ content: 'Equipa terminou: api.txt criado e revisto.' })
    }
    if (system.includes('BACKEND specialist')) {
      subTurn++
      if (subTurn === 1) return call('write_file', { path: 'api.txt', content: 'API OK' })
      return reply({ content: 'RELATÓRIO: criei api.txt (verificado).' })
    }
    if (system.includes('CODE REVIEWER')) return reply({ content: 'RELATÓRIO: sem problemas.' })
    return reply({ content: 'unexpected' })
  })
  const fbase = `http://127.0.0.1:${await listen(fake)}`
  const pTeam = newProject('team')
  db.prepare("INSERT INTO projects (name, owner_id, created_at) VALUES (?, 1, 0)").run(pTeam)
  repo.ensureConversation(1, 'teamconv1', pTeam)
  const events: any[] = []
  await runAgent({ userId: 1, config: { provider: 'openai', model: 'm', apiKey: 'k', baseUrl: fbase }, conversationId: 'teamconv1', project: pTeam, agent: 'team', instruction: 'Faz a API', signal: new AbortController().signal, emit: (e) => events.push(e) })
  const orch = seen.find((s) => s.system.includes('ORCHESTRATOR'))!
  const subB = seen.find((s) => s.system.includes('BACKEND specialist'))!
  const subR = seen.find((s) => s.system.includes('CODE REVIEWER'))!
  ok(orch.tools.includes('delegate') && !orch.tools.includes('write_file') && orch.tools.includes('run_command'), 'orchestrator: delegate + verification tools, no write tools')
  ok(subB.tools.includes('write_file') && !subB.tools.includes('delegate'), 'specialist: write tools, cannot delegate (no recursion)')
  ok(!subR.tools.includes('write_file') && !subR.tools.includes('github'), 'reviewer specialist is read-only')
  ok(fs.readFileSync(path.join(PROJECTS_DIR, pTeam, 'api.txt'), 'utf8') === 'API OK', 'specialist actually wrote the file')
  const parents = events.filter((e) => e.type === 'activity' && /^Sub-agente/.test(e.activity.label))
  const nested = events.filter((e) => e.type === 'activity' && e.parentId === parents[0]?.activity.id)
  ok(parents.length === 2 && parents[0].activity.label === 'Sub-agente Backend' && parents[1].activity.label === 'Sub-agente Revisor', 'two sub-agent activities (Backend, Revisor)')
  ok(nested.some((e) => e.activity.label === 'Write' || e.activity.kind === 'create'), "specialist's steps nested under its sub-agent activity")
  const done = events.find((e) => e.type === 'done')
  ok(done?.text.includes('Equipa terminou') && done.changed.includes('api.txt'), 'final orchestrator summary + changed files include specialist work')
  ok(done.usage.input >= 60, `usage aggregates specialists (${done.usage.input} input tokens)`)
  ok(events.some((e) => e.type === 'checkpoint'), 'one checkpoint for the whole team task')
  ok(repo.loadPlan('teamconv1').length === 2, "orchestrator plan saved; specialists don't overwrite it")
  const subReportToOrch = seen.filter((s) => s.system.includes('ORCHESTRATOR')).length
  ok(subReportToOrch === 4, 'orchestrator received both reports and finished')
  fake.close()
} finally {
  for (const p of projects) fs.rmSync(p.startsWith('__tmpgit__:') ? p.slice(11) : path.join(PROJECTS_DIR, p), { recursive: true, force: true })
  fs.rmSync(process.env.FORGE_DATA_DIR!, { recursive: true, force: true })
}
if (fail) { console.log(`FAILED ${fail}`); process.exit(1) } else console.log('ALL PASSED')
process.exit(0)
