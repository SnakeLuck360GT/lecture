// S6 Pears room (+ S7 lost-tap logs). Owner: aaron. Contract: coord/contracts/stage-6.md, stage-7-p2p.md
//
// HOST: one Hypercore "room feed" (json messages) + one Hyperdrive (slide images), both in one Corestore.
//       Peers find the host through Hyperswarm on the feed's discoveryKey and replicate the whole store.
// PEER: reads the feed live and re-emits the same bus events the host UI uses.
//       Each peer also owns a "lost log" Hypercore. It sends that log's key to the host over the
//       `lecscribe/lost-v1` extension, and the host merges all logs into per-slide counts.
import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import { defaultStorage, parseKey, roomLink, resilientSwarm, imageToBuffer, bufferToDataUrl, serialQueue } from './util.js'

const LOST_EXT = 'lecscribe/lost-v1'
// B-015: live (partial) transcript lines are ephemeral, so they go over an extension, never into the feed.
const PARTIAL_EXT = 'lecscribe/partial-v1'
// H-6 (aryan, while aaron is offline): a peer's "Explain this" request goes to the host over an
// extension; the host re-emits it on its bus as { from: 'peer', forwarded: true } for the AI.
const EXPLAIN_EXT = 'lecscribe/explain-v1'
const EXPLAIN_THROTTLE_MS = 10000
const COUNTS_DEBOUNCE_MS = 200

