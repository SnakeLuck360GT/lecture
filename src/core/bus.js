// Host event bus (owner: filip). Node EventEmitter that lives in the Electron MAIN process.
// AI (src/ai) and P2P (src/p2p) attach to it directly. The renderer is bridged over IPC by
// attachRenderer(): every bus event is forwarded to the window, and renderer emits arrive
// through main.js -> bus.emit(). Payloads must be structured-clone safe (plain data).
import { EventEmitter } from 'node:events'

/** Create a bus. `onEmit(name, payload)` is called after every emit (used for the IPC bridge). */
export function createBus () {
  const bus = new EventEmitter()
  bus.setMaxListeners(100)
  const sinks = new Set()
  bus.emit = (name, payload) => {
    // Call listeners one by one so a throwing listener (e.g. a UI bridge) never starves the others.
    const fns = bus.rawListeners(name)
    for (const fn of fns) {
      try { fn.call(bus, payload) } catch (e) { console.error(`[bus] listener for "${name}" threw:`, e) }
    }
    const r = fns.length > 0
    for (const sink of sinks) {
      try { sink(name, payload) } catch (e) { console.error('[bus] sink failed:', e) }
    }
    return r
  }
  /** Subscribe to every event; returns an unsubscribe function. */
  bus.tap = (fn) => { sinks.add(fn); return () => sinks.delete(fn) }
  return bus
}

/** Forward every bus event to a BrowserWindow's webContents on channel 'bus:event'. */
export function attachRenderer (bus, webContents) {
  const off = bus.tap((name, payload) => {
    if (webContents.isDestroyed()) return off()
    try { webContents.send('bus:event', name, payload) } catch (e) { console.error(`[bus] could not forward "${name}":`, e.message) }
  })
  return off
}
