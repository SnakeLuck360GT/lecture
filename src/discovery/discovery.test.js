// Discovery unit + integration tests (owner: aryan). Run: node --test src/discovery/
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import {
  normaliseCode, formatCode, newCode, codeTopic, encodeBeacon, decodeBeacon,
  createNearbyList, startDiscovery, broadcastAddresses
} from './index.js'

const require = createRequire(import.meta.url)
const LINK = 'lecscribe://room/uebob54ojy8umd663tt8oeb9nxfpry7uwwqm334gdqk8b5jgpzxy'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('codes: normalise, format, generate, topic', () => {
  assert.equal(normaliseCode('482 913'), '482913')
  assert.equal(normaliseCode('482-913'), '482913')
  assert.equal(normaliseCode(482913), '482913')
  assert.throws(() => normaliseCode('48291'), { code: 'BAD_CODE' })
  assert.throws(() => normaliseCode('abcdef'), { code: 'BAD_CODE' })
  assert.equal(formatCode('482913'), '482 913')
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^\d{6}$/)
  assert.equal(codeTopic('482913').length, 32)
  assert.deepEqual(codeTopic('482 913'), codeTopic('482913'))
})

test('beacon encode/decode + validation', () => {
  const b = decodeBeacon(encodeBeacon({ code: '123456', title: 'Week 3 · Hash Tables', link: LINK, hostName: 'mac', id: 'x' }))
  assert.deepEqual(b, { code: '123456', title: 'Week 3 · Hash Tables', link: LINK, hostName: 'mac', id: 'x' })
  assert.equal(decodeBeacon(Buffer.from('hello')), null)
  assert.equal(decodeBeacon(Buffer.from(JSON.stringify({ v: 1, app: 'other', code: '123456', link: LINK }))), null)
  assert.equal(decodeBeacon(Buffer.from(JSON.stringify({ v: 1, app: 'lecscribe', code: '12345', link: LINK }))), null)
  assert.equal(decodeBeacon(Buffer.from(JSON.stringify({ v: 1, app: 'lecscribe', code: '123456', link: 'http://evil' }))), null)
  assert.equal(decodeBeacon(Buffer.alloc(2000)), null)
})

test('nearby list: add, update, expire', () => {
  let t = 0
  const l = createNearbyList({ expireMs: 5000, now: () => t })
  assert.equal(l.see({ code: '111111', title: 'A', link: LINK, hostName: 'h' }), true)
  assert.equal(l.see({ code: '111111', title: 'A', link: LINK, hostName: 'h' }), false, 'same beacon: no change')
  assert.equal(l.see({ code: '111111', title: 'A2', link: LINK, hostName: 'h' }), true, 'title changed')
  t = 4000; assert.equal(l.prune(), false)
  t = 5001; assert.equal(l.prune(), true)
  assert.deepEqual(l.list(), [])
})

test('broadcastAddresses returns dotted IPv4 strings', () => {
  for (const a of broadcastAddresses()) assert.match(a, /^\d+\.\d+\.\d+\.\d+$/)
})

// ---- integration: two instances on one machine (LAN beacon) ----
test('LAN: host advertises, a second instance lists it and resolves the code', async (t) => {
  const port = 47000 + Math.floor(Math.random() * 400)
  const busA = new EventEmitter(); const busB = new EventEmitter()
  const host = await startDiscovery({ bus: busA, hostName: 'lecturer-mac', port })
  const peer = await startDiscovery({ bus: busB, hostName: 'student', port })
  try {
    const seen = new Promise((resolve) => busB.on('discovery:nearby', (list) => { if (list.length) resolve(list) }))
    const { code } = await host.advertise({ title: 'Week 3 · Hash Tables', link: LINK })
    assert.match(code, /^\d{6}$/)
    const list = await Promise.race([seen, sleep(4000).then(() => null)])
    if (!list) { t.skip('no UDP multicast/broadcast delivery on this machine'); return }
    assert.equal(list[0].code, code)
    assert.equal(list[0].title, 'Week 3 · Hash Tables')
    assert.equal(list[0].hostName, 'lecturer-mac')
    assert.equal(await peer.resolveCode(formatCode(code), { timeoutMs: 3000 }), LINK)
    await host.stopAdvertising()
    assert.equal(host.advertising(), null)
  } finally {
    await host.close(); await peer.close()
  }
})

// ---- integration: DHT fallback (no LAN: different ports so beacons never meet) ----
let testnet = null
before(async () => { const createTestnet = require('hyperdht/testnet'); testnet = await createTestnet(3) })
after(async () => { await testnet?.destroy() })

test('DHT: resolveCode finds the host across "networks" (local testnet)', { timeout: 60000 }, async () => {
  const bootstrap = testnet.bootstrap
  const host = await startDiscovery({ port: 46001, bootstrap })
  const peer = await startDiscovery({ port: 46002, bootstrap })
  try {
    const { code } = await host.advertise({ title: 'Remote', link: LINK })
    await sleep(1500) // let the announce reach the testnet
    assert.equal(await peer.resolveCode(code, { timeoutMs: 20000 }), LINK)
    await assert.rejects(peer.resolveCode('000000', { timeoutMs: 2500 }), { code: 'CODE_NOT_FOUND' })
  } finally {
    await host.close(); await peer.close()
  }
})
