// Contract tests for aryan's AI stages (S2, S3, S4, S7-AI), from coord/contracts/stage-{2,3,4,7-ai}.md v1.
// Default: mock mode (fast, any OS). LECSCRIBE_REAL=1: real QVAC models (macOS demo host only).
// PENDING (skipped) until src/ai/index.js is merged into dev.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { src, fx, REAL, pending, maybeImport, recordingBus, waitFor, slidesFixture, script, checkChunk, checkNote } from './../helpers.mjs'

const AI = src('ai', 'index.js')
const skip = pending(AI, 'S2 AI facade (aryan)')
const MOCK = !REAL
const T_CLIP = REAL ? 240_000 : 120_000

describe('S2 facade: startAI({ bus, mock })', { skip }, () => {
  let ai, bus
  before(async () => {
    const { startAI } = await maybeImport(AI)
    bus = recordingBus()
    ai = await startAI({ bus, mock: MOCK })
  })
  after(async () => { await ai?.close?.() })

  test('exposes the contract API', () => {
    for (const fn of ['playClip', 'stopClip', 'pushAudio', 'embed', 'ocr', 'summariseLecture', 'close']) {
      assert.equal(typeof ai[fn], 'function', `ai.${fn} missing`)
    }
  })

  test('ai:status events have the contract shape', () => {
    for (const s of bus.events('ai:status')) {
      assert.ok(['stt', 'embed', 'llm', 'ocr'].includes(s.model), `model ${s.model}`)
      assert.ok(['loading', 'ready', 'error'].includes(s.state), `state ${s.state}`)
    }
  })

  test('S3 embed(): string -> number[], string[] -> number[][] with equal dims', async () => {
    const v = await ai.embed('hash tables')
    assert.ok(Array.isArray(v) && v.length > 0 && v.every(Number.isFinite))
    const vs = await ai.embed(['collisions', 'load factor'])
    assert.equal(vs.length, 2)
    assert.equal(vs[0].length, v.length); assert.equal(vs[1].length, v.length)
  })

  test('S3 embed(): deterministic for the same text', async () => {
    const [a, b] = [await ai.embed('rehash every key'), await ai.embed('rehash every key')]
    a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) < 1e-4))
  })

  test('S2 playClip(lecture.wav) emits well-formed transcript:chunk events, in time order', { timeout: T_CLIP }, async () => {
    bus.emit('slides:loaded', slidesFixture())
    ai.playClip(fx('lecture.wav'), { realtime: false })
    // Contract: chunks of ~6 s; a 92 s clip should give several chunks.
    await waitFor(() => bus.events('transcript:chunk').length >= 5 && bus.events('transcript:chunk').at(-1).tEnd > script().durationSec - 15, T_CLIP - 5000, 200)
    const chunks = bus.events('transcript:chunk')
    for (const c of chunks) assert.deepEqual(checkChunk(c), [], JSON.stringify(c))
    for (let i = 1; i < chunks.length; i++) assert.ok(chunks[i].tStart >= chunks[i - 1].tStart, 'chunks out of order')
    assert.equal(new Set(chunks.map((c) => c.id)).size, chunks.length, 'duplicate chunk ids')
    ai.stopClip()
  })

  test('S3 tracker: auto slide:changed events carry source auto + confidence, never move backwards', () => {
    const autos = bus.events('slide:changed').filter((e) => e.source === 'auto')
    let prev = 0
    for (const e of autos) {
      assert.ok(Number.isInteger(e.index) && e.index >= 0 && e.index < 5)
      assert.ok(typeof e.confidence === 'number' && e.confidence >= 0 && e.confidence <= 1)
      assert.ok(e.index >= prev, `auto went backwards ${prev} -> ${e.index}`)
      prev = e.index
    }
  })

  test('S4 note:added events (kind ai) have the Note shape', { timeout: T_CLIP }, async () => {
    // Agents fire when a slide is left; force it by moving manually to the last slide.
    bus.emit('slide:changed', { index: 4, source: 'manual' })
    await waitFor(() => bus.events('note:added').some((n) => n.kind === 'ai'), T_CLIP - 5000, 200)
    for (const n of bus.events('note:added').filter((n) => n.kind === 'ai')) assert.deepEqual(checkNote(n, 'ai'), [], JSON.stringify(n))
  })

  test('S7 explainFromFile(3, explain.wav) pins a lecturer note to slide 3', { timeout: T_CLIP, skip: false }, async (t) => {
    if (typeof ai.explainFromFile !== 'function') return t.skip('PENDING: ai.explainFromFile not implemented yet')
    const before = bus.events('note:added').length
    await ai.explainFromFile(3, fx('explain.wav'))
    const n = await waitFor(() => bus.events('note:added').slice(before).find((x) => x.kind === 'lecturer'), T_CLIP - 5000, 200)
    assert.deepEqual(checkNote(n, 'lecturer'), [])
    assert.equal(n.slideIndex, 3)
    const states = bus.events('explain:status').map((s) => s.state)
    assert.ok(states.includes('done') || states.length === 0, `explain:status ${states}`)
  })
})

