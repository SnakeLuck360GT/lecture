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
  const offlineLost = {} // simulateLost() counts while no room is open (stage fallback)
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
      // A peer never needs models. Stop the local AI but DON'T wait for it (B-014): ai.close() detaches
      // its bus listeners synchronously, then awaits every model still loading, which can take
      // minutes while a 1.6 GB model downloads. Joining must not block on that.
      const a = typeof ai === 'function' ? ai() : ai
      if (a && typeof a.close === 'function') {
        try { Promise.resolve(a.close()).catch(() => {}) } catch {}
      }
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
    lostCounts: () => (room ? room.lostCounts() : { ...offlineLost }),
    /**
     * Stage fallback (filip's hidden Shift+L): add n fake "lost" devices on a slide. Works with a live
     * room (counts merge with real taps) AND with no room at all (Wi-Fi off), emitting lost:counts locally.
     */
    simulateLost (slideIndex, n = 1) {
      const i = Number(slideIndex)
      const k = Math.max(1, Number(n) || 1)
      if (!Number.isInteger(i) || i < 0) throw new Error('simulateLost(slideIndex, n): bad slide index')
      if (room) {
        room.simulateLost(i, k)
        return room.lostCounts()
      }
      offlineLost[i] = (offlineLost[i] || 0) + k
      const counts = { ...offlineLost }
      bus.emit('lost:counts', counts)
      return counts
    },
    /** Clear the offline fake taps (e.g. between rehearsals). */
    resetSimulatedLost () {
      for (const key of Object.keys(offlineLost)) delete offlineLost[key]
      if (!room) bus.emit('lost:counts', {})
      return room ? room.lostCounts() : {}
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
