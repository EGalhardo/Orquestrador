import type { Conversation, FileNode, Workspace } from '../types'

const f = (name: string, content: string, size?: number): FileNode => ({ id: name + Math.random().toString(36).slice(2, 6), name, type: 'file', content, size: size ?? content.length })
const d = (name: string, children: FileNode[]): FileNode => ({ id: name + Math.random().toString(36).slice(2, 6), name, type: 'folder', children })
const pad = (n: number, prefix: string, ext: string, size: number) =>
  Array.from({ length: n }, (_, i) => f(`${prefix}${i + 1}.${ext}`, `// ${prefix}${i + 1}\nexport {}\n`, size))

const videoSession = `import { useState } from 'react'
import { Participant } from '../../types'

export function VideoSessionPage({ sessionId }: { sessionId: string }) {
  const [participants, setParticipants] = useState<Participant[]>([])
  const [muted, setMuted] = useState(false)

  return (
    <section className="video-session">
      <header>Sessão {sessionId}</header>
      <button onClick={() => setMuted(!muted)}>{muted ? 'Unmute' : 'Mute'}</button>
      <ul>{participants.map(p => <li key={p.id}>{p.name}</li>)}</ul>
    </section>
  )
}
`
const lista = `import { Participant } from '../../types'

export function ListaParticipacaoContent({ items }: { items: Participant[] }) {
  if (!items.length) return <p className="empty">Sem participantes</p>
  return (
    <table>
      <tbody>
        {items.map(p => (
          <tr key={p.id}><td>{p.name}</td><td>{p.role}</td></tr>
        ))}
      </tbody>
    </table>
  )
}
`

export function seedWorkspaces(): Workspace[] {
  return [
    {
      id: 'ws-1', name: 'Default workspace', quotaMB: 128, fileQuota: 10000, env: 'ready',
      servers: [
        { id: 'srv-1', name: 'dev server CDA (restauro)', port: 5173, status: 'running' },
        { id: 'srv-2', name: 'dev server CDA (api)', port: 3000, status: 'starting' },
      ],
      root: [
        d('cda_test', [
          f('package.json', JSON.stringify({ name: 'cda_test', version: '0.1.0', scripts: { dev: 'vite', build: 'vite build', test: 'vitest' } }, null, 2)),
          f('README.md', '# cda_test\n\nAmbiente de testes do projecto CDA.\n'),
          d('src', [f('main.tsx', "import { createRoot } from 'react-dom/client'\nimport App from './App'\n\ncreateRoot(document.getElementById('root')!).render(<App />)\n"), f('App.tsx', 'export default function App() {\n  return <h1>CDA test</h1>\n}\n'), d('generated', pad(12, 'fixture', 'ts', 3_300_000))]),
        ]),
        d('Plataforma-Correio-Digital', [
          f('package.json', JSON.stringify({ name: 'plataforma-correio-digital', private: true, scripts: { dev: 'vite', build: 'tsc -b && vite build' } }, null, 2)),
          f('index.html', '<!doctype html>\n<html lang="pt">\n  <body><div id="root"></div></body>\n</html>\n'),
          d('src', [
            d('components', [d('features', [f('VideoSessionPage.tsx', videoSession), f('ListaParticipacaoContent.tsx', lista)]), d('ui', pad(8, 'Widget', 'tsx', 1200))]),
            f('index.css', ':root { color-scheme: dark; }\nbody { margin: 0; font-family: system-ui; }\n'),
            f('types.ts', 'export interface Participant { id: string; name: string; role: string }\n'),
          ]),
          d('assets', pad(10, 'image', 'png', 8_000_000)),
        ]),
      ],
    },
  ]
}

