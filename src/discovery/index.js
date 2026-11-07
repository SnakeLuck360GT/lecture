// Discovery: 6-digit join codes + "Nearby sessions" (owner: aryan). See coord/contracts/discovery.md.
// Runs in Node / the Electron MAIN process.
//  1. LAN beacon: UDP multicast 239.255.42.99:47474 + subnet broadcast, every 1 s (works on a phone
//     hotspot with no internet). Entries expire 5 s after they were last seen.
//  2. DHT fallback for resolveCode across networks: Hyperswarm topic sha256('lecscribe-code-v1:' + code).
import dgram from 'node:dgram'
import os from 'node:os'
import { createHash, randomInt } from 'node:crypto'
import Hyperswarm from 'hyperswarm'

export const MCAST = '239.255.42.99'
export const PORT = 47474
const BEACON_MS = 1000
const EXPIRE_MS = 5000
const MAX_BYTES = 1024

const err = (code, msg) => Object.assign(new Error(msg || code), { code })

/** '482 913' / '482-913' / 482913 -> '482913'; throws BAD_CODE otherwise. */
export function normaliseCode (code) {
  const c = String(code ?? '').replace(/[\s-]/g, '')
  if (!/^\d{6}$/.test(c)) throw err('BAD_CODE', `not a 6-digit code: ${code}`)
  return c
}
export const formatCode = (c) => `${c.slice(0, 3)} ${c.slice(3)}`
export const newCode = () => String(randomInt(0, 1000000)).padStart(6, '0')
export const codeTopic = (code) => createHash('sha256').update('lecscribe-code-v1:' + normaliseCode(code)).digest()

export function encodeBeacon ({ code, title, link, hostName, id }) {
  const buf = Buffer.from(JSON.stringify({ v: 1, app: 'lecscribe', code, title: String(title || '').slice(0, 120), link, hostName: String(hostName || '').slice(0, 60), id }))
  if (buf.length > MAX_BYTES) throw err('BEACON_TOO_BIG')
  return buf
}

/** Parse + validate a beacon; returns null for anything that is not a well-formed LecScribe beacon. */
export function decodeBeacon (buf) {
  try {
    if (!buf || buf.length > MAX_BYTES) return null
    const m = JSON.parse(buf.toString('utf8'))
    if (m?.v !== 1 || m.app !== 'lecscribe') return null
    if (!/^\d{6}$/.test(m.code) || typeof m.link !== 'string' || !m.link.startsWith('lecscribe://')) return null
    return { code: m.code, title: String(m.title || ''), link: m.link, hostName: String(m.hostName || ''), id: String(m.id || '') }
  } catch { return null }
}

/** Subnet broadcast addresses of the non-internal IPv4 interfaces. */
export function broadcastAddresses () {
  const out = new Set()
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' && ni.family !== 4) continue
      if (ni.internal) continue
      const ip = ni.address.split('.').map(Number)
      const mask = (ni.netmask || '255.255.255.0').split('.').map(Number)
      out.add(ip.map((b, i) => (b & mask[i]) | (~mask[i] & 255)).join('.'))
    }
  }
  return [...out]
}

/** Nearby list with expiry (pure, unit-tested). */
export function createNearbyList ({ expireMs = EXPIRE_MS, now = () => Date.now() } = {}) {
  const map = new Map() // code -> entry
  return {
    /** -> true if the visible list changed */
    see (b) {
      const prev = map.get(b.code)
      map.set(b.code, { code: b.code, title: b.title, link: b.link, hostName: b.hostName, lastSeen: now() })
      return !prev || prev.title !== b.title || prev.link !== b.link || prev.hostName !== b.hostName
    },
    /** drop expired; -> true if something was removed */
    prune () {
      let changed = false
      for (const [k, e] of map) if (now() - e.lastSeen > expireMs) { map.delete(k); changed = true }
      return changed
    },
    get: (code) => map.get(code),
    list: () => [...map.values()].sort((a, b) => b.lastSeen - a.lastSeen)
  }
}

/**
 * @param {object} o
 * @param {{emit:Function}} [o.bus]
 * @param {string} [o.hostName]
 * @param {number} [o.port]
 * @param {Array} [o.bootstrap]  DHT bootstrap (tests)
 */
