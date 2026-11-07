// Shared helpers for the P2P stages (S6/S7/S8). Owner: aaron. Cross-platform, no shell.
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import Hyperswarm from 'hyperswarm'
import idEnc from 'hypercore-id-encoding'

export const ROOM_PREFIX = 'lecscribe://room/'
export const WEEK_PREFIX = 'lecscribe://week/'

/** A fresh per-instance storage dir, so two instances can run on one machine. */
export function defaultStorage (tag = 'p2p') {
  return join(tmpdir(), 'lecscribe-p2p', `${tag}-${Date.now()}-${randomBytes(4).toString('hex')}`)
}

/** hex | z32 | lecscribe://room/<id> | lecscribe://week/<id>  ->  32-byte key Buffer. Throws Error('BAD_LINK'). */
export function parseKey (input) {
  if (Buffer.isBuffer(input) && input.length === 32) return input
  let s = String(input ?? '').trim()
  s = s.replace(/^lecscribe:\/\/(room|week)\//i, '').replace(/^pear:\/\//i, '').replace(/\/+$/, '')
  try {
    if (!idEnc.isValid(s)) throw new Error('invalid')
    return idEnc.decode(s)
  } catch {
    const err = new Error('BAD_LINK')
    err.code = 'BAD_LINK'
    throw err
  }
}

export const toZ32 = (key) => idEnc.encode(key)
export const roomLink = (key) => ROOM_PREFIX + toZ32(key)
export const weekLink = (key) => WEEK_PREFIX + toZ32(key)

/**
 * Build a Hyperswarm that replicates `store` over every connection.
 * opts.bootstrap: DHT bootstrap nodes (tests use a local testnet; undefined = public DHT).
 */
export function makeSwarm (store, { bootstrap, onConnection } = {}) {
  const swarm = new Hyperswarm(bootstrap ? { bootstrap } : {})
  swarm.on('connection', (socket, info) => {
    socket.on('error', () => {}) // peers dropping off is normal
    store.replicate(socket)
    if (onConnection) onConnection(socket, info)
  })
  return swarm
}

/**
 * swarm.join + keep re-querying the DHT while we have no connection. Without this, a client that looks up
 * the topic before the server has finished announcing waits for Hyperswarm's slow periodic refresh.
 * Returns { discovery, flushed, stop }.
 */
export function joinTopic (swarm, topic, { server = false, client = true, retryMs = 3000 } = {}) {
  const discovery = swarm.join(topic, { server, client })
  let timer = null
  if (client) {
    timer = setInterval(() => {
      if (swarm.connections.size === 0) discovery.refresh({ client: true, server }).catch(() => {})
    }, retryMs)
    if (timer.unref) timer.unref()
  }
  return { discovery, flushed: discovery.flushed(), stop: () => clearInterval(timer) }
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }
const EXT = Object.fromEntries(Object.entries(MIME).map(([e, m]) => [m, e]))

/** Slide.image (path | Buffer | data: URL | null)  ->  { buf, ext } | null. */
export async function imageToBuffer (image, baseDir = process.cwd()) {
  if (!image) return null
  if (Buffer.isBuffer(image) || image instanceof Uint8Array) return { buf: Buffer.from(image), ext: '.png' }
  if (typeof image !== 'string') return null
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(image)
  if (m) {
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]))
    return { buf, ext: EXT[m[1]] || '.png' }
  }
  const p = /^([a-zA-Z]:[\\/]|[\\/])/.test(image) ? image : join(baseDir, image)
  try {
    return { buf: await readFile(p), ext: extname(p).toLowerCase() || '.png' }
  } catch {
    return null
  }
}

export function bufferToDataUrl (buf, path) {
  const mime = MIME[extname(path).toLowerCase()] || 'application/octet-stream'
  return `data:${mime};base64,${Buffer.from(buf).toString('base64')}`
}

/** Run async jobs strictly in order (keeps the feed ordered: slides before slide changes, etc). */
export function serialQueue () {
  let tail = Promise.resolve()
  return (fn) => {
    const p = tail.then(fn)
    tail = p.catch(() => {})
    return p
  }
}
