import { BASE_URLS, type Config } from './config.ts'
import type { ToolDef } from './tools.ts'

/** Provider-neutral conversation format used by the agent loop. */
export type Msg =
  | { role: 'user'; content: string; images?: ImagePart[]; /** added by a tool (screenshot/read_image), not typed by the user */ auto?: boolean }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[] }
  | { role: 'tool'; results: { id: string; name: string; output: string; isError?: boolean }[] }
export interface ImagePart { mime: string; data: string /* base64 */; name?: string }
export const dataUrl = (i: ImagePart) => `data:${i.mime};base64,${i.data}`
export function parseDataUrl(url: string, name?: string): ImagePart | null {
  const m = url.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=]+)$/)
  return m ? { mime: m[1] === 'image/jpg' ? 'image/jpeg' : m[1], data: m[2], name } : null
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, string>
  /** Set when the model's arguments were not valid JSON (usually: output cut off at the token limit). */
  argsError?: string
  /** Provider data that must be echoed back verbatim (e.g. Gemini 3 `extra_content.google.thought_signature`). */
  extra?: unknown
  /** Model that produced this call (thought signatures are only valid for the same model). */
  model?: string
}
export interface LlmTurn {
  text: string
  toolCalls: ToolCall[]
  usage: { input: number; output: number }
  /** The response hit the output token limit. */
  truncated: boolean
}
export interface CallOpts {
  signal: AbortSignal
  /** Called before waiting to retry a transient provider error. */
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void
}

export async function callLLM(cfg: Config, system: string, messages: Msg[], tools: ToolDef[], opts: CallOpts | AbortSignal): Promise<LlmTurn> {
  const o: CallOpts = opts instanceof AbortSignal ? { signal: opts } : opts
  return cfg.provider === 'anthropic' ? anthropic(cfg, system, messages, tools, o) : openaiCompat(cfg, system, messages, tools, o)
}

// ---------------------------------------------------------------- transport + retries
const RETRY_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529])
// Provider overload spikes (Gemini 503 "high demand") often last minutes: be patient by default.
const MAX_ATTEMPTS = Number(process.env.FORGE_LLM_RETRIES || 12)
const REQUEST_TIMEOUT = Number(process.env.FORGE_LLM_TIMEOUT_S || 240) * 1000
const MAX_TOTAL_WAIT = Number(process.env.FORGE_LLM_MAX_WAIT_S || 600) * 1000

export class LlmError extends Error {
  status: number
  /** Daily/billing quota exhausted — waiting won't help, another model might. */
  hardQuota: boolean
  constructor(status: number, message: string, hardQuota = false) { super(message); this.status = status; this.hardQuota = hardQuota }
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, ms)
    const onAbort = () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** Exponential backoff with jitter; honours Retry-After (seconds or HTTP date) and Google's RetryInfo. */
export function backoffMs(attempt: number, retryAfter?: string | null, body = '') {
  if (retryAfter) {
    const s = Number(retryAfter)
    if (Number.isFinite(s)) return Math.min(60_000, s * 1000)
    const d = Date.parse(retryAfter)
    if (!Number.isNaN(d)) return Math.min(60_000, Math.max(0, d - Date.now()))
  }
  const g = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)
  if (g) return Math.min(60_000, Number(g[1]) * 1000 + 250)
  const hint = body.match(/retry in (\d+(?:\.\d+)?)\s*s/i)
  if (hint) return Math.min(60_000, Math.ceil(Number(hint[1]) * 1000) + 250)
  return Math.min(60_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 400)
}

