// `npm run lint`: syntax-check every JS file we own (no extra deps). Cross-platform.
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'models'])
const files = []
;(function walk (dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.(m?js|cjs)$/.test(name)) files.push(p)
  }
})(root)

let bad = 0
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status !== 0) { bad++; console.error(`✗ ${relative(root, f)}\n${r.stderr}`) }
}
console.log(`${files.length - bad}/${files.length} files OK`)
process.exit(bad ? 1 : 0)
