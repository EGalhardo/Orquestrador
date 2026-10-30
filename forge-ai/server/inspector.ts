/**
 * Visual verification of a running app: loads a page in headless Chromium and reports what a
 * user would hit — console errors, uncaught exceptions, failed requests, visible text — plus a
 * screenshot for the UI. Chromium is found via FORGE_CHROMIUM, the Playwright cache or the system.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Inspection {
  url: string
  status: number | null
  title: string
  consoleErrors: string[]
  consoleWarnings: string[]
  pageErrors: string[]
  failedRequests: string[]
  text: string
  elements: { buttons: number; links: number; inputs: number; images: number; brokenImages: number }
  screenshot?: string // data URL (JPEG)
  loadMs: number
}

export function findChromium(): string | null {
  const env = process.env.FORGE_CHROMIUM
  if (env && fs.existsSync(env)) return env
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright')
  const candidates: string[] = []
  try {
    for (const d of fs.readdirSync(cache).sort().reverse()) {
      if (d.startsWith('chromium_headless_shell-')) candidates.push(path.join(cache, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell'), path.join(cache, d, 'chrome-linux', 'headless_shell'))
      if (d.startsWith('chromium-')) candidates.push(path.join(cache, d, 'chrome-linux64', 'chrome'), path.join(cache, d, 'chrome-linux', 'chrome'))
    }
  } catch { /* no cache */ }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable')
  return candidates.find((c) => fs.existsSync(c)) ?? null
}

// One inspection at a time (memory), browser closed after each run.
let busy: Promise<unknown> = Promise.resolve()

export function inspect(url: string, opts: { waitMs?: number; width?: number; height?: number; screenshot?: boolean; signal?: AbortSignal } = {}): Promise<Inspection> {
  const run = async (): Promise<Inspection> => {
    const exe = findChromium()
    if (!exe) throw new Error('Chromium não encontrado. Instala com "npx playwright install chromium" ou define FORGE_CHROMIUM.')
    const { chromium } = await import('playwright-core')
    const browser = await chromium.launch({ executablePath: exe, args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'] })
    const onAbort = () => { browser.close().catch(() => undefined) }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const t0 = Date.now()
    try {
      const page = await browser.newPage({ viewport: { width: opts.width ?? 1280, height: opts.height ?? 800 } })
      const consoleErrors: string[] = [], consoleWarnings: string[] = [], pageErrors: string[] = [], failedRequests: string[] = []
      const push = (arr: string[], s: string) => { if (arr.length < 30 && !arr.includes(s)) arr.push(s.slice(0, 500)) }
      page.on('console', (m) => {
        const loc = m.location(); const where = loc?.url ? ` (${loc.url.replace(/^https?:\/\/[^/]+/, '')}:${loc.lineNumber})` : ''
        if (m.type() === 'error') push(consoleErrors, m.text() + where)
        else if (m.type() === 'warning') push(consoleWarnings, m.text())
      })
      page.on('pageerror', (e) => push(pageErrors, `${e.name}: ${e.message}${e.stack ? `\n${e.stack.split('\n').slice(1, 4).join('\n')}` : ''}`))
      page.on('requestfailed', (r) => push(failedRequests, `${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} — ${r.failure()?.errorText ?? 'failed'}`))
      page.on('response', (r) => { if (r.status() >= 400) push(failedRequests, `${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')} — HTTP ${r.status()}`) })
      let status: number | null = null
      try {
        const res = await page.goto(url, { waitUntil: 'load', timeout: 30_000 })
        status = res?.status() ?? null
      } catch (e) { push(pageErrors, `Navigation failed: ${(e as Error).message.split('\n')[0]}`) }
      await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
      await page.waitForTimeout(opts.waitMs ?? 800)
      const info = await page.evaluate(() => {
        const vis = (document.body?.innerText ?? '').replace(/\n{3,}/g, '\n\n').trim()
        const imgs = [...document.images]
        return {
          title: document.title, text: vis,
          elements: { buttons: document.querySelectorAll('button,[role=button]').length, links: document.links.length, inputs: document.querySelectorAll('input,textarea,select').length, images: imgs.length, brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0).length },
        }
      }).catch(() => ({ title: '', text: '', elements: { buttons: 0, links: 0, inputs: 0, images: 0, brokenImages: 0 } }))
      let screenshot: string | undefined
      if (opts.screenshot !== false) {
        const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false }).catch(() => null)
        if (buf) screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`
      }
      return { url, status, title: info.title, text: info.text.slice(0, 4000), elements: info.elements, consoleErrors, consoleWarnings, pageErrors, failedRequests, screenshot, loadMs: Date.now() - t0 }
    } finally {
      opts.signal?.removeEventListener('abort', onAbort)
      await browser.close().catch(() => undefined)
    }
  }
  const p = busy.catch(() => undefined).then(run)
  busy = p.catch(() => undefined)
  return p
}

/** Compact report for the model. */
export function formatInspection(r: Inspection) {
  const sect = (name: string, a: string[]) => (a.length ? `\n${name} (${a.length}):\n- ${a.join('\n- ')}` : '')
  const problems = r.consoleErrors.length + r.pageErrors.length + r.failedRequests.length + r.elements.brokenImages
  return [
    `URL: ${r.url} → HTTP ${r.status ?? 'n/a'} in ${r.loadMs}ms · title: "${r.title}"`,
    problems ? `⚠ ${problems} problem(s) found — fix them.` : '✓ No console errors, exceptions or failed requests.',
    sect('Uncaught exceptions', r.pageErrors), sect('Console errors', r.consoleErrors), sect('Failed requests', r.failedRequests),
    r.elements.brokenImages ? `\nBroken images: ${r.elements.brokenImages}` : '',
    `\nElements: ${r.elements.buttons} buttons, ${r.elements.links} links, ${r.elements.inputs} inputs, ${r.elements.images} images`,
    `\nVisible text:\n${r.text ? r.text.slice(0, 2500) : '(page is empty — likely a render error)'}`,
    r.consoleWarnings.length ? `\nConsole warnings (${r.consoleWarnings.length}): ${r.consoleWarnings.slice(0, 5).join(' | ').slice(0, 800)}` : '',
  ].join('')
}
