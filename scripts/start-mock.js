// Cross-platform `npm run start:mock`: launches the app with the AI in mock mode (no models).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const electron = createRequire(import.meta.url)('electron') // path to the Electron binary
const env = { ...process.env, LECSCRIBE_AI_MOCK: '1' }
delete env.ELECTRON_RUN_AS_NODE // set inside VS Code's extension host; it would start Electron as plain Node
const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env })
child.on('exit', (code) => process.exit(code ?? 0))
