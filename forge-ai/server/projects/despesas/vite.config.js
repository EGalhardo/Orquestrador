import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Runs the Express API (server/app.js) inside the Vite dev server under /api,
 * so development uses ONE port and the API reloads on every request after edits.
 */
function api() {
  return {
    name: 'api',
    configureServer(server) {
      server.middlewares.use('/api', async (req, res, next) => {
        try {
          const { createApp } = await server.ssrLoadModule('/server/app.js')
          const app = (globalThis.__app ??= { mod: null, instance: null })
          if (app.mod !== createApp) { app.mod = createApp; app.instance = createApp() }
          req.url = '/api' + req.url
          app.instance(req, res, next)
        } catch (e) {
          server.ssrFixStacktrace(e)
          console.error('[api]', e)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: String(e.message ?? e) }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), api()],
  ssr: { external: ['better-sqlite3', 'express'] },
})
