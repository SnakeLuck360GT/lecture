// Unit/integration tests for src/p2p (owner: aaron). Host + peers in one process over a LOCAL DHT testnet
// (no internet needed, deterministic). Run: node --test src/p2p/p2p.test.js  (or npm test)
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { createRoom, joinRoom, shareWeek, importWeek, parseKey, roomLink, weekLink } from './index.js'

const require = createRequire(import.meta.url)
const createTestnet = require('hyperdht/testnet')

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
let testnet, bootstrap

before(async () => { testnet = await createTestnet(3); bootstrap = testnet.bootstrap })
after(async () => { await testnet.destroy() })

const mkBus = () => { const b = new EventEmitter(); b.setMaxListeners(100); return b }
const waitFor = (bus, name, pred = () => true, ms = 15000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { bus.off(name, h); reject(new Error(`timeout waiting for ${name}`)) }, ms)
  const h = (p) => { if (pred(p)) { clearTimeout(t); bus.off(name, h); resolve(p) } }
  bus.on(name, h)
})

test('parseKey accepts hex, z32 and lecscribe links; rejects junk', () => {
  const key = Buffer.alloc(32, 7)
  const hex = key.toString('hex')
  assert.deepEqual(parseKey(hex), key)
  assert.deepEqual(parseKey(roomLink(key)), key)
  assert.deepEqual(parseKey(weekLink(key)), key)
  assert.deepEqual(parseKey(roomLink(key).replace('lecscribe://room/', '')), key)
  assert.throws(() => parseKey('nope'), /BAD_LINK/)
  assert.throws(() => parseKey(''), /BAD_LINK/)
})

test('S6: peer joins by link and receives slides (with images), current slide and notes, in order', async () => {
  const hostBus = mkBus()
  const room = await createRoom({ bus: hostBus, bootstrap, title: 'Hash Tables', moduleId: 'COMP26120', weekId: 'w3' })
  assert.match(room.key, /^[0-9a-f]{64}$/)
  assert.ok(room.link.startsWith('lecscribe://room/'))

  // host activity BEFORE the peer joins (late joiner must get history)
  hostBus.emit('slides:loaded', [{ index: 0, text: 'Hash Tables', image: PNG_1PX }, { index: 1, text: 'Hash functions', image: null }])
  hostBus.emit('slide:changed', { index: 1, source: 'auto' })
  hostBus.emit('note:added', { id: 'n1', slideIndex: 1, kind: 'ai', text: 'k mod m works best with prime m', sourceChunkIds: ['c-1'], createdAt: 1 })

  const peerBus = mkBus()
  const gotSlides = waitFor(peerBus, 'slides:loaded')
  const gotNote1 = waitFor(peerBus, 'note:added', (n) => n.id === 'n1')
  const peer = await joinRoom({ bus: peerBus, key: room.link, bootstrap })

  const slides = await gotSlides
  assert.equal(slides.length, 2)
  assert.equal(slides[0].text, 'Hash Tables')
  assert.ok(slides[0].image.startsWith('data:image/png;base64,'), 'image arrives as data URL')
  assert.equal(slides[1].image, null)
  const n1 = await gotNote1
  assert.equal(n1.text, 'k mod m works best with prime m')

  // live updates after joining
  const liveSlide = waitFor(peerBus, 'slide:changed', (e) => e.index === 0)
  const liveNote = waitFor(peerBus, 'note:added', (n) => n.id === 'n2')
  hostBus.emit('slide:changed', { index: 0, source: 'manual' })
  hostBus.emit('note:added', { id: 'n2', slideIndex: 0, kind: 'lecturer', text: 'Explained again', sourceChunkIds: [], createdAt: 2 })
  assert.equal((await liveSlide).source, 'remote')
  assert.equal((await liveNote).kind, 'lecturer')

  const ended = waitFor(peerBus, 'room:ended')
  await room.close()
  await ended
  await peer.close()
})

