// Real end-to-end: ask the configured model (Gemini) to build a medium/complex app through the Forge API.
// Usage: node server/tests/e2e/gemini_build.mjs <project> "<instruction>"
const BASE = process.env.FORGE_URL || 'http://127.0.0.1:8787'
const [project, instruction] = process.argv.slice(2)
const hdr = { 'content-type': 'application/json', origin: BASE }
const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: hdr, body: JSON.stringify({ email: 'edlasiogalhardo@gmail.com', password: '123456789' }) })
const { token } = await login.json()
const auth = { ...hdr, authorization: `Bearer ${token}` }
await fetch(`${BASE}/api/projects`, { method: 'POST', headers: auth, body: JSON.stringify({ name: project }) })
const conversationId = process.env.CONV || ('e2e' + Date.now().toString(36))
const t0 = Date.now()
const res = await fetch(`${BASE}/api/agent/run`, { method: 'POST', headers: auth, body: JSON.stringify({ conversationId, project, agent: 'agent', instruction }) })
if (!res.ok) { console.log('HTTP', res.status, await res.text()); process.exit(1) }
const acts = new Map()
let buf = ''
const dec = new TextDecoder()
const ts = () => `[${Math.round((Date.now() - t0) / 1000)}s]`
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true })
  let i
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 2)
    if (!line.startsWith('data: ')) continue
    const e = JSON.parse(line.slice(6))
    if (e.type === 'activity') { acts.set(e.activity.id, e.activity); if (e.activity.kind !== 'thinking' || e.activity.label !== 'Thinking') console.log(ts(), '▶', e.activity.label, e.activity.target ?? '', e.activity.status !== 'loading' ? e.activity.status : '') }
    else if (e.type === 'update') {
      const a = acts.get(e.id); if (!a) continue
      Object.assign(a, e.patch)
      if (e.patch.retry) console.log(ts(), '⏳ retry', JSON.stringify(e.patch.retry))
      if (e.patch.status && e.patch.status !== 'loading' && a.label !== 'Thinking') console.log(ts(), '  ↳', a.label, a.target ?? '', e.patch.status, a.status === 'error' || a.label.startsWith('Inspected') ? String(a.details ?? '').slice(0, 600).replace(/\n/g, ' | ') : '', e.patch.screenshot ? '[screenshot]' : '')
      if (e.patch.status === 'error' && a.label === 'Thinking') console.log(ts(), '  ✕ LLM', a.details)
    }
    else if (e.type === 'plan') console.log(ts(), '📋', e.items.map((x) => `${x.status === 'done' ? '✓' : x.status === 'in_progress' ? '>' : '·'} ${x.title}`).join(' | '))
    else if (e.type === 'text') console.log(ts(), '💬', e.text.slice(0, 300).replace(/\n/g, ' '))
    else if (e.type === 'checkpoint') console.log(ts(), '📌 checkpoint', e.before.slice(0, 7), '→', e.after?.slice(0, 7))
    else if (e.type === 'done') console.log(ts(), '✅ DONE steps=', e.steps, 'usage=', JSON.stringify(e.usage), 'changed=', e.changed.length, '\n', e.text)
    else if (e.type === 'error') console.log(ts(), '❌ ERROR', e.message)
  }
}
console.log('conversation', conversationId, 'total', Math.round((Date.now() - t0) / 1000), 's')
