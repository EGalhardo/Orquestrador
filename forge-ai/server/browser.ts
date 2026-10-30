/**
 * Interactive browser for the agent (Playwright + headless Chromium).
 * One persistent page per agent run, so the agent can navigate, click, fill forms and check results
 * across several tool calls — like a QA tester. Closed at the end of the run or after 10 idle minutes.
 *
 * Network policy (every request, including redirects and sub-resources, goes through page.route):
 * - loopback (localhost/127.x/::1/0.0.0.0) → only the ports of THIS project's running servers
 * - private / link-local IP literals → blocked (protects the EGalhardo IA API and other users' apps)
 * - public http(s) → allowed
 */
import { findChromium } from './inspector.ts'
import type { Browser, Page } from 'playwright-core'

export interface BrowserState {
  url: string
  title: string
  text: string
  controls: string[]
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
  blocked: string[]
  screenshot?: string
}

interface Session { browser: Browser; page: Page; ports: () => number[]; errs: { console: string[]; page: string[]; failed: string[]; blocked: string[] }; timer?: NodeJS.Timeout }
const sessions = new Map<string, Session>()
const MAX_SESSIONS = Number(process.env.FORGE_MAX_BROWSERS || 2)
const IDLE_MS = 10 * 60_000

const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|0\.0\.0\.0)$/i
const PRIVATE = /^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?f[cd][0-9a-f]{2}:.*|\[?fe80:.*|metadata\.google\.internal)$/i

/** Is this URL allowed for a project whose servers listen on `ports`? */
export function urlAllowed(raw: string, ports: number[]): { ok: boolean; reason?: string } {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, reason: 'URL inválido' } }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return { ok: true }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: `protocolo ${u.protocol} não permitido` }
  const host = u.hostname
  if (LOOPBACK.test(host)) {
    const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80))
    return ports.includes(port) ? { ok: true } : { ok: false, reason: `porta local ${port} não pertence a um servidor deste projeto (portas: ${ports.join(', ') || 'nenhuma'})` }
  }
  if (PRIVATE.test(host)) return { ok: false, reason: `endereço privado ${host} bloqueado` }
  return { ok: true }
}

async function getSession(key: string, ports: () => number[]): Promise<Session> {
  const existing = sessions.get(key)
  if (existing && existing.browser.isConnected()) { touch(key, existing); return existing }
  if (sessions.size >= MAX_SESSIONS) {
    // Evict the oldest session to bound memory.
    const [oldKey] = sessions.keys(); await closeSession(oldKey)
  }
  const exe = findChromium()
  if (!exe) throw new Error('Chromium não encontrado. Instala com "npx playwright install chromium" ou define FORGE_CHROMIUM.')
  const { chromium } = await import('playwright-core')
  const browser = await chromium.launch({ executablePath: exe, args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'pt-PT', serviceWorkers: 'block' })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  const errs = { console: [] as string[], page: [] as string[], failed: [] as string[], blocked: [] as string[] }
  const push = (a: string[], s: string) => { if (a.length < 30 && !a.includes(s)) a.push(s.slice(0, 400)) }
  const strip = (u: string) => u.replace(/^https?:\/\/(localhost|127\.0\.0\.1):\d+/, '')
  await context.route('**/*', (route) => {
    const url = route.request().url()
    const v = urlAllowed(url, ports())
    if (v.ok) return route.continue()
    push(errs.blocked, `${url} — ${v.reason}`)
    return route.abort('blockedbyclient')
  })
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_BLOCKED_BY_CLIENT')) push(errs.console, m.text()) })
  page.on('pageerror', (e) => push(errs.page, `${e.name}: ${e.message}`))
  page.on('requestfailed', (r) => { if (!String(r.failure()?.errorText).includes('BLOCKED_BY_CLIENT')) push(errs.failed, `${r.method()} ${strip(r.url())} — ${r.failure()?.errorText ?? 'failed'}`) })
  page.on('response', (r) => { if (r.status() >= 400) push(errs.failed, `${r.request().method()} ${strip(r.url())} — HTTP ${r.status()}`) })
  const s: Session = { browser, page, ports, errs }
  sessions.set(key, s)
  touch(key, s)
  return s
}