// ---------------------------------------------------------------- HOST
export async function createRoom ({ bus, storage, title = '', moduleId = null, weekId = null, bootstrap, baseDir, history } = {}) {
  if (!bus) throw new Error('createRoom: bus is required')
  const store = new Corestore(storage || defaultStorage('host'))
  const feed = store.get({ name: 'room-feed', valueEncoding: 'json' })
  await feed.ready()
  const drive = new Hyperdrive(store.namespace('slides'))
  await drive.ready()

  const key = feed.key.toString('hex')
  const link = roomLink(feed.key)
  const enqueue = serialQueue()
  let closed = false
  const append = (msg) => enqueue(() => closed ? null : feed.append(msg))

  bus.emit('p2p:status', { role: 'host', state: 'starting', key, link })
  if (feed.length === 0) {
    await append({ type: 'room', v: 1, title, moduleId, weekId, driveKey: drive.key.toString('hex'), createdAt: Date.now() })
  }

  // ---- S7 merge: deviceId -> Map(slideIndex -> on)
  const devices = new Map()
  const openLogs = new Map()
  let countsTimer = null
  const lostCounts = () => {
    const counts = {}
    for (const slides of devices.values()) {
      for (const [slide, on] of slides) if (on) counts[slide] = (counts[slide] || 0) + 1
    }
    return counts
  }
  // The bus event fires on every change (cheap, keeps the heatmap in step with lostCounts()).
  // Only the republish into the room feed is debounced, so a burst of taps doesn't flood peers.
  let lastCountsJson = '{}'
  const countsChanged = () => {
    if (closed) return
    const counts = lostCounts()
    const json = JSON.stringify(counts)
    if (json === lastCountsJson) return
    lastCountsJson = json
    bus.emit('lost:counts', counts)
    if (countsTimer) return
    countsTimer = setTimeout(() => {
      countsTimer = null
      if (!closed) append({ type: 'lost', counts: lostCounts() }).catch(() => {})
    }, COUNTS_DEBOUNCE_MS)
  }
  const applyTap = (deviceId, entry) => {
    if (!entry || entry.type !== 'lost' || !Number.isInteger(entry.slideIndex)) return
    if (!devices.has(deviceId)) devices.set(deviceId, new Map())
    devices.get(deviceId).set(entry.slideIndex, entry.on !== false)
    countsChanged()
  }
  const openLostLog = async (logKeyHex) => {
    if (closed || openLogs.has(logKeyHex)) return
    let logKey
    try { logKey = parseKey(logKeyHex) } catch { return }
    const log = store.get({ key: logKey, valueEncoding: 'json' })
    openLogs.set(logKeyHex, log)
    try {
      await log.ready()
      for await (const entry of log.createReadStream({ live: true })) applyTap(logKeyHex, entry)
    } catch { /* closed */ }
  }
  feed.registerExtension(LOST_EXT, {
    encoding: 'json',
    onmessage: (msg) => { if (msg && typeof msg.logKey === 'string') openLostLog(msg.logKey) }
  })
  const lastExplain = new Map() // slideIndex -> time of the last forwarded request (throttle)
  feed.registerExtension(EXPLAIN_EXT, {
    encoding: 'json',
    onmessage: (msg) => {
      if (closed || !msg || !Number.isInteger(msg.slideIndex) || msg.slideIndex < 0) return
      const now = Date.now()
      if (now - (lastExplain.get(msg.slideIndex) || 0) < EXPLAIN_THROTTLE_MS) return
      lastExplain.set(msg.slideIndex, now)
      bus.emit('explain:request', { slideIndex: msg.slideIndex, from: 'peer', forwarded: true })
    }
  })

  // ---- swarm
  let peers = 0
  const net = resilientSwarm(store, {
    topic: feed.discoveryKey,
    server: true,
    client: false,
    bootstrap,
    onConnection: (socket) => {
      peers++
      bus.emit('p2p:peers', { count: peers })
      socket.once('close', () => { peers = Math.max(0, peers - 1); if (!closed) bus.emit('p2p:peers', { count: peers }) })
    },
    // Network switched (e.g. Wi-Fi off/on on stage): fresh DHT node re-announced the room.
    onRestart: (reason) => {
      if (closed) return
      bus.emit('p2p:status', { role: 'host', state: 'starting', key, link, reason })
      net.flushed.then(() => { if (!closed) bus.emit('p2p:status', { role: 'host', state: 'open', key, link, reason }) }, () => {})
    }
  })
  const ready = net.flushed.then(() => {
    if (!closed) bus.emit('p2p:status', { role: 'host', state: 'open', key, link })
  }).catch((err) => {
    if (!closed) bus.emit('p2p:status', { role: 'host', state: 'error', key, link, error: String(err?.message || err) })
  })

  // ---- bus -> feed
  const onSlides = (slides) => enqueue(async () => {
    if (closed || !Array.isArray(slides)) return
    const out = []
    for (const s of slides) {
      let imagePath = null
      const img = await imageToBuffer(s.image, baseDir)
      if (img) {
        imagePath = `/slides/${s.index}${img.ext}`
        await drive.put(imagePath, img.buf)
      }
      out.push({ index: s.index, text: s.text || '', imagePath })
    }
    if (!closed) await feed.append({ type: 'slides', slides: out })
  }).catch((err) => bus.emit('p2p:status', { role: 'host', state: 'error', key, link, error: 'slides: ' + err.message }))
  const onSlide = (e) => { if (e && Number.isInteger(e.index)) append({ type: 'slide', index: e.index, source: e.source || 'manual', t: Date.now() }).catch(() => {}) }
  const onNote = (note) => { if (note && note.id) append({ type: 'note', note }).catch(() => {}) }
  // B-015 transcript (text only, never audio): finals go into the feed (late joiners get them),
  // partials are broadcast to connected peers only.
  const partialExt = feed.registerExtension(PARTIAL_EXT, { encoding: 'json', onmessage: () => {} })
  const onChunk = (c) => { if (c && c.id && c.text) append({ type: 'chunk', chunk: c }).catch(() => {}) }
  const onPartial = (p) => { if (!closed && p && p.text) { try { partialExt.broadcast({ partial: p }) } catch {} } }
  // A room opened mid-lecture first publishes what already happened: { slides, slideIndex, notes }.
  if (history?.slides) onSlides(history.slides)
  if (Number.isInteger(history?.slideIndex)) onSlide({ index: history.slideIndex, source: 'manual' })
  for (const n of history?.notes || []) onNote(n)
  for (const c of history?.chunks || []) onChunk(c)
  bus.on('slides:loaded', onSlides)
  bus.on('slide:changed', onSlide)
  bus.on('note:added', onNote)
  bus.on('transcript:chunk', onChunk)
  bus.on('transcript:partial', onPartial)

  return {
    key,
    link,
    ready, // resolves once the room is announced on the DHT
    get peers () { return peers },
    lostCounts,
    /** Re-announce on the current network (also happens automatically when the IP changes). */
    refreshNetwork: () => net.restart('manual'),
    simulateLost (slideIndex, n = 1) {
      for (let i = 0; i < n; i++) applyTap(`sim-${slideIndex}-${devices.size}-${i}`, { type: 'lost', slideIndex, on: true })
    },
    async close () {
      if (closed) return
      bus.off('slides:loaded', onSlides)
      bus.off('slide:changed', onSlide)
      bus.off('note:added', onNote)
      bus.off('transcript:chunk', onChunk)
      bus.off('transcript:partial', onPartial)
      try { await append({ type: 'end' }) } catch {}
      closed = true
      clearTimeout(countsTimer)
      await net.destroy()
      await store.close().catch(() => {})
    },
    _internals: { store, feed, drive, get swarm () { return net.swarm } }
  }
}

