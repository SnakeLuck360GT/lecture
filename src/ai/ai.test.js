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
