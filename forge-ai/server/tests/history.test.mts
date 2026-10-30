// Compaction of persisted agent histories.
import { compact } from '../agent.ts'
import type { Msg } from '../llm.ts'
let fail = 0
const ok = (c: boolean, n: string) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++ }
const big = 'x'.repeat(20000)
const h: Msg[] = []
for (let i = 0; i < 20; i++) h.push(
  { role: 'user', content: 'u' + i },
  { role: 'assistant', text: '', toolCalls: [{ id: 't' + i, name: 'write_file', args: { path: 'a.js', content: big } }] },
  { role: 'tool', results: [{ id: 't' + i, name: 'write_file', output: big }] },
  { role: 'assistant', text: 'done', toolCalls: [] })
const recent = JSON.stringify(h.slice(-12)), before = JSON.stringify(h).length
compact(h)
ok(JSON.stringify(h).length < before / 5, `old outputs shortened (${before} → ${JSON.stringify(h).length} chars)`)
ok(JSON.stringify(h.slice(-12)) === recent, 'last 12 messages untouched')
ok(h.length === 80, 'no messages dropped (tool call/result pairing preserved)')
ok((h[1] as any).toolCalls[0].args.path === 'a.js', 'tool call args other than content preserved')
// Robust against legacy/corrupt entries
compact([{ role: 'assistant', text: 'x' } as any, { role: 'tool' } as any, ...Array(12).fill({ role: 'user', content: '' })])
ok(true, 'tolerates malformed history entries')
if (fail) { console.log(`FAILED ${fail}`); process.exit(1) } else console.log('ALL PASSED')
