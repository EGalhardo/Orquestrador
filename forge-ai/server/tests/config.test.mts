// Per-user AI config: keys per provider, encrypted at rest, isolated between users.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-cfg-'))
process.env.FORGE_DATA_DIR = dir
for (const k of ['FORGE_PROVIDER', 'FORGE_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'FORGE_MODEL', 'FORGE_BASE_URL', 'FORGE_SECRET']) delete process.env[k]
const { setConfig, getConfig, publicConfig, clearKey } = await import('../config.ts')
const { register } = await import('../auth.ts')
const { db } = await import('../db.ts')
let failed = 0
const ok = (c: boolean, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) failed++ }
const a = register({ email: 'a@x.io', name: 'A', password: 'password-a' }).id
const b = register({ email: 'b@x.io', name: 'B', password: 'password-b' }, { byAdmin: true }).id
setConfig(a, { provider: 'openai', apiKey: 'sk-openai-1111' })
ok(getConfig(a).apiKey === 'sk-openai-1111', 'stores openai key')
setConfig(a, { provider: 'anthropic' })
ok(getConfig(a).apiKey === '', 'switching to anthropic does NOT reuse the openai key')
ok(getConfig(a).model === 'claude-sonnet-4-5', 'model resets to provider default')
setConfig(a, { apiKey: 'sk-ant-2222' })
setConfig(a, { provider: 'openai' })
ok(getConfig(a).apiKey === 'sk-openai-1111', 'switching back restores the openai key')
setConfig(a, { provider: 'ollama', baseUrl: 'http://x:1' })
setConfig(a, { provider: 'gemini' })
ok(getConfig(a).baseUrl === '', 'custom base URL cleared on provider switch')
ok(!JSON.stringify(publicConfig(getConfig(a))).includes('sk-'), 'public config never exposes keys')
ok(getConfig(b).apiKey === '' && getConfig(b).provider === 'anthropic', 'another user does not see these settings/keys')
const raw = JSON.stringify(db.prepare('SELECT * FROM user_settings').all())
ok(!raw.includes('sk-openai') && !raw.includes('sk-ant'), 'keys encrypted at rest in SQLite')
ok((fs.statSync(path.join(dir, 'secret.key')).mode & 0o077) === 0, 'encryption secret file is private (0600)')
setConfig(a, { provider: 'openai' }); clearKey(a, 'openai')
ok(getConfig(a).apiKey === '', 'key can be removed')
fs.rmSync(dir, { recursive: true, force: true })
console.log(failed ? `${failed} FAILED` : 'ALL PASSED'); process.exit(failed ? 1 : 0)
