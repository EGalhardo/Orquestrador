import { runTool } from '../tools.ts'
import fs from 'node:fs'
import path from 'node:path'
import { PROJECTS_DIR } from '../projectFs.ts'
const ROOT = path.join(PROJECTS_DIR, '_test')
fs.rmSync(ROOT, { recursive: true, force: true }); fs.mkdirSync(ROOT, { recursive: true })
const P = '_test', ok = (c: boolean, m: string) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) process.exitCode = 1 }
const good = "export default function A() {\n  return <b>ok</b>\n}\n"
let r = await runTool(P, 'write_file', { path: 'src/A.jsx', content: good })
ok(!r.isError && r.previous === null, 'write_file creates new file')
r = await runTool(P, 'write_file', { path: 'src/A.jsx', content: 'export default function A() {' })
ok(!!r.isError && /REJECTED/.test(r.output), 'broken overwrite of valid file is rejected')
ok(fs.readFileSync(path.join(ROOT, 'src/A.jsx'),'utf8') === good, 'original file kept intact')
r = await runTool(P, 'edit_file', { path: 'src/A.jsx', old_text: '<b>ok</b>', new_text: '<b>editado</b>' })
ok(!r.isError && r.content!.includes('editado'), 'edit_file exact match')
r = await runTool(P, 'edit_file', { path: 'src/A.jsx', old_text: 'return   <b>editado</b>', new_text: '  return <i>ws</i>' })
ok(!r.isError, 'edit_file whitespace-tolerant match')
r = await runTool(P, 'edit_file', { path: 'src/B.jsx', new_text: good })
ok(!r.isError && r.previous === null, 'edit_file on missing file creates it')
r = await runTool(P, 'edit_file', { path: 'src/A.jsx', old_text: 'nao existe', new_text: 'x' })
ok(!!r.isError && /Current content/.test(r.output), 'edit_file not found returns content')
r = await runTool(P, 'write_file', { path: 'src/New.jsx', content: 'const x = (' })
ok(!r.isError && !!r.warning, 'broken NEW file saved with warning (nothing to protect)')
r = await runTool(P, 'read_file', { path: '../../../etc/passwd' })
ok(!!r.isError && /escapes/.test(r.output), 'path traversal blocked')
r = await runTool(P, 'search_files', { query: 'function A' })
ok(/src\/A.jsx:1/.test(r.output), 'search_files finds match')
r = await runTool(P, 'list_files', {})
ok(r.output.split('\n').length === 3, 'list_files lists 3 files')
r = await runTool(P, 'delete_file', { path: 'src/New.jsx' })
ok(!r.isError && !fs.existsSync(path.join(ROOT, 'src/New.jsx')), 'delete_file removes file')
r = await runTool(P, 'delete_file', { path: '.' })
ok(!!r.isError, 'deleting project root refused')

fs.rmSync(ROOT, { recursive: true, force: true })