async function post(url: string, headers: Record<string, string>, body: unknown, opts: CallOpts) {
  const host = new URL(url).hostname
  const local = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)
  let waited = 0
  for (let attempt = 1; ; attempt++) {
    let res: Response
    try {
      // Per-request timeout: a hung connection must not stall a long task forever.
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.any([opts.signal, AbortSignal.timeout(REQUEST_TIMEOUT)]) })
    } catch (e) {
      if (opts.signal.aborted) throw e
      if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') {
        const msg = `O fornecedor não respondeu em ${Math.round(REQUEST_TIMEOUT / 1000)}s.`
        if (attempt >= MAX_ATTEMPTS) throw new Error(msg)
        const w = backoffMs(attempt)
        opts.onRetry?.({ attempt, waitMs: w, reason: 'sem resposta (timeout)' })
        waited += w; await sleep(w, opts.signal); continue
      }
      const cause = (e as { cause?: { code?: string } }).cause?.code
      const msg = local
        ? `O servidor local em ${new URL(url).host} não respondeu${cause ? ` (${cause})` : ''}. Confirma que o Ollama está a correr (ollama serve) e tem memória suficiente.`
        : `Não foi possível contactar ${host}${cause ? ` (${cause})` : ''}. Verifica a ligação à internet ou o URL base.`
      if (local || attempt >= MAX_ATTEMPTS) throw new Error(msg)
      const w = backoffMs(attempt)
      if (waited + w > MAX_TOTAL_WAIT) throw new Error(msg)
      opts.onRetry?.({ attempt, waitMs: w, reason: `rede: ${cause ?? 'falha de ligação'}` })
      waited += w; await sleep(w, opts.signal); continue
    }
    let text: string
    try { text = await res.text() } catch (e) {
      if (opts.signal.aborted) throw e
      if (attempt >= MAX_ATTEMPTS) throw new Error(`Resposta interrompida: ${(e as Error).message}`)
      const w = backoffMs(attempt)
      opts.onRetry?.({ attempt, waitMs: w, reason: 'resposta interrompida' })
      waited += w; await sleep(w, opts.signal); continue
    }
    if (res.ok) {
      try { return JSON.parse(text) } catch { throw new LlmError(502, `Resposta inválida do fornecedor: ${text.slice(0, 200)}`) }
    }
    let msg = text
    try { const j = JSON.parse(text); msg = j.error?.message ?? j[0]?.error?.message ?? text } catch { /* raw */ }
    // A daily/monthly quota won't recover by waiting a few seconds.
    const hardQuota = res.status === 429 && /per ?day|daily|PerDay|per_day/i.test(text)
    if (RETRY_STATUS.has(res.status) && !hardQuota && attempt < MAX_ATTEMPTS) {
      const w = backoffMs(attempt, res.headers.get('retry-after'), text)
      if (waited + w <= MAX_TOTAL_WAIT) {
        opts.onRetry?.({ attempt, waitMs: w, reason: res.status === 429 ? 'limite de pedidos do fornecedor (429)' : `fornecedor indisponível (${res.status})` })
        waited += w; await sleep(w, opts.signal); continue
      }
    }
    throw new LlmError(res.status, `${res.status} ${res.statusText}: ${String(msg).slice(0, 500)}`, hardQuota)
  }
}

function parseArgs(raw: unknown): { args: Record<string, string>; argsError?: string } {
  if (raw && typeof raw === 'object') return { args: raw as Record<string, string> }
  const s = String(raw ?? '').trim()
  if (!s) return { args: {} }
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? { args: v } : { args: {}, argsError: 'arguments are not a JSON object' }
  } catch (e) {
    return { args: {}, argsError: `invalid JSON arguments (${(e as Error).message}; ${s.length} chars received)` }
  }
}