describe('S3 tracker: manual override wins (mock-safe)', { skip }, () => {
  test('after a manual slide:changed, no auto change for manualHoldMs', { timeout: 30_000 }, async () => {
    const { startAI } = await maybeImport(AI)
    const bus = recordingBus()
    const ai = await startAI({ bus, mock: MOCK })
    try {
      bus.emit('slides:loaded', slidesFixture())
      bus.emit('slide:changed', { index: 2, source: 'manual' })
      const mark = bus.log.length
      // Feed chunks that talk about slide 5 (resizing); the tracker must hold for manualHoldMs (default 10 s).
      const seg = script().segments[4]
      for (let i = 0; i < 3; i++) bus.emit('transcript:chunk', { id: `c-${900 + i}`, slideIndex: 2, tStart: i * 6, tEnd: i * 6 + 6, text: seg.text })
      await new Promise((r) => setTimeout(r, 1500))
      const autos = bus.log.slice(mark).filter((e) => e.name === 'slide:changed' && e.payload.source === 'auto')
      assert.deepEqual(autos, [], 'tracker auto-advanced during manual hold')
    } finally { await ai.close() }
  })
})

// --- Demo-quality gates (real models on the macOS host only) ---
describe('REAL: demo quality on fixtures (LECSCRIBE_REAL=1, macOS host)', { skip: skip || (!REAL && 'set LECSCRIBE_REAL=1 on the demo host') }, () => {
  test('tracking follows the lecture 0→1→2→3→4 and lands on the right slide ≥ 80% of chunks', { timeout: 600_000 }, async () => {
    const { startAI } = await maybeImport(AI)
    const bus = recordingBus()
    const ai = await startAI({ bus, mock: false })
    try {
      bus.emit('slides:loaded', slidesFixture())
      ai.playClip(fx('lecture.wav'), { realtime: false })
      const dur = script().durationSec
      await waitFor(() => bus.events('transcript:chunk').at(-1)?.tEnd > dur - 8, 540_000, 500)
      await new Promise((r) => setTimeout(r, 3000))
      const seq = bus.events('slide:changed').filter((e) => e.source === 'auto').map((e) => e.index)
      assert.deepEqual(seq, [1, 2, 3, 4], `auto sequence was ${JSON.stringify(seq)}`)
      // Per-chunk accuracy: the slide in effect right AFTER the tracker processed each chunk
      // (= latest slide:changed before the next chunk) vs the script segment at the chunk's end time.
      const segs = script().segments
      const truth = (t) => (segs.find((s) => t >= s.tStart - 1.2 && t <= s.tEnd + 1.2) ?? segs.at(-1)).slideIndex
      let cur = 0; let last = null; let ok = 0; let n = 0
      const score = () => { if (last) { n++; if (cur === truth(last.tEnd)) ok++ } }
      for (const e of bus.log) {
        if (e.name === 'slide:changed') cur = e.payload.index
        if (e.name === 'transcript:chunk') { score(); last = e.payload }
      }
      score()
      console.log(`tracking accuracy ${ok}/${n}`)
      assert.ok(ok / n >= 0.8, `tracking accuracy ${ok}/${n}`)
    } finally { await ai.close() }
  })
})

