// Preload (owner: filip). Exposes a tiny, safe API to the renderer as window.lec.
// CommonJS on purpose: sandboxed preloads cannot be ESM.
const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Map() // event name -> Set<fn>
ipcRenderer.on('bus:event', (_e, name, payload) => {
  for (const key of [name, '*']) {
    const set = listeners.get(key)
    if (!set) continue
    for (const fn of set) {
      try { key === '*' ? fn(name, payload) : fn(payload) } catch (err) { console.error(`[lec] listener for "${name}" threw`, err) }
    }
  }
})

contextBridge.exposeInMainWorld('lec', {
  /** Emit on the host bus (goes to main; comes back to renderer listeners via the bridge). */
  emit: (name, payload) => ipcRenderer.send('bus:emit', name, payload),
  /** Listen to a host bus event ('*' = every event, called as fn(name, payload)). Returns unsubscribe. */
  on: (name, fn) => {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name).add(fn)
    return () => listeners.get(name)?.delete(fn)
  },
  /** Call the AI facade in main, e.g. lec.ai('flushAudio'). Audio pushes are fire-and-forget. */
  ai: (method, ...args) => {
    if (method === 'pushAudio' || method === 'pushExplainAudio') { ipcRenderer.send('ai:push', method, args[0]); return Promise.resolve() }
    return ipcRenderer.invoke('ai:call', method, ...args)
  },
  /** Call the P2P facade in main (aaron's src/p2p), e.g. lec.p2p('createRoom'). */
  p2p: (method, ...args) => ipcRenderer.invoke('p2p:call', method, ...args),
  /** Discovery in main (aryan's src/discovery): advertise | stopAdvertising | listNearby | resolveCode | advertising. */
  discovery: (method, ...args) => ipcRenderer.invoke('discovery:call', method, ...args),
  /** Library data layer in main (aaron's src/library), e.g. lec.library('listModules'). */
  library: (method, ...args) => ipcRenderer.invoke('library:call', method, ...args),
  /** Send raw PDF slides to main: OCR for image-only slides, then 'slides:loaded' is emitted. */
  processSlides: (raw) => ipcRenderer.invoke('slides:process', raw),
  /** macOS mic permission (no-op elsewhere). -> { granted, status, hint? } */
  requestMic: () => ipcRenderer.invoke('mic:request'),
  info: () => ipcRenderer.invoke('app:info')
})
