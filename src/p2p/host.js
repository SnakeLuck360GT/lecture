// Adapter for filip's app shell (src/core/main.js): `startP2P({ bus, ai })` returns the object that the
// renderer reaches through `window.lec.p2p(method, ...args)` (IPC 'p2p:call'). Owner: aaron.
// All return values are plain data (structured-clone safe).
import { fileURLToPath } from 'node:url'
import { createRoom, joinRoom } from './room.js'
import { shareWeek, importWeek } from './share.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** opts.bootstrap: DHT bootstrap nodes (tests only; default = public DHT). */
export async function startP2P ({ bus, ai = () => null, bootstrap } = {}) {
  if (!bus) throw new Error('startP2P: bus is required')

  // Remember the session so a room opened mid-lecture still publishes what already happened.
  const history = { slides: null, slideIndex: null, notes: [] }
  const onSlides = (s) => { history.slides = s; history.slideIndex = 0; history.notes = [] }
  const onSlide = (e) => { if (Number.isInteger(e?.index)) history.slideIndex = e.index }
  const onNote = (n) => { if (n?.id && !history.notes.some((x) => x.id === n.id)) history.notes.push(n) }
  bus.on('slides:loaded', onSlides)
  bus.on('slide:changed', onSlide)
  bus.on('note:added', onNote)

  let room = null
  let peer = null
  const shares = new Map()
  const info = () => room
    ? { role: 'host', key: room.key, link: room.link, peers: room.peers }
    : peer ? { role: 'peer', key: peer.key, connected: peer.connected } : { role: null }

  return {
    /** HOST: open the room (idempotent). opts: { title, moduleId, weekId } -> { role, key, link, peers } */
    async createRoom (opts = {}) {
      if (!room) room = await createRoom({ bus, baseDir: ROOT, history, bootstrap, ...opts })
      return info()
    },
    /** PEER: join by key / z32 / lecscribe://room/ link. Stops the local AI (a peer only receives). */
    async joinRoom (key) {
      const a = typeof ai === 'function' ? ai() : ai
      if (a && typeof a.close === 'function') { try { await a.close() } catch {} }
      if (peer) await peer.close()
      peer = await joinRoom({ bus, key, bootstrap })
      return info()
    },
    /** Leave/close whatever room this device is in. */
    async leaveRoom () {
      if (room) { await room.close(); room = null }
      if (peer) { await peer.close(); peer = null }
      return info()
    },
    info,
    /** Re-announce on the current network (automatic on IP change; call after switching Wi-Fi to be sure). */
    async refreshNetwork () {
      if (room) await room.refreshNetwork()
      if (peer) await peer.refreshNetwork()
      return info()
    },

    // ---- S7 lost taps
    async lost (slideIndex, on = true) {
      if (!peer) throw new Error('lost(): this device has not joined a room')
      await peer.lost(slideIndex, on)
      return peer.lostState()
    },
    lostState: () => (peer ? peer.lostState() : {}),
    lostCounts: () => (room ? room.lostCounts() : {}),
    simulateLost (slideIndex, n = 1) {
      if (!room) throw new Error('simulateLost(): no room open on this device')
      room.simulateLost(slideIndex, n)
      return room.lostCounts()
    },

    // ---- S8 share link
    async shareWeek (bundle) {
      const s = await shareWeek(bundle, { bootstrap })
      shares.set(s.key, s)
      return { key: s.key, link: s.link }
    },
    async stopShare (key) {
      await shares.get(key)?.stop()
      shares.delete(key)
    },
    importWeek: (link, opts = {}) => importWeek(link, { bootstrap, ...opts }),

    /** QR code for a room/week link as an SVG string (generated locally; no network). */
    async qr (text) {
      const { default: QRCode } = await import('qrcode')
      return QRCode.toString(String(text || ''), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    },

    async close () {
      bus.off('slides:loaded', onSlides)
      bus.off('slide:changed', onSlide)
      bus.off('note:added', onNote)
      try { await room?.close() } catch {}
      try { await peer?.close() } catch {}
      for (const s of shares.values()) await s.stop().catch(() => {})
      room = null
      peer = null
    }
  }
}
