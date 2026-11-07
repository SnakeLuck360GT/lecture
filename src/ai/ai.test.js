// Unit tests for src/ai (mock backends only; no models needed). Run: node --test src/ai/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseWav, encodeWav, resample } from './wav.js'
import { windows, cleanText } from './stt.js'
import { decide, createTracker } from './tracker.js'
import { parseNotes, stripThinking } from './llm.js'
import { isOnSlide, createSummariser } from './agents.js'
import { createExplainer } from './explain.js'
import { mockEmbed, mockComplete } from './mock.js'
import { cosine } from './embed.js'
import { blocksToText } from './ocr.js'
import { startAI } from './index.js'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))

test('wav encode/parse round-trip and resample', () => {
  const s = new Float32Array(1600).map((_, i) => Math.sin(i / 10) * 0.5)
  const back = parseWav(encodeWav(s, 16000))
  assert.equal(back.sampleRate, 16000)
  assert.equal(back.samples.length, 1600)
  assert.ok(Math.abs(back.samples[100] - s[100]) < 1e-3)
  assert.equal(resample(s, 32000, 16000).length, 800)
})

test('stt windows + cleanText', () => {
  const w = windows(new Float32Array(16000 * 13), 6)
  assert.deepEqual(w.map((x) => [x.tStart, x.tEnd]), [[0, 6], [6, 12], [12, 13]])
  assert.equal(cleanText(' hello [BLANK_AUDIO]  world '), 'hello world')
})

test('tracker.decide: only forward, needs threshold and margin', () => {
  assert.equal(decide({ scores: { 0: 0.5, 1: 0.7 }, current: 0, threshold: 0.55, margin: 0.04 }).index, 1)
  assert.equal(decide({ scores: { 0: 0.68, 1: 0.7 }, current: 0, threshold: 0.55, margin: 0.04 }), null)
  assert.equal(decide({ scores: { 0: 0.1, 1: 0.5 }, current: 0, threshold: 0.55, margin: 0.04 }), null)
  assert.equal(decide({ scores: { 2: 0.3, 3: 0.9 }, current: 2, threshold: 0.55, margin: 0.04 }).index, 3)
})

const SLIDES = [
  { index: 0, text: 'Introduction to sorting algorithms' },
  { index: 1, text: 'Bubble sort: swap adjacent elements repeatedly' },
  { index: 2, text: 'Merge sort: divide and conquer, merge halves' }
]

test('tracker advances on matching speech, manual override holds', async () => {
  const bus = new EventEmitter()
  const tr = createTracker({ bus, embedMany: mockEmbed, embedOne: mockEmbed, opts: { threshold: 0.3, margin: 0.04, manualHoldMs: 50 } })
  const changes = []
  bus.on('slide:changed', (e) => changes.push(e))
  bus.emit('slides:loaded', SLIDES)
  bus.emit('transcript:chunk', { id: 'c1', slideIndex: 0, text: 'bubble sort swaps adjacent elements again and again' })
  await tr.idle()
  assert.equal(tr.current(), 1)
  assert.equal(changes.at(-1).source, 'auto')
  bus.emit('slide:changed', { index: 0, source: 'manual' })
  bus.emit('transcript:chunk', { id: 'c2', slideIndex: 0, text: 'merge sort divide and conquer merge the halves' })
  await tr.idle()
  assert.equal(tr.current(), 0, 'manual hold blocks auto')
  await tick(60)
  bus.emit('transcript:chunk', { id: 'c3', slideIndex: 0, text: 'merge sort divide and conquer merge the halves' })
  await tr.idle()
  assert.equal(tr.current(), 2)
  tr.dispose()
})

test('parseNotes handles JSON, think blocks, bullets, none', () => {
  assert.deepEqual(parseNotes('<think>hmm</think>["Stable sort keeps equal order", "Worst case is n squared"]'), ['Stable sort keeps equal order', 'Worst case is n squared'])
  assert.deepEqual(parseNotes('- first useful point here\n- second useful point'), ['first useful point here', 'second useful point'])
  assert.deepEqual(parseNotes('[]'), [])
  assert.equal(stripThinking('<think>x</think> ok'), 'ok')
})

