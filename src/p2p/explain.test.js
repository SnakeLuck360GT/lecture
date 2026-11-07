// H-6 "Explain this" over P2P (aryan, while aaron is offline): peer request -> host bus -> note back.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { createRoom, joinRoom } from './index.js'

const require = createRequire(import.meta.url)
const createTestnet = require('hyperdht/testnet')
let testnet, bootstrap
before(async () => { testnet = await createTestnet(3); bootstrap = testnet.bootstrap })
after(async () => { await testnet.destroy() })

const mkBus = () => { const b = new EventEmitter(); b.setMaxListeners(100); return b }
const waitFor = (bus, name, pred = () => true, ms = 15000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { bus.off(name, h); reject(new Error(`timeout waiting for ${name}`)) }, ms)
  const h = (p) => { if (pred(p)) { clearTimeout(t); bus.off(name, h); resolve(p) } }
  bus.on(name, h)
})

test('H-6: a peer explain:request reaches the host bus as forwarded; the answer note reaches the peer', { timeout: 60000 }, async () => {
  const hostBus = mkBus(); const peerBus = mkBus()
  const room = await createRoom({ bus: hostBus, bootstrap, title: 'Hash Tables' })
  await room.ready
  hostBus.emit('slides:loaded', [{ index: 0, text: 'Hash Tables', image: null }, { index: 1, text: 'Hash functions', image: null }])
  // stand-in for the host AI: answer forwarded requests with an 'explain' note
  const requests = []
  hostBus.on('explain:request', (ev) => {
    requests.push(ev)
    if (ev.forwarded) hostBus.emit('note:added', { id: 'n-x1', slideIndex: ev.slideIndex, kind: 'explain', text: 'It maps keys to indexes.', sourceChunkIds: [], createdAt: Date.now() })
  })
  const peer = await joinRoom({ bus: peerBus, key: room.key, bootstrap })
  try {
    await waitFor(peerBus, 'p2p:status', (s) => s.state === 'connected', 20000)
    await waitFor(peerBus, 'slides:loaded', () => true, 20000).catch(() => {})
    const got = waitFor(peerBus, 'note:added', (n) => n.kind === 'explain', 20000)
    // the peer UI emits the request locally; retry a few times until the extension channel is up
    for (let i = 0; i < 20 && !requests.some((r) => r.forwarded); i++) {
      peerBus.emit('explain:request', { slideIndex: 1, from: 'peer' })
      await new Promise((r) => setTimeout(r, 300))
    }
    const fwd = requests.find((r) => r.forwarded)
    assert.ok(fwd, 'host received a forwarded request')
    assert.equal(fwd.slideIndex, 1)
    assert.equal(fwd.from, 'peer')
    assert.equal(requests.filter((r) => r.forwarded).length, 1, 'throttled: one forwarded request per slide per 10 s')
    const note = await got
    assert.equal(note.slideIndex, 1)
  } finally {
    await peer.close(); await room.close()
  }
})
