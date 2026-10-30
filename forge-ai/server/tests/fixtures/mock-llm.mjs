// Fake OpenAI-compatible LLM for tests/demos without API keys.
// Validates tool_call/tool pairing like the real API (400 if broken).
//   "PREVIEW" in the prompt → calls start_process("npm run dev"); otherwise replies with the history size.
// Usage: node server/tests/fixtures/mock-llm.mjs  (port 9999) — then set provider=openai, baseUrl=http://127.0.0.1:9999/v1
import http from 'node:http'
const PORT = Number(process.env.MOCK_PORT || 9999)
http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c
  let body; try { body = JSON.parse(b) } catch { res.end('{}'); return }
  const msgs = body.messages ?? []
  for (let i = 0; i < msgs.length; i++) for (const tc of msgs[i].tool_calls ?? []) {
    if (!msgs.slice(i + 1).some((m) => m.role === 'tool' && m.tool_call_id === tc.id)) {
      res.writeHead(400, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ error: { message: `tool_call without result: ${tc.id}` } }))
    }
  }
  const lastUser = [...msgs].reverse().find((m) => m.role === 'user')?.content ?? ''
  const last = msgs.at(-1)
  let message
  if (last?.role === 'user' && /PREVIEW/.test(lastUser)) message = { role: 'assistant', content: null, tool_calls: [{ id: 'sp' + msgs.length, type: 'function', function: { name: 'start_process', arguments: JSON.stringify({ command: 'npm run dev' }) } }] }
  else if (last?.role === 'tool' && /PREVIEW/.test(lastUser)) message = { role: 'assistant', content: 'O servidor de desenvolvimento está a correr.' }
  else message = { role: 'assistant', content: `ok (${msgs.length} messages, history valid)` }
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message }], usage: { prompt_tokens: 120, completion_tokens: 30 } }))
}).listen(PORT, '127.0.0.1', () => console.log(`mock LLM on ${PORT}`))