test('isOnSlide filters copies of slide text', () => {
  assert.equal(isOnSlide('Bubble sort swap adjacent elements', SLIDES[1].text), true)
  assert.equal(isOnSlide('This will come up in the exam, know the worst case', SLIDES[1].text), false)
})

test('summariser emits ai notes when a slide is left', async () => {
  const bus = new EventEmitter()
  const sum = createSummariser({ bus, complete: async () => '["The lecturer said this comes up in the exam"]' })
  const notes = []
  bus.on('note:added', (n) => notes.push(n))
  bus.emit('slides:loaded', SLIDES)
  bus.emit('transcript:chunk', { id: 'c1', slideIndex: 0, text: 'remember this comes up in the exam every year' })
  bus.emit('slide:changed', { index: 1, source: 'auto' })
  await sum.idle()
  assert.equal(notes.length, 1)
  assert.equal(notes[0].kind, 'ai')
  assert.equal(notes[0].slideIndex, 0)
  assert.deepEqual(notes[0].sourceChunkIds, ['c1'])
  sum.dispose()
})

test('explainer: start/push/done → lecturer note', async () => {
  const bus = new EventEmitter()
  const ex = createExplainer({ bus, getSlides: () => SLIDES, transcribe: async () => 'think of it like sorting cards in your hand', complete: async () => 'It is like sorting playing cards.' })
  const notes = []
  bus.on('note:added', (n) => notes.push(n))
  bus.emit('explain:start', { slideIndex: 1 })
  ex.push(new Float32Array(16000))
  bus.emit('explain:done', { slideIndex: 1 })
  await ex.idle()
  assert.equal(notes.length, 1)
  assert.equal(notes[0].kind, 'lecturer')
  assert.equal(notes[0].slideIndex, 1)
  ex.dispose()
})

test('ocr blocksToText orders top-to-bottom, left-to-right', () => {
  assert.equal(blocksToText([{ text: 'b', bbox: [50, 0, 0, 0] }, { text: 'a', bbox: [0, 0, 0, 0] }, { text: 'c', bbox: [0, 40, 0, 0] }]), 'a b c')
})

test('mockComplete returns JSON for sticky prompts', async () => {
  const out = await mockComplete([{ role: 'user', content: 'WHAT THE LECTURER SAID:\nThis is a long enough sentence for a note. Another long sentence for the note list.\n\nWrite up to 3 new notes as a JSON array of strings.' }])
  assert.ok(Array.isArray(JSON.parse(out)))
})

test('startAI mock e2e: clip → chunks → auto slide → notes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lecscribe-test-'))
  const wav = join(dir, 'clip.wav')
  await writeFile(wav, encodeWav(new Float32Array(16000 * 18), 16000))
  await writeFile(join(dir, 'clip.transcript.json'), JSON.stringify([
    { tStart: 0, tEnd: 5, text: 'Welcome. Today is an introduction to sorting algorithms and why sorting matters.' },
    { tStart: 6, tEnd: 11, text: 'Bubble sort swaps adjacent elements repeatedly. It is slow but this comes up in the exam.' },
    { tStart: 12, tEnd: 17, text: 'Merge sort uses divide and conquer and merges halves. Think of splitting a deck of cards.' }
  ]))
  const bus = new EventEmitter()
  const ai = await startAI({ bus, mock: true })
  const ev = { chunks: [], changes: [], notes: [] }
  bus.on('transcript:chunk', (c) => ev.chunks.push(c))
  bus.on('slide:changed', (c) => ev.changes.push(c))
  bus.on('note:added', (n) => ev.notes.push(n))
  bus.emit('slides:loaded', SLIDES)
  await ai.playClip(wav, { realtime: false })
  await ai.idle()
  assert.equal(ev.chunks.length, 3)
  assert.ok(ev.changes.some((c) => c.source === 'auto' && c.index === 2), 'reached last slide automatically')
  assert.ok(ev.notes.length >= 1, 'produced notes')
  assert.ok(ev.notes.every((n) => n.kind === 'ai' && typeof n.slideIndex === 'number'))
  assert.equal((await ai.embed(['a', 'b'])).length, 2)
  await ai.close()
})