function touch(key: string, s: Session) {
  if (s.timer) clearTimeout(s.timer)
  s.timer = setTimeout(() => { closeSession(key).catch(() => undefined) }, IDLE_MS)
  s.timer.unref?.()
}

export async function closeSession(key: string) {
  const s = sessions.get(key)
  if (!s) return
  sessions.delete(key)
  if (s.timer) clearTimeout(s.timer)
  await s.browser.close().catch(() => undefined)
}
export const hasSession = (key: string) => sessions.has(key)

/** Resolve the element the model means: CSS/Playwright selector, visible text, label or placeholder. */
function locate(page: Page, a: Record<string, string | undefined>) {
  if (a.selector) return page.locator(a.selector).first()
  if (a.label) return page.getByLabel(a.label, { exact: false }).first()
  if (a.placeholder) return page.getByPlaceholder(a.placeholder, { exact: false }).first()
  if (a.text) {
    // Prefer clickable elements with that text, then any element.
    return page.getByRole('button', { name: a.text, exact: false }).or(page.getByRole('link', { name: a.text, exact: false })).or(page.getByText(a.text, { exact: false })).first()
  }
  throw new Error('Indica o elemento com "selector", "text", "label" ou "placeholder".')
}

export const BROWSER_ACTIONS = ['open', 'click', 'fill', 'select', 'press', 'hover', 'check', 'wait', 'scroll', 'back', 'reload', 'read', 'screenshot', 'close'] as const

export async function browserAction(key: string, action: string, a: Record<string, string | undefined>, opts: { ports: () => number[]; defaultPort?: number; signal?: AbortSignal }): Promise<{ output: string; isError?: boolean; screenshot?: string }> {
  if (action === 'close') { await closeSession(key); return { output: 'Navegador fechado.' } }
  if (!(BROWSER_ACTIONS as readonly string[]).includes(action)) return { output: `Ação desconhecida "${action}". Disponíveis: ${BROWSER_ACTIONS.join(', ')}`, isError: true }
  const s = await getSession(key, opts.ports)
  const { page } = s
  // Reset per-action diagnostics so the model sees what THIS action caused.
  s.errs.console.length = 0; s.errs.page.length = 0; s.errs.failed.length = 0; s.errs.blocked.length = 0
  const onAbort = () => { closeSession(key).catch(() => undefined) }
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  let note = ''
  try {
    switch (action) {
      case 'open': {
        let url = String(a.url ?? a.path ?? '/')
        if (!/^https?:\/\//i.test(url)) {
          const port = a.port ? Number(a.port) : opts.defaultPort
          if (!port) return { output: 'Nenhum servidor do projeto a correr. Arranca-o com start_process ou indica um URL completo.', isError: true }
          url = `http://127.0.0.1:${port}/${url.replace(/^\/+/, '')}`
        }
        const v = urlAllowed(url, opts.ports())
        if (!v.ok) return { output: `URL bloqueado: ${v.reason}`, isError: true }
        const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
        note = `Aberto ${url} → HTTP ${res?.status() ?? 'n/a'}`
        break
      }
      case 'click': await locate(page, a).click(); note = 'Clicado.'; break
      case 'hover': await locate(page, a).hover(); note = 'Rato sobre o elemento.'; break
      case 'check': { const l = locate(page, a); if (a.value === 'false') await l.uncheck(); else await l.check(); note = 'Checkbox atualizada.'; break }
      case 'fill': await locate(page, a).fill(String(a.value ?? '')); note = `Preenchido com "${String(a.value ?? '').slice(0, 80)}".`; break
      case 'select': await locate(page, a).selectOption({ label: String(a.value ?? '') }).catch(() => locate(page, a).selectOption(String(a.value ?? ''))); note = `Selecionado "${a.value}".`; break
      case 'press': { const key2 = String(a.key ?? 'Enter'); if (a.selector || a.text || a.label || a.placeholder) await locate(page, a).press(key2); else await page.keyboard.press(key2); note = `Tecla ${key2}.`; break }
      case 'wait': {
        if (a.text) { await page.getByText(a.text, { exact: false }).first().waitFor({ timeout: Math.min(Number(a.ms) || 10_000, 30_000) }); note = `Texto "${a.text}" apareceu.` }
        else { await page.waitForTimeout(Math.min(Number(a.ms) || 1000, 15_000)); note = 'Esperou.' }
        break
      }
      case 'scroll': await page.mouse.wheel(0, a.direction === 'up' ? -700 : 700); note = 'Deslizou.'; break
      case 'back': await page.goBack(); note = 'Voltou atrás.'; break
      case 'reload': await page.reload(); note = 'Recarregado.'; break
      case 'read': case 'screenshot': break
    }
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const msg = (e as Error).message.split('\n')[0]
    const state = await snapshot(s).catch(() => null)
    return { output: `Falhou "${action}": ${msg}\nDICA: usa read para ver os controlos disponíveis e escolhe outro selector/texto.${state ? `\n\n${formatState(state)}` : ''}`, isError: true, screenshot: state?.screenshot }
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
  }
  await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => undefined)
  await page.waitForTimeout(300)
  const state = await snapshot(s)
  return { output: `${note ? note + '\n' : ''}${formatState(state)}`, screenshot: state.screenshot }
}

