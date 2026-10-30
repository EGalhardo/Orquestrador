import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const api = { '/api': { target: 'http://127.0.0.1:8787', xfwd: true } }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy: api, watch: { ignored: ['**/server/**'] } },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true, proxy: api },
})