test('live stream: VAD cuts at pauses, drops silence, passes stream times', async () => {
  const { createLiveStream } = await import('./stt.js')
  const SR = 16000
  const tone = (sec) => Float32Array.from({ length: sec * SR }, (_, i) => Math.sin(i / 5) * 0.2)
  const sil = (sec) => new Float32Array(sec * SR)
  const audio = [sil(1), tone(3), sil(1), tone(2.5), sil(2)]
  const calls = []
  const chunks = []
  const live = createLiveStream({ onChunk: (c) => chunks.push(c), getSlideIndex: () => 7, transcribe: async (a, o) => { calls.push(o); return `seg ${calls.length}` } })
  for (const part of audio) for (let i = 0; i < part.length; i += 1600) live.push(part.subarray(i, i + 1600))
  await live.flush()
  assert.equal(chunks.length, 2)
  assert.ok(Math.abs(chunks[0].tStart - 1) < 0.1, 'leading silence skipped')
  assert.ok(chunks.every((c) => c.slideIndex === 7))
  assert.ok(calls.every((o) => typeof o.tStart === 'number' && o.tEnd > o.tStart))
})

test('agents move the chunk that triggered an auto-advance to the new slide', async () => {
  const bus = new EventEmitter()
  const seen = []
  const sum = createSummariser({ bus, complete: async (m) => { seen.push(m.at(-1).content); return '[]' } })
  bus.emit('slides:loaded', SLIDES)
  bus.emit('transcript:chunk', { id: 'c1', slideIndex: 0, text: 'intro words about sorting' })
  bus.emit('transcript:chunk', { id: 'c2', slideIndex: 0, text: 'bubble sort swaps neighbours' })
  bus.emit('slide:changed', { index: 1, source: 'auto', chunkId: 'c2' })
  bus.emit('slide:changed', { index: 2, source: 'auto' })
  await sum.idle()
  assert.ok(!seen[0].includes('bubble'), 'slide 0 agent did not get the trigger chunk')
  assert.ok(seen[1].includes('bubble'), 'slide 1 agent got it')
  sum.dispose()
})

test('B-001: finalText reads contentText / raw.fullText of the real CompletionFinal shape', async () => {
  const { finalText } = await import('./llm.js')
  const raw = '<think>\n\n</think>\n\n```json\n["Choose m prime to spread keys", "Java resizes at 0.75"]\n```'
  const real = { contentText: '```json\n["Choose m prime to spread keys", "Java resizes at 0.75"]\n```', toolCalls: [], stats: {}, raw: { fullText: raw }, cacheableAssistantContent: '' }
  assert.deepEqual(parseNotes(finalText(real)), ['Choose m prime to spread keys', 'Java resizes at 0.75'])
  assert.deepEqual(parseNotes(finalText({ contentText: '', raw: { fullText: raw } })), ['Choose m prime to spread keys', 'Java resizes at 0.75'])
  assert.equal(finalText('plain'), 'plain')
  assert.equal(finalText({}), '')
})

test('B-002: tracker advances on the FIRST chunk of a new topic even with old text in the window', async () => {
  const bus = new EventEmitter()
  const tr = createTracker({ bus, embedMany: mockEmbed, embedOne: mockEmbed, opts: { threshold: 0.2, margin: 0.05 } })
  bus.emit('slides:loaded', SLIDES)
  bus.emit('transcript:chunk', { id: 'a', slideIndex: 0, text: 'introduction today sorting algorithms overview' })
  await tr.idle()
  assert.equal(tr.current(), 0)
  bus.emit('transcript:chunk', { id: 'b', slideIndex: 0, text: 'bubble sort swap adjacent elements repeatedly' })
  await tr.idle()
  assert.equal(tr.current(), 1, 'advanced on first bubble-sort chunk')
  tr.dispose()
})

