// Note agent context (human request 17:2x): each slide's notes use the ENTIRE transcript of THAT slide,
// never other slides. Added by aaron with aryan's agent code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createSummariser } from './agents.js'
import { clipEnds } from './prompts.js'

const userText = (msgs) => msgs[msgs.length - 1].content

function setup (answer) {
  const bus = new EventEmitter()
  const prompts = []
  const complete = async (msgs) => { prompts.push(userText(msgs)); return typeof answer === 'function' ? answer(userText(msgs)) : answer }
  const agents = createSummariser({ bus, complete, opts: { minIntervalMs: 0, minNewChars: 1, minWords: 10 } })
  const notes = []
  const dropped = []
  bus.on('note:added', (n) => notes.push(n))
  bus.on('note:dropped', (d) => dropped.push(d))
  return { bus, prompts, agents, notes, dropped }
}
const chunk = (id, slideIndex, text) => ({ id, slideIndex, tStart: 0, tEnd: 5, text })

test('the note agent sees the WHOLE transcript of the current slide, including speech beyond 2500 chars', async () => {
  const { bus, prompts, agents } = setup('[]')
  bus.emit('slides:loaded', [{ index: 0, text: 'Intro' }, { index: 1, text: 'Hash functions' }])
  bus.emit('slide:changed', { index: 1, source: 'manual' })
  const filler = 'the lecturer keeps talking about how keys are spread across the buckets of the table '
  for (let i = 0; i < 60; i++) bus.emit('transcript:chunk', chunk(`c-${i}`, 1, `${filler} part ${i}.`))
  bus.emit('transcript:chunk', chunk('c-last', 1, 'Finally, the zebra quokka rule says always pick a prime table size.'))
  bus.emit('transcript:chunk', chunk('c-first-check', 1, 'and that is all for hash functions.'))
  await agents.flush()
  const last = prompts[prompts.length - 1]
  assert.ok(last.includes('zebra quokka rule'), 'newest speech on the slide reaches the prompt')
  assert.ok(last.includes('part 0.'), 'the start of the slide is kept too')
  assert.ok(last.length > 2600, 'more than the old 2500-char window')
})

test('the note agent never mixes in another slide\x27s transcript', async () => {
  const { bus, prompts, agents } = setup('[]')
  bus.emit('slides:loaded', [{ index: 0, text: 'Intro' }, { index: 1, text: 'Collisions' }])
  bus.emit('transcript:chunk', chunk('a1', 0, 'On the intro slide we talked about the platypus anecdote and the course logistics in detail.'))
  bus.emit('slide:changed', { index: 1, source: 'manual' })
  bus.emit('transcript:chunk', chunk('b1', 1, 'Collisions happen when two keys hash to one bucket, and chaining keeps a linked list per bucket.'))
  bus.emit('transcript:chunk', chunk('b2', 1, 'Open addressing instead probes for the next free slot, which is cache friendly.'))
  await agents.flush()
  const forSlide1 = prompts.filter((p) => p.includes('SLIDE TEXT:\nCollisions'))
  assert.ok(forSlide1.length > 0)
  for (const p of forSlide1) {
    assert.ok(!p.includes('platypus'), 'slide 0 speech must not appear in slide 1\x27s prompt')
    assert.ok(p.includes('cache friendly'))
  }
})

test('a note is not dropped as "generic" just because its words appear on OTHER slides', async () => {
  // "Resizing" words live on slide 2, but the note was said on slide 1: it must be kept.
  const { bus, notes, dropped, agents } = setup('["Resizing doubles the array when the load factor is too high"]')
  bus.emit('slides:loaded', [
    { index: 0, text: 'Intro' },
    { index: 1, text: 'Collisions' },
    { index: 2, text: 'Resizing\nDouble the array when the load factor is too high' }
  ])
  bus.emit('slide:changed', { index: 1, source: 'manual' })
  bus.emit('transcript:chunk', chunk('x1', 1, 'When there are too many collisions, resizing doubles the array once the load factor is too high, so plan for it.'))
  await agents.flush()
  assert.ok(!dropped.some((d) => d.reason === 'generic'), JSON.stringify(dropped))
  assert.equal(notes.length, 1)
  assert.equal(notes[0].slideIndex, 1)
  assert.deepEqual(notes[0].sourceChunkIds, ['x1'])
})

test('clipEnds keeps the start and the newest end of a long transcript', () => {
  const s = 'A'.repeat(5000) + 'NEWEST'
  const out = clipEnds(s, 1000)
  assert.ok(out.startsWith('A'))
  assert.ok(out.endsWith('NEWEST'))
  assert.ok(out.length <= 1010)
  assert.equal(clipEnds('short', 1000), 'short')
})
