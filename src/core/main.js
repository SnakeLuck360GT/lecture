// LecScribe Electron MAIN process (owner: filip).
// - Serves the repo over a private app:// scheme (ESM modules + pdf.js worker work on macOS and Windows).
// - Owns the host event bus and bridges it to the renderer (see bus.js).
// - Starts the on-device AI (src/ai, aryan) and P2P (src/p2p, aaron) if they are present.
// - Handles the macOS microphone permission.
import { app, BrowserWindow, ipcMain, protocol, session, systemPreferences, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, normalize, extname, sep, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createBus, attachRenderer } from './bus.js'
import { processSlides } from './slides.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SCHEME = 'app'
const HOST = 'lecscribe'
const MOCK = process.env.LECSCRIBE_AI_MOCK === '1'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.pdf': 'application/pdf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf'
}

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])

export const bus = createBus()
let ai = null // AI facade from src/ai (null until loaded / if not present)
let p2p = null // P2P facade from src/p2p (null until loaded / if not present)
let win = null

const log = (...a) => console.log('[main]', ...a)

/** Resolve a repo-relative or absolute path for AI/P2P calls (e.g. 'fixtures/lecture.wav'). */
function resolvePath (p) {
  if (typeof p !== 'string') return p
  return isAbsolute(p) ? p : join(ROOT, p)
}

function serveRepoFiles () {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url)
    if (url.host !== HOST) return new Response('not found', { status: 404 })
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const file = normalize(join(ROOT, rel || 'ui/index.html'))
    if (!file.startsWith(normalize(ROOT)) || file.split(sep).includes('.git')) return new Response('forbidden', { status: 403 })
    try {
      const body = await readFile(file)
      return new Response(body, { headers: { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' } })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

function allowMicrophone () {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, cb, details) => {
    if (permission === 'media') return cb(!details.mediaTypes || details.mediaTypes.every((t) => t === 'audio'))
    cb(permission === 'clipboard-sanitized-write')
  })
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media' || permission === 'clipboard-sanitized-write')
}

/** macOS: ask the OS for mic access (NSMicrophoneUsageDescription is in package.json build.mac.extendInfo). */
async function requestMic () {
  if (process.platform !== 'darwin') return { granted: true, status: 'granted' }
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return { granted: true, status }
  if (status === 'denied' || status === 'restricted') {
    return { granted: false, status, hint: 'Enable LecScribe/Electron in System Settings > Privacy & Security > Microphone, then restart the app.' }
  }
  const granted = await systemPreferences.askForMediaAccess('microphone')
  return { granted, status: granted ? 'granted' : 'denied' }
}

async function startAI () {
  const entry = join(ROOT, 'src', 'ai', 'index.js')
  if (!existsSync(entry)) { log('src/ai not present, AI disabled'); return }
  try {
    const mod = await import(pathToFileURL(entry).href)
    ai = await mod.startAI({ bus, mock: MOCK })
    log(`AI started${MOCK ? ' (mock mode)' : ''}`)
  } catch (e) {
    console.error('[main] AI failed to start:', e)
    bus.emit('ai:status', { model: 'stt', state: 'error', error: `AI failed to start: ${e?.message || e}` })
  }
}

async function startP2P () {
  const entry = join(ROOT, 'src', 'p2p', 'index.js')
  if (!existsSync(entry)) return
  try {
    const mod = await import(pathToFileURL(entry).href)
    const start = mod.startP2P || mod.default
    if (typeof start === 'function') { p2p = await start({ bus, ai: () => ai }); log('P2P started') }
  } catch (e) {
    console.error('[main] P2P failed to start:', e)
    bus.emit('p2p:status', { state: 'error', error: String(e?.message || e) })
  }
}

// Renderer -> AI. pushAudio/pushExplainAudio come in fire-and-forget ('ai:push'), the rest via invoke.
const AI_METHODS = new Set(['playClip', 'stopClip', 'pushAudio', 'flushAudio', 'pushExplainAudio', 'embed', 'ocr', 'summariseLecture'])
const PATH_ARG_METHODS = new Set(['playClip'])

function wireIpc () {
  ipcMain.on('bus:emit', (_e, name, payload) => {
    if (typeof name === 'string') bus.emit(name, payload)
  })

  ipcMain.on('ai:push', (_e, method, f32) => {
    if (!ai || (method !== 'pushAudio' && method !== 'pushExplainAudio')) return
    try { ai[method](f32) } catch (e) { console.error(`[main] ai.${method} failed:`, e.message) }
  })

  ipcMain.handle('ai:call', async (_e, method, ...args) => {
    if (!AI_METHODS.has(method)) throw new Error(`ai.${method} is not allowed from the renderer`)
    if (!ai) throw new Error('AI is not loaded (src/ai missing or failed to start)')
    if (typeof ai[method] !== 'function') throw new Error(`ai.${method} is not implemented`)
    if (PATH_ARG_METHODS.has(method)) args[0] = resolvePath(args[0])
    return ai[method](...args)
  })

  ipcMain.handle('p2p:call', async (_e, method, ...args) => {
    if (!p2p) throw new Error('P2P is not loaded (src/p2p missing or failed to start)')
    if (typeof p2p[method] !== 'function') throw new Error(`p2p.${method} is not implemented`)
    return p2p[method](...args)
  })

  ipcMain.handle('slides:process', async (_e, raw) => {
    const slides = await processSlides(raw, {
      ocr: ai && typeof ai.ocr === 'function' ? (img) => ai.ocr(img) : undefined,
      log
    })
    bus.emit('slides:loaded', slides)
    return slides.map((s) => ({ index: s.index, textLength: s.text.length }))
  })

  ipcMain.handle('mic:request', () => requestMic())

  ipcMain.handle('app:info', () => ({
    platform: process.platform,
    mock: MOCK,
    aiLoaded: !!ai,
    p2pLoaded: !!p2p,
    versions: { electron: process.versions.electron, node: process.versions.node }
  }))
}

function createWindow () {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'LecScribe',
    backgroundColor: '#f6f4ef',
    webPreferences: {
      preload: join(ROOT, 'src', 'core', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  attachRenderer(bus, win.webContents)
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  win.loadURL(`${SCHEME}://${HOST}/ui/index.html`)
  if (process.env.LECSCRIBE_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' })
  win.on('closed', () => { win = null })
}

app.whenReady().then(async () => {
  serveRepoFiles()
  allowMicrophone()
  wireIpc()
  createWindow()
  // Load models after the window is up, so the UI shows progress instead of a blank screen.
  await startAI()
  await startP2P()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
app.on('before-quit', async () => {
  try { await p2p?.close?.() } catch {}
  try { await ai?.close?.() } catch {}
})
