// Contract tests for aaron's P2P stages (S6 room, S7-P2P lost taps, S8 share link),
// from coord/contracts/stage-{6,7-p2p,8}.md v1. Real Hyperswarm, host + peers in ONE process
// (separate storage dirs). Needs a network that allows DHT (internet or hotspot).
// PENDING (skipped) until src/p2p/index.js is merged into dev.
import { test, describe, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { src, fx, pending, maybeImport, recordingBus, waitFor, slidesFixture, checkNote } from './../helpers.mjs'

const P2P = src('p2p', 'index.js')
const skip = pending(P2P, 'S6 Pears room (aaron)')
const NET = 60_000 // generous: first DHT lookup can be slow
const store = () => mkdtempSync(join(tmpdir(), 'lecscribe-test-'))
const Z32 = /^[ybndrfg8ejkmcpqxot1uwisza345h769]+$/

// Slides as the host bus has them after S1 (image = data URL, like the real loader may produce).
const slides = () => slidesFixture().map((s) => ({
  index: s.index, text: s.text,
  image: 'data:image/png;base64,' + readFileSync(join(fx('..'), s.image)).toString('base64')
}))
const note = (i, slideIndex, kind = 'ai') => ({ id: `n-${i}`, slideIndex, kind, text: `note ${i} for slide ${slideIndex}`, sourceChunkIds: [`c-${i}`], createdAt: 1_700_000_000_000 + i })

describe('S6 Pears room', { skip }, () => {
  const closers = []
  after(async () => { for (const c of closers.reverse()) await c().catch(() => {}) })

  let mod, host, hostBus
  test('createRoom: key is 64-char hex, link is lecscribe://room/<z32>, status open', { timeout: NET }, async () => {
    mod = await maybeImport(P2P)
    hostBus = recordingBus()
    host = await mod.createRoom({ bus: hostBus, storage: store(), title: 'Week 3: Hash Tables', moduleId: 'COMP26120', weekId: 'week-3' })
    closers.push(() => host.close())
    assert.match(host.key, /^[0-9a-f]{64}$/)
    const m = host.link.match(/^lecscribe:\/\/room\/(.+)$/)
    assert.ok(m && Z32.test(m[1]), `link ${host.link}`)
    await waitFor(() => hostBus.events('p2p:status').some((s) => s.role === 'host' && s.state === 'open'), NET - 5000)
  })

  test('host publishes slides, current slide and notes; a LATE joiner (by key) receives the full history in order', { timeout: NET * 2 }, async () => {
    hostBus.emit('slides:loaded', slides())
    hostBus.emit('slide:changed', { index: 1, source: 'auto' })
    hostBus.emit('note:added', note(1, 0))
    hostBus.emit('note:added', note(2, 1))
    hostBus.emit('note:added', note(3, 3, 'lecturer'))
    hostBus.emit('slide:changed', { index: 2, source: 'manual' })

    const pb = recordingBus()
    const peer = await mod.joinRoom({ bus: pb, key: host.key, storage: store() })
    closers.push(() => peer.close())
    await waitFor(() => pb.events('note:added').length >= 3 && pb.events('slide:changed').some((e) => e.index === 2), NET * 2 - 5000, 200)

    const got = pb.events('slides:loaded').at(-1)
    assert.equal(got.length, 5)
    got.forEach((s, i) => { assert.equal(s.index, i); assert.equal(s.text, slides()[i].text); assert.match(s.image, /^data:image\//) })
    assert.deepEqual(pb.events('note:added').map((n) => n.id), ['n-1', 'n-2', 'n-3'])
    for (const n of pb.events('note:added')) assert.deepEqual(checkNote(n), [])
    assert.equal(pb.events('note:added')[2].kind, 'lecturer')
    assert.equal(pb.events('slide:changed').at(-1).index, 2)
    assert.ok(pb.events('slide:changed').every((e) => e.source === 'remote'))
    assert.ok(pb.events('p2p:status').some((s) => s.role === 'peer' && s.state === 'connected'))
    await waitFor(() => host.peers >= 1 && hostBus.events('p2p:peers').some((p) => p.count >= 1), 10_000)
  })

  test('live: a note added after join arrives at a peer that joined by LINK', { timeout: NET * 2 }, async () => {
    const pb = recordingBus()
    const peer = await mod.joinRoom({ bus: pb, key: host.link, storage: store() })
    closers.push(() => peer.close())
    await waitFor(() => pb.events('note:added').length >= 3, NET - 5000, 200)
    const t0 = Date.now()
    hostBus.emit('note:added', note(4, 4))
    await waitFor(() => pb.events('note:added').some((n) => n.id === 'n-4'), 15_000, 50)
    console.log(`live note latency ${Date.now() - t0} ms`)
  })

  // ---- S7 P2P half ----
  test('S7: lost taps from 3 devices merge into per-slide DEVICE counts (toggle, no double count, no names)', { timeout: NET * 3 }, async () => {
    const peers = []
    for (let i = 0; i < 3; i++) {
      const p = await mod.joinRoom({ bus: recordingBus(), key: host.key, storage: store() })
      closers.push(() => p.close()); peers.push(p)
    }
    await peers[0].lost(3); await peers[1].lost(3); await peers[2].lost(1)
    await peers[0].lost(3) // same device, same slide: still counts once
    await waitFor(() => { const c = host.lostCounts(); return c[3] === 2 && c[1] === 1 }, NET * 2, 200)
    await peers[2].lost(1, false) // un-tap
    await waitFor(() => !host.lostCounts()[1], 20_000, 200)
    const last = hostBus.events('lost:counts').at(-1)
    assert.deepEqual(last, { 3: 2 }, `lost:counts ${JSON.stringify(last)}`)
    for (const [k, v] of Object.entries(last)) { assert.match(k, /^\d+$/); assert.ok(Number.isInteger(v)) }
    assert.deepEqual(peers[0].lostState(), { 3: true })
  })

  test('S7: simulateLost(slide, n) adds n fake devices locally (offline stage fallback)', async () => {
    const before = host.lostCounts()[4] ?? 0
    host.simulateLost(4, 5)
    await waitFor(() => host.lostCounts()[4] === before + 5, 5000)
  })
})

// ---- S8 share link ----
const SHARE = src('p2p', 'share.js')
describe('S8 share link', { skip: pending(SHARE, 'S8 share link (aaron)') }, () => {
  const bundle = () => ({
    v: 1, moduleId: 'COMP26120', weekId: 'week-3', title: 'Week 3: Hash Tables', sharedBy: 'test',
    slides: slidesFixture().map(({ index, text }) => ({ index, text })),
    notes: [note(1, 1), note(2, 3, 'lecturer')], summary: 'Hash tables, collisions, load factor, resizing.',
    transcript: [{ id: 'c-1', slideIndex: 0, tStart: 0, tEnd: 6, text: 'Welcome back' }], exportedAt: 1_700_000_000_000
  })

  test('shareWeek → lecscribe://week/<z32>; importWeek pulls the same bundle with notes tagged shared', { timeout: NET * 2 }, async () => {
    const { shareWeek, importWeek } = await maybeImport(SHARE)
    const s = await shareWeek(bundle(), { storage: store() })
    try {
      const m = s.link.match(/^lecscribe:\/\/week\/(.+)$/)
      assert.ok(m && Z32.test(m[1]), s.link)
      assert.match(s.key, /^[0-9a-f]{64}$/)
      const got = await importWeek(s.link, { storage: store(), timeoutMs: NET })
      const want = bundle()
      assert.equal(got.moduleId, want.moduleId); assert.equal(got.weekId, want.weekId)
      assert.deepEqual(got.notes.map((n) => n.id), want.notes.map((n) => n.id))
      assert.ok(got.notes.every((n) => n.shared === true))
      assert.equal(got.summary, want.summary)
      assert.deepEqual(got.slides, want.slides)
    } finally { await s.stop() }
  })

  test('importWeek rejects a malformed link with BAD_LINK', async () => {
    const { importWeek } = await maybeImport(SHARE)
    await assert.rejects(importWeek('not a link', { storage: store(), timeoutMs: 2000 }), /BAD_LINK/)
  })

  test('importWeek fails with SHARE_TIMEOUT when no device holding the notes is online', { timeout: 30_000 }, async () => {
    const { shareWeek, importWeek } = await maybeImport(SHARE)
    const s = await shareWeek(bundle(), { storage: store() })
    const link = s.link
    await s.stop()
    await assert.rejects(importWeek(link, { storage: store(), timeoutMs: 5000 }), /SHARE_TIMEOUT/)
  })
})