test('B-005: filters keep every notOnSlide fact and drop slide paraphrases (fixtures)', async () => {
  const { readFile } = await import('node:fs/promises')
  const { grounding, tidyNote } = await import('./agents.js')
  const fx = (f) => new URL(`../../fixtures/${f}`, import.meta.url)
  const slides = JSON.parse(await readFile(fx('slides.json'), 'utf8'))
  const script = JSON.parse(await readFile(fx('lecture.script.json'), 'utf8'))
  for (const seg of script.segments) {
    const st = slides[seg.slideIndex].text
    for (const f of seg.notOnSlide) {
      assert.equal(isOnSlide(f, st), false, `kept on slide ${seg.slideIndex}: ${f}`)
      assert.ok(grounding(f, seg.text, st) >= 0.45, `grounded: ${f}`)
    }
  }
  const copies = [[2, 'Separate chaining uses a list per bucket'], [2, 'Open addressing requires probing for free slots'],
    [4, 'Resizing doubles the array when the load factor is too high'], [4, 'Resizing requires rehashing every key']]
  for (const [i, c] of copies) assert.equal(isOnSlide(c, slides[i].text), true, `dropped: ${c}`)
  assert.equal(tidyNote('The lecturer explained that linear probing is cache friendly'), 'Linear probing is cache friendly')
})

test('search: passages merge chunks per slide; hybrid ranks the right passage first (mock embed)', async () => {
  const { transcriptPassages, hybridScore, searchEmbedder } = await import('./search.js')
  const { readFile } = await import('node:fs/promises')
  const script = JSON.parse(await readFile(new URL('../../fixtures/lecture.script.json', import.meta.url), 'utf8'))
  // simulate ~5 s live chunks from the script
  const chunks = []
  let n = 0
  for (const seg of script.segments) {
    const w = seg.text.split(' ')
    for (let i = 0; i < w.length; i += 12) chunks.push({ id: `c${++n}`, slideIndex: seg.slideIndex, tStart: seg.tStart + i / 3, tEnd: seg.tStart + (i + 12) / 3, text: w.slice(i, i + 12).join(' ') })
  }
  const ps = transcriptPassages(chunks)
  assert.ok(ps.length >= 5 && ps.length < chunks.length)
  assert.ok(ps.every((p) => p.chunkIds.length >= 1 && p.tEnd - p.tStart <= 30.5))
  const se = searchEmbedder(mockEmbed)
  const vecs = await se.docs(ps.map((p) => p.text))
  const ask = async (q) => {
    const qv = await se.query(q)
    return ps.map((p, i) => ({ p, s: hybridScore({ cosine: cosine(qv, vecs[i]), query: q, text: p.text, kind: 'transcript' }) }))
      .sort((a, b) => b.s - a.s)[0].p.slideIndex
  }
  assert.equal(await ask('at what load factor alpha does the HashMap resize'), 3)
  assert.equal(await ask('why choose a prime table size'), 1)
  assert.equal(await ask('what is primary clustering'), 2)
  assert.equal(await ask('what is in Thursday lab'), 4)
})

test('B-006: live partials stream while speaking, stop after the final, never queue up', async () => {
  const { createLiveStream } = await import('./stt.js')
  const SR = 16000
  let clock = 0
  const events = []
  let busy = 0; let maxBusy = 0
  const transcribe = async (a, o) => {
    busy++; maxBusy = Math.max(maxBusy, busy)
    await tick(1)
    busy--
    return `${o.partial ? 'partial' : 'final'} ${(a.length / SR).toFixed(1)}`
  }
  const live = createLiveStream({
    transcribe, getSlideIndex: () => 0, now: () => clock, partialMs: 500,
    onChunk: (c) => events.push({ type: 'final', ...c }),
    onPartial: (p) => events.push({ type: 'partial', ...p })
  })
  const tone = Float32Array.from({ length: 3 * SR }, (_, i) => Math.sin(i / 5) * 0.2)
  const sil = new Float32Array(SR)
  for (const part of [tone, sil]) {
    for (let i = 0; i < part.length; i += 1600) { live.push(part.subarray(i, i + 1600)); clock += 100; await tick(2) }
  }
  await live.flush()
  await tick(5)
  const partials = events.filter((e) => e.type === 'partial')
  const finalIdx = events.findIndex((e) => e.type === 'final')
  assert.ok(partials.length >= 3, `got ${partials.length} partials`)
  assert.ok(finalIdx > 0 && events.slice(0, finalIdx).every((e) => e.type === 'partial'), 'partials come before the final')
  assert.ok(events.slice(finalIdx + 1).every((e) => e.type !== 'partial'), 'no stale partial after the final')
  assert.ok(partials[0].tEnd - partials[0].tStart <= 1.2, 'first partial within ~1 s of speech')
  assert.ok(maxBusy <= 2, 'at most one partial + one final in flight')
})