// ---------------------------------------------------------------- PEER
export async function joinRoom ({ bus, key, storage, bootstrap, imageTimeoutMs = 20000 } = {}) {
  if (!bus) throw new Error('joinRoom: bus is required')
  const roomKey = parseKey(key)
  const keyHex = roomKey.toString('hex')
  const store = new Corestore(storage || defaultStorage('peer'))
  const feed = store.get({ key: roomKey, valueEncoding: 'json' })
  await feed.ready()
  const lostLog = store.get({ name: 'lost-log', valueEncoding: 'json' })
  await lostLog.ready()
  const logKey = lostLog.key.toString('hex')
  let closed = false
  let drive = null
  const lostState = {}

  bus.emit('p2p:status', { role: 'peer', state: 'connecting', key: keyHex })

  const ext = feed.registerExtension(LOST_EXT, { encoding: 'json', onmessage: () => {} })
  feed.registerExtension(PARTIAL_EXT, {
    encoding: 'json',
    onmessage: (m) => { if (!closed && m && m.partial && typeof m.partial.text === 'string') bus.emit('transcript:partial', m.partial) }
  })
  const explainExt = feed.registerExtension(EXPLAIN_EXT, { encoding: 'json', onmessage: () => {} })
  const sendExplain = (slideIndex) => { if (!closed && Number.isInteger(slideIndex)) { try { explainExt.broadcast({ slideIndex }) } catch {} } }
  const onExplainRequest = (ev) => { if (ev && ev.from === 'peer' && !ev.forwarded) sendExplain(ev.slideIndex) }
  bus.on('explain:request', onExplainRequest)
  const announce = () => { try { ext.broadcast({ logKey }) } catch {} }
  feed.on('peer-add', (peer) => { try { ext.send({ logKey }, peer) } catch {} })

  let connected = false
  const net = resilientSwarm(store, {
    topic: feed.discoveryKey,
    server: false,
    client: true,
    bootstrap,
    onConnection: () => {
      if (!connected && !closed) { connected = true; bus.emit('p2p:status', { role: 'peer', state: 'connected', key: keyHex }) }
    },
    onRestart: (reason) => {
      if (closed) return
      connected = false
      bus.emit('p2p:status', { role: 'peer', state: 'connecting', key: keyHex, reason })
    }
  })

  // ---- feed -> bus (strictly in order)
  const reader = (async () => {
    try {
      for await (const msg of feed.createReadStream({ live: true })) {
        if (closed) break
        await handle(msg)
      }
    } catch (err) {
      if (!closed) bus.emit('p2p:status', { role: 'peer', state: 'error', key: keyHex, error: String(err?.message || err) })
    }
  })()

  // The host writes images to the drive BEFORE appending the 'slides' message, but our view of the
  // drive may still be stale when the message arrives, so update and retry until the entry shows up.
  async function fetchImage (path) {
    const deadline = Date.now() + imageTimeoutMs
    while (!closed && Date.now() < deadline) {
      try {
        await drive.update({ wait: true })
        const buf = await drive.get(path, { timeout: Math.max(1, deadline - Date.now()) })
        if (buf) return buf
      } catch { /* not there yet */ }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    return null
  }

  async function handle (msg) {
    if (!msg || typeof msg !== 'object') return
    switch (msg.type) {
      case 'room':
        if (msg.driveKey) { drive = new Hyperdrive(store, parseKey(msg.driveKey)); await drive.ready() }
        bus.emit('room:info', { title: msg.title, moduleId: msg.moduleId, weekId: msg.weekId, createdAt: msg.createdAt })
        break
      case 'slides': {
        const slides = []
        for (const s of msg.slides || []) {
          let image = null
          if (drive && s.imagePath) {
            const buf = await fetchImage(s.imagePath)
            if (buf) image = bufferToDataUrl(buf, s.imagePath)
          }
          slides.push({ index: s.index, text: s.text, image })
        }
        bus.emit('slides:loaded', slides)
        break
      }
      case 'slide': bus.emit('slide:changed', { index: msg.index, source: 'remote' }); break
      case 'note': bus.emit('note:added', msg.note); break
      case 'chunk': bus.emit('transcript:chunk', msg.chunk); break
      case 'lost': bus.emit('lost:counts', msg.counts || {}); break
      case 'end': bus.emit('room:ended', {}); break
    }
  }

  return {
    key: keyHex,
    logKey,
    get connected () { return connected },
    async lost (slideIndex, on = true) {
      if (closed || !Number.isInteger(slideIndex)) return
      await lostLog.append({ type: 'lost', slideIndex, on: !!on, t: Date.now() })
      if (on) lostState[slideIndex] = true
      else delete lostState[slideIndex]
      bus.emit('lost:state', { ...lostState })
      announce()
    },
    lostState: () => ({ ...lostState }),
    /** H-6: ask the host's AI to explain a slide (the answer arrives as note:added kind 'explain'). */
    explainThis: (slideIndex) => sendExplain(slideIndex),
    async close () {
      if (closed) return
      closed = true
      bus.off('explain:request', onExplainRequest)
      await net.destroy()
      await store.close().catch(() => {})
      await reader
    },
    refreshNetwork: () => net.restart('manual'),
    _internals: { store, feed, lostLog, get swarm () { return net.swarm } }
  }
}
