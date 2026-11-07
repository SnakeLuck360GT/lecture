// Cross-platform launcher for `npm start` / `npm run start:mock` (B-003).
// Strips ELECTRON_RUN_AS_NODE (VS Code terminals and extensions export it, which would start
// Electron as plain Node), then spawns Electron on this repo. `--mock` turns on the AI mock mode.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const electron = createRequire(import.meta.url)('electron') // path to the Electron binary
const args = process.argv.slice(2)
const mock = args.includes('--mock')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
if (mock) env.LECSCRIBE_AI_MOCK = '1'
const child = spawn(electron, ['.', ...args.filter((a) => a !== '--mock')], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig))