test('B-005: auto-advance re-files the chunk BEFORE the trigger when it already matched the new slide', async () => {
  const bus = new EventEmitter()
  const tr = createTracker({ bus, embedMany: mockEmbed, embedOne: mockEmbed, opts: { threshold: 0.6, margin: 0.05 } })
  const changes = []
  bus.on('slide:changed', (e) => changes.push(e))
  bus.emit('slides:loaded', SLIDES)
  bus.emit('transcript:chunk', { id: 'a', slideIndex: 0, text: 'introduction to sorting algorithms today' })
  bus.emit('transcript:chunk', { id: 'b', slideIndex: 0, text: 'now bubble sort' })
  bus.emit('transcript:chunk', { id: 'c', slideIndex: 0, text: 'bubble sort swap adjacent elements repeatedly' })
  await tr.idle()
  assert.equal(changes.at(-1)?.index, 1)
  assert.equal(changes.at(-1)?.chunkId, 'b', 'topic changed at chunk b')
  tr.dispose()
})

test('B-007: serialSTT never runs two STT calls at once and survives a failing call', async () => {
  const { serialSTT, sttBusy, promptOpts } = await import('./stt.js')
  let inFlight = 0; let max = 0
  const job = (ms, fail) => serialSTT(async () => {
    inFlight++; max = Math.max(max, inFlight)
    await tick(ms)
    inFlight--
    if (fail) throw new Error('Model was reloaded')
    return ms
  })
  const res = await Promise.allSettled([job(5), job(1, true), job(3), job(2)])
  assert.equal(max, 1)
  assert.deepEqual(res.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
  assert.equal(sttBusy(), false)
  assert.deepEqual(promptOpts('Hash, Tables', 'previous tail text'), { prompt: 'Hash, Tables' }, 'prompt is vocabulary only (stable)')
})

test('B-005: synonym paraphrase of a slide bullet is dropped (Mac run 14:07)', () => {
  assert.equal(isOnSlide('Allocate array twice the size when load factor is too high', SLIDE4), true)
  assert.equal(isOnSlide('Every key must be reinserted because its index depends on m', SLIDE4), false)
  assert.equal(isOnSlide("Thursday's lab implements resizing", SLIDE4), false)
})
const SLIDE4 = 'Resizing\nDouble the array when the load factor is too high\nRehash every key\nInsert is amortised O(1)'

test('B-008: final and partial STT queues are independent (partials not blocked by a slow final)', async () => {
  const { serialSTT, sttBusy } = await import('./stt.js')
  const order = []
  const slowFinal = serialSTT(async () => { await tick(30); order.push('final') }, 'final')
  const partial = serialSTT(async () => { await tick(1); order.push('partial') }, 'partial')
  assert.equal(sttBusy('final'), true)
  await Promise.all([slowFinal, partial])
  assert.deepEqual(order, ['partial', 'final'])
  assert.equal(sttBusy('partial'), false)
})

test('B-005: generic notes and amortised/constant near-copies are dropped; real facts survive (Mac run 14:22)', async () => {
  const { readFile } = await import('node:fs/promises')
  const { isGeneric } = await import('./agents.js')
  const fx = (f) => new URL(`../../fixtures/${f}`, import.meta.url)
  const slides = JSON.parse(await readFile(fx('slides.json'), 'utf8'))
  const script = JSON.parse(await readFile(fx('lecture.script.json'), 'utf8'))
  const deck = slides.map((s) => s.text).join('\n')
  assert.equal(isGeneric('Open addressing used in hash maps', deck), true)
  assert.equal(isOnSlide('Amortized cost of resizing is constant', SLIDE4), true)
  for (const seg of script.segments) for (const f of seg.notOnSlide) assert.equal(isGeneric(f, deck), false, `not generic: ${f}`)
})

test('stretch: exam-emphasis flag on notes the lecturer flagged (fixtures slide 0)', async () => {
  const { examEmphasis } = await import('./emphasis.js')
  const { readFile } = await import('node:fs/promises')
  const script = JSON.parse(await readFile(new URL('../../fixtures/lecture.script.json', import.meta.url), 'utf8'))
  const s0 = script.segments[0].text
  assert.equal(examEmphasis('The load factor will come up in the exam', s0), 'exam')
  assert.equal(examEmphasis('Pay close attention to the load factor part', s0), 'exam')
  assert.equal(examEmphasis("Hash tables are what Python dictionaries and Java's HashMap use", s0), null)
  assert.equal(examEmphasis('Linear probing is cache friendly', script.segments[2].text), null)
  // end-to-end through the summariser
  const bus = new EventEmitter()
  const sum = createSummariser({ bus, complete: async () => '["The load factor will come up in the exam", "Python dictionaries use hash tables"]' })
  const notes = []
  bus.on('note:added', (n) => notes.push(n))
  bus.emit('slides:loaded', [{ index: 0, text: 'Hash Tables' }, { index: 1, text: 'x' }])
  bus.emit('transcript:chunk', { id: 'c1', slideIndex: 0, text: s0 })
  bus.emit('slide:changed', { index: 1, source: 'auto' })
  await sum.idle()
  assert.equal(notes.find((n) => /exam/.test(n.text))?.emphasis, 'exam')
  assert.equal(notes.find((n) => /Python/.test(n.text))?.emphasis, undefined)
  sum.dispose()
})

test('B-011: quick text per segment (same id as its final), slow finals stay <= 1 segment behind, slide filing', async () => {
  const { createLiveStream } = await import('./stt.js')
  const SR = 16000
  const quicks = []
  const finals = []
  const live = createLiveStream({
    getSlideIndex: () => 0,
    getSlideIndexFor: (id) => (id === quicks[1]?.id ? 9 : 0), // pretend the tracker re-filed the 2nd chunk
    // quick = fast (1 ms); final = slow (300 ms, slower than real time in this test)
    transcribe: async (a, o) => { await tick(o.quick || o.partial ? 1 : 300); return `${o.quick ? 'quick' : 'final'} ${o.tStart.toFixed(1)}` },
    onQuick: (c) => quicks.push(c),
    onChunk: (c) => finals.push(c)
  })
  const tone = (sec) => Float32Array.from({ length: Math.round(sec * SR) }, (_, i) => Math.sin(i / 5) * 0.2)
  const sil = (sec) => new Float32Array(Math.round(sec * SR))
  // 5 utterances of 2.2 s separated by 0.6 s pauses, pushed fast (finals cannot keep up)
  for (let k = 0; k < 5; k++) {
    for (const part of [tone(2.2), sil(0.6)]) for (let i = 0; i < part.length; i += 1600) live.push(part.subarray(i, i + 1600))
    await tick(5)
  }
  assert.equal(quicks.length, 5, 'one quick text per segment, emitted promptly')
  await live.flush()
  await tick(20)
  assert.equal(finals.length, 5, 'every segment finalised')
  assert.deepEqual(finals.map((f) => f.id), quicks.map((q) => q.id), 'finals keep the quick chunk ids, in order')
  assert.ok(finals.some((f) => f.quality === 'fast'), 'older segments fell back to quick text when behind')
  assert.ok(finals.some((f) => /^final/.test(f.text)), 'newest segments still get the accurate model')
  assert.equal(finals[1].slideIndex, 9, 'final filed to the slide chosen for its chunk')
})

test('B-011: tracker scores a chunk once (quick), ignores its later final', async () => {
  const bus = new EventEmitter()
  let scored = 0
  const tr = createTracker({ bus, embedMany: mockEmbed, embedOne: async (t) => { scored++; return mockEmbed(t) }, opts: { threshold: 0.3 } })
  bus.emit('slides:loaded', SLIDES)
  bus.emit('transcript:quick', { id: 'q1', slideIndex: 0, text: 'bubble sort swaps adjacent elements' })
  await tr.idle()
  assert.equal(tr.current(), 1)
  bus.emit('transcript:chunk', { id: 'q1', slideIndex: 0, text: 'bubble sort swaps adjacent elements repeatedly' })
  await tr.idle()
  assert.equal(scored, 1)
  tr.dispose()
})

test('B-005: genuine on-topic note is not dropped by a short title line (Mac run 14:32)', async () => {
  const { readFile } = await import('node:fs/promises')
  const slides = JSON.parse(await readFile(new URL('../../fixtures/slides.json', import.meta.url), 'utf8'))
  assert.equal(isOnSlide("Hash tables are used in Python and Java's dictionaries", slides[0].text), false)
  assert.equal(isOnSlide('Resizing requires rehashing every key', slides[4].text), true, 'still drops 3-word line paraphrase')
})

test('B-005: STT vocab puts spoken forms of slide shorthand first (mod -> modulus, α -> alpha)', async () => {
  const { slideVocab, promptOpts } = await import('./stt.js')
  const v = slideVocab('Hash functions\nh(k) = k mod m', 'Load factor\nα = n / m\nLookup is O(1) on average')
  assert.ok(v.startsWith('modulus'), v)
  assert.ok(v.includes('alpha') && v.includes('constant time'))
  assert.ok(promptOpts(v).prompt.includes('modulus'))
  assert.ok(!slideVocab('A modern model').includes('modulus'), 'whole-word match only')
})

test('B-005: a slide left with no note keeps its best soft-dropped candidate (>= 1 note per slide)', async () => {
  const bus = new EventEmitter()
  const deck = [{ index: 0, text: 'Hash Tables\nHashing, collisions, load factor, resizing' }, { index: 1, text: 'Hash functions\nMap a key to an array index' }]
  // generic: every word is already somewhere in the deck
  const sum = createSummariser({ bus, complete: async () => '["Hashing maps a key to an index"]' })
  const notes = []
  bus.on('note:added', (n) => notes.push(n))
  bus.emit('slides:loaded', deck)
  bus.emit('transcript:chunk', { id: 'c1', slideIndex: 0, text: 'so hashing maps a key to an index in the table' })
  bus.emit('slide:changed', { index: 1, source: 'auto' })
  await sum.idle()
  assert.equal(notes.filter((n) => n.slideIndex === 0).length, 1)
  sum.dispose()
})

test('B-005: rephrased duplicates are caught, distinct facts on the same slide are not', async () => {
  const { similar } = await import('./agents.js')
  assert.equal(similar('Choose the table size m to be prime', 'Pick a prime table size'), true)
  assert.equal(similar('Choose the table size m to be prime', 'If m is a power of two, only the lowest bits of the key are used'), false)
  assert.equal(similar('Linear probing is cache friendly', 'Linear probing suffers from primary clustering'), false)
})

test('auto-follow off: tracker keeps scoring but never auto-advances; on again resumes', async () => {
  const bus = new EventEmitter()
  const ai = await startAI({ bus, mock: true })
  const changes = []; let scores = 0
  bus.on('slide:changed', (e) => { if (e.source === 'auto') changes.push(e) })
  bus.on('tracker:scores', () => scores++)
  bus.emit('slides:loaded', SLIDES)
  assert.equal(ai.setAutoFollow(false), false)
  assert.equal(ai.getAutoFollow(), false)
  bus.emit('transcript:chunk', { id: 'x1', slideIndex: 0, text: 'bubble sort swap adjacent elements repeatedly' })
  await ai.idle()
  assert.equal(changes.length, 0)
  assert.equal(scores, 1)
  ai.setAutoFollow(true)
  bus.emit('transcript:chunk', { id: 'x2', slideIndex: 0, text: 'bubble sort swap adjacent elements repeatedly' })
  await ai.idle()
  assert.equal(changes.length, 1)
  await ai.close()
})
