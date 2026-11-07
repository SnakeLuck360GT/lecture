// Cross-platform `npm run start:mock`: launches the app with the AI in mock mode (no models).
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const electron = createRequire(import.meta.url)('electron') // path to the Electron binary
const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, LECSCRIBE_AI_MOCK: '1' }
})
child.on('exit', (code) => process.exit(code ?? 0))