// ---------------------------------------------------------------- Anthropic Messages API
async function anthropic(cfg: Config, system: string, messages: Msg[], tools: ToolDef[], opts: CallOpts): Promise<LlmTurn> {
  const raw = messages.map((m) => {
    if (m.role === 'user') return { role: 'user', content: m.images?.length ? [
      ...m.images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
      { type: 'text', text: m.content || '(imagem)' },
    ] : m.content }
    if (m.role === 'assistant') return { role: 'assistant', content: [
      ...(m.text ? [{ type: 'text', text: m.text }] : []),
      ...m.toolCalls.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.args })),
    ] }
    return { role: 'user', content: m.results.map((r) => ({ type: 'tool_result', tool_use_id: r.id, content: r.output, is_error: r.isError || undefined })) }
  })
  // Merge consecutive user turns (tool results followed by a screenshot message).
  const msgs: { role: string; content: unknown }[] = []
  const toBlocks = (c: unknown) => (typeof c === "string" ? [{ type: "text", text: c }] : (c as unknown[]))
  for (const m of raw) {
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'user' && m.role === 'user') last.content = [...toBlocks(last.content), ...toBlocks(m.content)]
    else msgs.push({ ...m })
  }
  const data = await post(`${cfg.baseUrl || 'https://api.anthropic.com'}/v1/messages`,
    { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    { model: cfg.model, max_tokens: Number(process.env.FORGE_MAX_OUTPUT || 32000), system, messages: msgs, tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) },
    opts)
  const blocks = data.content as { type: string; text?: string; id?: string; name?: string; input?: Record<string, string> }[]
  const truncated = data.stop_reason === 'max_tokens'
  return {
    text: blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
    toolCalls: blocks.filter((b) => b.type === 'tool_use').map((b) => ({
      id: b.id!, name: b.name!, args: b.input ?? {},
      // A tool_use block cut at the limit arrives with partial/empty input.
      ...(truncated && b === blocks[blocks.length - 1] ? { argsError: 'output cut off at the token limit' } : {}),
    })),
    usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 },
    truncated,
  }
}

// ---------------------------------------------------------------- OpenAI Chat Completions (also Gemini & Ollama compat)
async function openaiCompat(cfg: Config, system: string, messages: Msg[], tools: ToolDef[], opts: CallOpts): Promise<LlmTurn> {
  const base = cfg.baseUrl || BASE_URLS[cfg.provider as keyof typeof BASE_URLS]
  const msgs: unknown[] = [{ role: 'system', content: system }]
  for (const m of messages) {
    if (m.role === 'user') {
      if (!m.images?.length) msgs.push({ role: 'user', content: m.content })
      else if (cfg.provider === 'ollama') msgs.push({ role: 'user', content: `${m.content}\n\n[${m.images.length} imagem(ns) omitida(s): o modelo local configurado não suporta imagens]` })
      else msgs.push({ role: 'user', content: [{ type: 'text', text: m.content || '(imagem)' }, ...m.images.map((i) => ({ type: 'image_url', image_url: { url: dataUrl(i) } }))] })
    }
    else if (m.role === 'assistant') msgs.push({ role: 'assistant', content: m.text || null,
      ...(m.toolCalls.length ? { tool_calls: m.toolCalls.map((t) => ({
        id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) },
        // Gemini 3 rejects the next request unless the thought signature is sent back.
        // Calls from another model (after a model switch) get Google's documented neutral signature.
        ...(t.extra && (t.model === cfg.model || (!t.model && cfg.provider !== 'gemini')) ? { extra_content: t.extra }
          : cfg.provider === 'gemini' ? { extra_content: { google: { thought_signature: 'skip_thought_signature_validator' } } } : {}),
      })) } : {}) })
    else for (const r of m.results) msgs.push({ role: 'tool', tool_call_id: r.id, content: r.output })
  }
  const data = await post(`${base}/chat/completions`, cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {},
    { model: cfg.model, messages: msgs, tools: tools.map((t) => ({ type: 'function', function: t })) }, opts)
  const choice = data.choices?.[0] ?? {}
  const msg = choice.message ?? {}
  const calls = (msg.tool_calls ?? []) as { id?: string; function: { name: string; arguments: unknown }; extra_content?: unknown }[]
  return {
    text: typeof msg.content === 'string' ? msg.content : '',
    toolCalls: calls.map((c, i) => ({
      id: c.id || `call_${Date.now()}_${i}`, name: c.function.name, ...parseArgs(c.function.arguments),
      ...(c.extra_content ? { extra: c.extra_content } : {}),
      model: cfg.model,
    })),
    usage: { input: data.usage?.prompt_tokens ?? 0, output: data.usage?.completion_tokens ?? 0 },
    truncated: choice.finish_reason === 'length' || choice.finish_reason === 'MAX_TOKENS',
  }
}
