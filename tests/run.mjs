#!/usr/bin/env node
// LecScribe one-command test runner (owner: david). Cross-platform (macOS + Windows).
//   node tests/run.mjs            -> fast suite: fixtures + contract tests (AI in mock mode)
//   LECSCRIBE_REAL=1 node tests/run.mjs  -> also real-model / real-P2P tests (macOS demo host)
// Collects tests/**/*.test.{js,mjs,cjs} and src/**/*.test.{js,mjs,cjs} (coders' unit tests).
import { readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.cache', 'models'])
const isTest = (f) => /\.test\.(m?js|cjs)$/.test(f)

function walk (dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (isTest(name)) out.push(p)
  }
  return out
}

const files = [...walk(join(root, 'tests')), ...walk(join(root, 'src'))].sort()
if (files.length === 0) { console.log('no test files found'); process.exit(0) }
console.log(`running ${files.length} test file(s):\n  ` + files.map((f) => relative(root, f)).join('\n  '))

const args = ['--test', '--test-reporter=spec', '--test-concurrency=1', ...process.argv.slice(2), ...files]
const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...process.env, LECSCRIBE_TEST: '1' } })
process.exit(r.status ?? 1)