test('S7: lost taps from several devices merge into per-slide device counts (toggle, no double count)', async () => {
  const hostBus = mkBus()
  const room = await createRoom({ bus: hostBus, bootstrap })
  const peers = []
  for (let i = 0; i < 3; i++) peers.push(await joinRoom({ bus: mkBus(), key: room.key, bootstrap }))

  const target = waitFor(hostBus, 'lost:counts', (c) => c[2] === 3 && c[4] === 1)
  await peers[0].lost(2)
  await peers[0].lost(2) // same device twice -> still 1
  await peers[1].lost(2)
  await peers[2].lost(2)
  await peers[2].lost(4)
  const counts = await target
  assert.deepEqual(counts, { 2: 3, 4: 1 })
  assert.deepEqual(peers[2].lostState(), { 2: true, 4: true })

  const after = waitFor(hostBus, 'lost:counts', (c) => c[2] === 2)
  await peers[1].lost(2, false) // toggle off
  assert.deepEqual(await after, { 2: 2, 4: 1 })
  assert.deepEqual(room.lostCounts(), { 2: 2, 4: 1 })

  room.simulateLost(0, 5)
  assert.equal(room.lostCounts()[0], 5)

  for (const p of peers) await p.close()
  await room.close()
})

test('S8: shareWeek -> importWeek round-trips the bundle and tags notes as shared', async () => {
  const bundle = {
    v: 1,
    moduleId: 'COMP26120',
    weekId: 'w3',
    title: 'Hash Tables',
    sharedBy: 'aaron',
    slides: [{ index: 0, text: 'Hash Tables' }],
    notes: [{ id: 'n1', slideIndex: 0, kind: 'ai', text: 'prime m', sourceChunkIds: [], createdAt: 1 }],
    summary: 'Hashing basics',
    transcript: [{ id: 'c-1', slideIndex: 0, tStart: 0, tEnd: 5, text: 'hello' }],
    exportedAt: 123
  }
  const share = await shareWeek(bundle, { bootstrap })
  assert.ok(share.link.startsWith('lecscribe://week/'))
  const got = await importWeek(share.link, { bootstrap, timeoutMs: 15000 })
  assert.equal(got.moduleId, 'COMP26120')
  assert.equal(got.weekId, 'w3')
  assert.equal(got.sharedBy, 'aaron')
  assert.equal(got.summary, 'Hashing basics')
  assert.deepEqual(got.slides, bundle.slides)
  assert.deepEqual(got.transcript, bundle.transcript)
  assert.equal(got.notes.length, 1)
  assert.equal(got.notes[0].shared, true)
  assert.equal(got.notes[0].text, 'prime m')
  await share.stop()
})

test('S8: importWeek fails fast with BAD_LINK and SHARE_TIMEOUT', async () => {
  await assert.rejects(importWeek('garbage', { bootstrap }), /BAD_LINK/)
  await assert.rejects(importWeek(weekLink(Buffer.alloc(32, 9)), { bootstrap, timeoutMs: 1500 }), /SHARE_TIMEOUT/)
})

test('S6: createRoom({ history }) publishes slides/current slide/notes that happened before the room opened', async () => {
  const hostBus = mkBus()
  const history = { slides: [{ index: 0, text: 'A' }, { index: 1, text: 'B' }], slideIndex: 1, notes: [{ id: 'h1', slideIndex: 0, kind: 'ai', text: 'early', sourceChunkIds: [], createdAt: 1 }] }
  const room = await createRoom({ bus: hostBus, bootstrap, history })
  const peerBus = mkBus()
  const slides = waitFor(peerBus, 'slides:loaded')
  const slide = waitFor(peerBus, 'slide:changed', (e) => e.index === 1)
  const note = waitFor(peerBus, 'note:added', (n) => n.id === 'h1')
  const peer = await joinRoom({ bus: peerBus, key: room.key, bootstrap })
  assert.equal((await slides).length, 2)
  await slide
  assert.equal((await note).text, 'early')
  await peer.close()
  await room.close()
})