const PAGE_SNAPSHOT_JS = `(() => {
  var vis = function (el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 };
  var label = function (el) {
    var byFor = el.id ? (document.querySelector('label[for="' + CSS.escape(el.id) + '"]') || {}).textContent : '';
    var wrap = el.closest('label');
    return String(el.getAttribute('aria-label') || byFor || (wrap && wrap.textContent) || el.placeholder || el.name || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
  };
  var controls = [];
  document.querySelectorAll('button,[role=button],a[href],input,textarea,select').forEach(function (el) {
    if (!vis(el) || controls.length >= 50) return;
    var tag = el.tagName.toLowerCase();
    var type = tag === 'input' ? '[' + el.type + ']' : '';
    var val = (tag === 'input' || tag === 'textarea') ? ' = "' + String(el.value).slice(0, 40) + '"' : tag === 'select' ? ' = "' + ((el.selectedOptions[0] || {}).text || '') + '"' : '';
    controls.push(tag + type + ' "' + label(el) + '"' + val + (el.disabled ? ' (disabled)' : ''));
  });
  return { title: document.title, text: String((document.body && document.body.innerText) || '').replace(/\\n{3,}/g, '\\n\\n').trim().slice(0, 3000), controls: controls };
})()`

async function snapshot(s: Session): Promise<BrowserState> {
  // Passed as a string: bundlers/tsx may inject helpers (e.g. __name) that don't exist in the page.
  const info = await s.page.evaluate(PAGE_SNAPSHOT_JS).then((v) => v as { title: string; text: string; controls: string[] }).catch(() => ({ title: '', text: '', controls: [] as string[] }))
  const buf = await s.page.screenshot({ type: 'jpeg', quality: 55 }).catch(() => null)
  return {
    url: s.page.url(), ...info,
    consoleErrors: [...s.errs.console], pageErrors: [...s.errs.page], failedRequests: [...s.errs.failed], blocked: [...s.errs.blocked],
    screenshot: buf ? `data:image/jpeg;base64,${buf.toString('base64')}` : undefined,
  }
}

export function formatState(st: BrowserState) {
  const sect = (n: string, a: string[]) => (a.length ? `\n${n} (${a.length}):\n- ${a.join('\n- ')}` : '')
  const problems = st.consoleErrors.length + st.pageErrors.length + st.failedRequests.length
  return [
    `Página: ${st.url} · "${st.title}"`,
    problems ? `⚠ ${problems} problema(s) causados por esta ação — corrige-os.` : '✓ Sem erros na consola nem pedidos falhados.',
    sect('Exceções', st.pageErrors), sect('Erros da consola', st.consoleErrors), sect('Pedidos falhados', st.failedRequests), sect('Pedidos bloqueados pela política de rede', st.blocked),
    `\nControlos visíveis:\n${st.controls.map((c) => `- ${c}`).join('\n') || '(nenhum)'}`,
    `\nTexto visível:\n${st.text || '(vazio)'}`,
  ].join('')
}