export async function startDiscovery ({ bus, hostName = os.hostname(), port = PORT, bootstrap } = {}) {
  const selfId = newCode() + newCode() // to ignore our own beacons
  const nearby = createNearbyList()
  const emitNearby = () => bus?.emit('discovery:nearby', nearby.list())
  let advert = null // { code, title, link, timer, swarm, topic }
  let closed = false

  // ---- LAN socket ----
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  sock.on('error', (e) => console.error('[discovery] udp error', e?.message || e))
  sock.on('message', (buf) => {
    const b = decodeBeacon(buf)
    if (!b || b.id === selfId) return
    if (nearby.see(b)) emitNearby()
  })
  let lanOk = true
  try {
    await new Promise((resolve, reject) => {
      sock.once('error', reject)
      sock.bind(port, () => { sock.off('error', reject); resolve() })
    })
    try { sock.setBroadcast(true) } catch {}
    try { sock.setMulticastLoopback(true) } catch {}
    try { sock.setMulticastTTL(1) } catch {}
    try { sock.addMembership(MCAST) } catch (e) { console.warn('[discovery] multicast join failed', e?.message || e) }
  } catch (e) {
    lanOk = false
    console.error('[discovery] LAN beacon disabled:', e?.message || e)
  }
  const pruneTimer = setInterval(() => { if (nearby.prune()) emitNearby() }, 1000)
  pruneTimer.unref?.()

  const sendBeacon = () => {
    if (!advert || !lanOk) return
    const buf = encodeBeacon({ ...advert, hostName, id: selfId })
    for (const addr of [MCAST, ...broadcastAddresses()]) {
      sock.send(buf, port, addr, () => {}) // errors (e.g. no route) are expected on some interfaces
    }
  }

  // ---- DHT ----
  let swarm = null
  const getSwarm = () => (swarm ??= new Hyperswarm(bootstrap ? { bootstrap } : {}))
  const onConnection = (socket) => {
    socket.on('error', () => {})
    if (!advert) return socket.end()
    socket.end(encodeBeacon({ ...advert, hostName, id: selfId }))
  }

  async function stopAdvertising () {
    if (!advert) return
    const a = advert
    advert = null
    clearInterval(a.timer)
    if (a.dht) { try { await swarm?.leave(a.topic) } catch {} }
    bus?.emit('discovery:advertising', null)
  }

  async function advertise ({ title, link } = {}) {
    if (closed) throw err('CLOSED')
    if (typeof link !== 'string' || !link.startsWith('lecscribe://')) throw err('BAD_LINK', 'advertise needs a lecscribe:// link')
    await stopAdvertising()
    let code = newCode()
    for (let i = 0; i < 20 && nearby.get(code); i++) code = newCode() // avoid a code already on the LAN
    advert = { code, title: String(title || 'Live lecture'), link, topic: codeTopic(code), dht: false }
    advert.timer = setInterval(sendBeacon, BEACON_MS)
    advert.timer.unref?.()
    sendBeacon()
    // DHT announce in the background (do not block the UI on the DHT)
    try {
      const s = getSwarm()
      if (!s.listenerCount('connection')) s.on('connection', onConnection)
      s.join(advert.topic, { server: true, client: false })
      advert.dht = true
    } catch (e) { console.warn('[discovery] DHT advertise failed', e?.message || e) }
    bus?.emit('discovery:advertising', { code, title: advert.title, link })
    return { code }
  }

  async function resolveCode (code, { timeoutMs = 8000 } = {}) {
    const c = normaliseCode(code)
    if (advert?.code === c) return advert.link
    const hit = nearby.get(c)
    if (hit) return hit.link
    const deadline = Date.now() + timeoutMs
    // 1) give the LAN a moment (beacons are 1 s apart)
    const lanUntil = Math.min(deadline, Date.now() + 1500)
    while (Date.now() < lanUntil) {
      await new Promise((r) => setTimeout(r, 100))
      const h = nearby.get(c)
      if (h) return h.link
    }
    // 2) DHT
    const left = deadline - Date.now()
    if (left <= 0) throw err('CODE_NOT_FOUND', `no live session with code ${formatCode(c)}`)
    const s = new Hyperswarm(bootstrap ? { bootstrap } : {})
    try {
      return await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(err('CODE_NOT_FOUND', `no live session with code ${formatCode(c)}`)), left)
        s.on('connection', (socket) => {
          const parts = []
          socket.on('data', (d) => parts.push(d))
          socket.on('error', () => {})
          socket.on('end', () => {
            const b = decodeBeacon(Buffer.concat(parts))
            if (b && b.code === c) { clearTimeout(t); resolve(b.link) }
          })
        })
        s.join(codeTopic(c), { server: false, client: true })
      })
    } finally {
      s.destroy().catch(() => {})
    }
  }

  async function close () {
    closed = true
    await stopAdvertising()
    clearInterval(pruneTimer)
    try { sock.close() } catch {}
    if (swarm) await swarm.destroy().catch(() => {})
  }

  return {
    advertise,
    stopAdvertising,
    listNearby: () => nearby.list(),
    resolveCode,
    advertising: () => (advert ? { code: advert.code, title: advert.title, link: advert.link } : null),
    close
  }
}