test('startP2P (app-shell adapter): room opened mid-lecture, peer joins, AI stopped on peer, taps counted', async () => {
  const { startP2P } = await import('./host.js')
  const hostBus = mkBus()
  const host = await startP2P({ bus: hostBus, bootstrap })
  hostBus.emit('slides:loaded', [{ index: 0, text: 'A' }, { index: 1, text: 'B' }])
  hostBus.emit('slide:changed', { index: 1, source: 'auto' })
  hostBus.emit('note:added', { id: 'x1', slideIndex: 1, kind: 'ai', text: 'before room', sourceChunkIds: [], createdAt: 1 })
  const r = await host.createRoom({ title: 'T' })
  assert.equal(r.role, 'host')
  assert.ok(r.link.startsWith('lecscribe://room/'))

  const peerBus = mkBus()
  let aiClosed = false
  const peer = await startP2P({ bus: peerBus, bootstrap, ai: () => ({ close: async () => { aiClosed = true } }) })
  await assert.rejects(peer.lost(0), /not joined/)
  const gotNote = waitFor(peerBus, 'note:added', (n) => n.id === 'x1')
  const gotSlide = waitFor(peerBus, 'slide:changed', (e) => e.index === 1)
  const j = await peer.joinRoom(r.link)
  assert.equal(j.role, 'peer')
  assert.equal(aiClosed, true)
  await gotNote
  await gotSlide

  const counted = waitFor(hostBus, 'lost:counts', (c) => c[1] === 1)
  assert.deepEqual(await peer.lost(1), { 1: true })
  await counted
  assert.deepEqual(host.lostCounts(), { 1: 1 })
  assert.deepEqual(host.simulateLost(1, 2), { 1: 3 })
  structuredClone(host.info()); structuredClone(peer.info()) // IPC-safe
  await peer.close()
  await host.close()
})

test('S6: host network restart (Wi-Fi off/on) -> peer reconnects and keeps receiving live notes', async () => {
  const hostBus = mkBus()
  const room = await createRoom({ bus: hostBus, bootstrap })
  const peerBus = mkBus()
  const first = waitFor(peerBus, 'note:added', (n) => n.id === 'before')
  const peer = await joinRoom({ bus: peerBus, key: room.link, bootstrap })
  hostBus.emit('note:added', { id: 'before', slideIndex: 0, kind: 'ai', text: 'before restart', sourceChunkIds: [], createdAt: 1 })
  await first

  const reopened = waitFor(hostBus, 'p2p:status', (s) => s.state === 'open' && s.reason === 'manual')
  await room.refreshNetwork() // what the IP watcher does after a network switch
  await reopened
  const after = waitFor(peerBus, 'note:added', (n) => n.id === 'after', 30000)
  hostBus.emit('note:added', { id: 'after', slideIndex: 0, kind: 'ai', text: 'after restart', sourceChunkIds: [], createdAt: 2 })
  assert.equal((await after).text, 'after restart')
  await peer.close()
  await room.close()
})

test('ipSignature lists non-internal IPv4 addresses (sorted, stable)', async () => {
  const { ipSignature } = await import('./util.js')
  const a = ipSignature()
  assert.equal(typeof a, 'string')
  assert.equal(a, ipSignature())
  assert.ok(!a.split(',').includes('127.0.0.1'))
})

test('B-014: startP2P.joinRoom does not wait for a slow AI shutdown (model still downloading)', async () => {
  const { startP2P } = await import('./host.js')
  const hostBus = mkBus()
  const room = await createRoom({ bus: hostBus, bootstrap })
  let closeCalled = false
  const neverEnds = { close: () => { closeCalled = true; return new Promise(() => {}) } } // hangs forever
  const p2p = await startP2P({ bus: mkBus(), bootstrap, ai: () => neverEnds })
  const t0 = Date.now()
  const info = await p2p.joinRoom(room.link)
  assert.ok(Date.now() - t0 < 3000, `join took ${Date.now() - t0} ms`)
  assert.equal(info.role, 'peer')
  assert.equal(closeCalled, true, 'AI still told to stop')
  await p2p.close()
  await room.close()
})

test('simulateLost via the app facade works offline (no room) and with a room', async () => {
  const { startP2P } = await import('./host.js')
  const bus = mkBus()
  const p2p = await startP2P({ bus, bootstrap })
  const got = waitFor(bus, 'lost:counts', (c) => c[2] === 3)
  assert.deepEqual(p2p.simulateLost(2, 3), { 2: 3 }) // no room: local only
  await got
  assert.deepEqual(p2p.lostCounts(), { 2: 3 })
  assert.deepEqual(p2p.resetSimulatedLost(), {})
  assert.throws(() => p2p.simulateLost(-1, 1), /bad slide index/)
  await p2p.createRoom({ title: 'T' })
  assert.deepEqual(p2p.simulateLost(1, 2), { 1: 2 }) // with a room: merges into the room counts
  await p2p.close()
})