// --- S2 LIVE MIC path (primary demo path since broadcast #3) ---
// Streams fixtures/lecture.wav through ai.pushAudio() in 250 ms Float32 frames, as the renderer mic helper would.
// Mock: frames pushed fast. REAL: frames pushed at real-time pace, measuring speech→chunk latency.
function wavToF32 (path) {
  const b = readFileSync(path)
  let o = 12; let data = null
  while (o < b.length - 8) { const id = b.toString('ascii', o, o + 4); const size = b.readUInt32LE(o + 4); if (id === 'data') data = b.subarray(o + 8, o + 8 + size); o += 8 + size + (size % 2) }
  const f = new Float32Array(data.length / 2)
  for (let i = 0; i < f.length; i++) f[i] = data.readInt16LE(i * 2) / 32768
  return f
}

describe('S2 live mic: pushAudio() streaming', { skip }, () => {
  test('streamed lecture → transcript chunks covering the talk, auto slide changes, then flushAudio() resolves', { timeout: REAL ? 600_000 : 60_000 }, async () => {
    const { startAI } = await maybeImport(AI)
    const bus = recordingBus()
    const ai = await startAI({ bus, mock: MOCK })
    try {
      assert.equal(typeof ai.pushAudio, 'function')
      bus.emit('slides:loaded', slidesFixture())
      const pcm = wavToF32(fx('lecture.wav'))
      const FRAME = 4000 // 250 ms @ 16 kHz
      const t0 = Date.now()
      const pushedAt = [] // wall-clock time when audio second s was pushed
      for (let i = 0; i < pcm.length; i += FRAME) {
        ai.pushAudio(pcm.slice(i, i + FRAME))
        pushedAt[Math.floor((i + FRAME) / 16000)] ??= Date.now() // first time this audio second was fully pushed
        if (REAL) await new Promise((r) => setTimeout(r, Math.max(0, t0 + ((i + FRAME) / 16) - Date.now())))
      }
      if (typeof ai.flushAudio === 'function') await ai.flushAudio()
      await waitFor(() => bus.events('transcript:chunk').length >= 3, 30_000, 200)
      const chunks = bus.events('transcript:chunk')
      for (const c of chunks) assert.deepEqual(checkChunk(c), [], JSON.stringify(c))
      assert.ok(chunks.at(-1).tEnd > script().durationSec - 15, `last chunk ends at ${chunks.at(-1).tEnd}s of ${script().durationSec}s`)
      if (REAL) {
        const words = chunks.map((c) => c.text).join(' ').toLowerCase()
        for (const w of ['hash', 'collision', 'load factor', 'resiz']) assert.ok(words.includes(w), `transcript missing "${w}"`)
        const seq = bus.events('slide:changed').filter((e) => e.source === 'auto').map((e) => e.index)
        console.log(`live: ${chunks.length} chunks, auto slides ${JSON.stringify(seq)}`)
        assert.deepEqual(seq, [1, 2, 3, 4], `live auto sequence ${JSON.stringify(seq)}`)
        // latency: chunk emitted vs when its last audio second was pushed
        const lat = bus.log.filter((e) => e.name === 'transcript:chunk').map((e) => e.t - (pushedAt[Math.max(1, Math.floor(e.payload.tEnd))] ?? e.t))
        lat.sort((a, b) => a - b)
        const p50 = lat[Math.floor(lat.length / 2)]; const p90 = lat[Math.floor(lat.length * 0.9)]
        console.log(`live STT latency p50=${p50}ms p90=${p90}ms`)
        assert.ok(p90 < 8000, `p90 speech→chunk latency ${p90}ms ≥ 8 s`)
      }
    } finally { await ai.close() }
  })
})