const H = 3600_000
export function seedConversations(): Conversation[] {
  const now = Date.now()
  return [
    {
      id: 'c-1', title: 'Criar clone da plataforma Correio Digital', createdAt: now - 2 * H, updatedAt: now - 120_000, workspaceId: 'ws-1', state: 'done',
      messages: [
        { id: 'm1', role: 'user', content: 'Corrige os componentes de sessão de vídeo e a lista de participação.', createdAt: now - 2 * H },
        {
          id: 'm2', role: 'agent', content: 'Actualizei os dois componentes e verifiquei o build.', createdAt: now - 120_000, elapsedMs: 755_000, agent: 'agent',
          activities: [
            { id: 'a1', kind: 'command', label: 'Ran commands', status: 'success', children: [
              { id: 'a1a', kind: 'bash', label: 'ls src/components/features', status: 'success', durationMs: 41, details: 'VideoSessionPage.tsx\nListaParticipacaoContent.tsx' },
              { id: 'a1b', kind: 'bash', label: 'cat package.json', status: 'success', durationMs: 22, details: '{ "name": "plataforma-correio-digital" }' },
              { id: 'a1c', kind: 'bash', label: 'npx tsc --noEmit', status: 'success', durationMs: 2140, details: 'No errors found.' },
            ] },
            { id: 'a2', kind: 'edit', label: 'Edit', target: 'Plataforma-Correio-Digital/src/components/features/VideoSessionPage.tsx', filePath: 'Plataforma-Correio-Digital/src/components/features/VideoSessionPage.tsx', status: 'success' },
            { id: 'a3', kind: 'bash', label: 'used Bash', target: 'npx tsc --noEmit', status: 'success', durationMs: 91, details: '$ npx tsc --noEmit\n✓ 0 errors' },
            { id: 'a4', kind: 'edit', label: 'Edit', target: 'Plataforma-Correio-Digital/src/components/features/ListaParticipacaoContent.tsx', filePath: 'Plataforma-Correio-Digital/src/components/features/ListaParticipacaoContent.tsx', status: 'success' },
            { id: 'a5', kind: 'bash', label: 'used Bash', target: 'npm run build', status: 'success', durationMs: 73, details: '$ npm run build\n✓ built in 4.2s' },
          ],
        },
      ],
    },
    { id: 'c-2', title: 'Corrigir autenticação', createdAt: now - 3 * H, updatedAt: now - 3 * H, workspaceId: 'ws-1', state: 'done', messages: [{ id: 'm3', role: 'user', content: 'Corrige o erro de autenticação.', createdAt: now - 3 * H }] },
    { id: 'c-3', title: 'Criar dashboard administrativo', createdAt: now - 26 * H, updatedAt: now - 26 * H, workspaceId: 'ws-1', state: 'done', messages: [{ id: 'm4', role: 'user', content: 'Cria uma nova página de dashboard.', createdAt: now - 26 * H }] },
    { id: 'c-4', title: 'Melhorar interface do login', createdAt: now - 30 * H, updatedAt: now - 30 * H, workspaceId: 'ws-1', state: 'done', messages: [{ id: 'm5', role: 'user', content: 'Cria uma página de login moderna.', createdAt: now - 30 * H }] },
    { id: 'c-5', title: 'Projecto anterior — migração de API', createdAt: now - 120 * H, updatedAt: now - 120 * H, workspaceId: 'ws-1', state: 'done', messages: [{ id: 'm6', role: 'user', content: 'Analisa o projecto e identifica problemas.', createdAt: now - 120 * H }] },
  ]
}

export const leaderboard = [
  { name: 'Ana Tavares', tasks: 412, projects: 18, activity: 96 },
  { name: 'João Manuel', tasks: 377, projects: 14, activity: 91 },
  { name: 'Edlásio G.', tasks: 341, projects: 22, activity: 88 },
  { name: 'Marta Kiala', tasks: 298, projects: 9, activity: 80 },
  { name: 'Paulo Neto', tasks: 254, projects: 12, activity: 74 },
  { name: 'Sofia Lemos', tasks: 219, projects: 7, activity: 69 },
  { name: 'Rui Domingos', tasks: 187, projects: 11, activity: 61 },
  { name: 'Carla Bento', tasks: 150, projects: 5, activity: 52 },
]
