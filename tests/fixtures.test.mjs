// Fixture sanity: the demo inputs everyone tests against are intact and consistent.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fx, ROOT, script, slidesFixture } from './helpers.mjs'
import { join } from 'node:path'

function wavInfo (path) {
  const b = readFileSync(path)
  assert.equal(b.toString('ascii', 0, 4), 'RIFF'); assert.equal(b.toString('ascii', 8, 12), 'WAVE')
  let o = 12; const info = {}
  while (o < b.length - 8) {
    const id = b.toString('ascii', o, o + 4); const size = b.readUInt32LE(o + 4)
    if (id === 'fmt ') Object.assign(info, { format: b.readUInt16LE(o + 8), channels: b.readUInt16LE(o + 10), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) })
    if (id === 'data') info.seconds = size / (info.rate * info.channels * (info.bits / 8))
    o += 8 + size + (size % 2)
  }
  return info
}

test('fixtures: deck.pdf is a 5-page PDF', () => {
  const pdf = readFileSync(fx('deck.pdf'))
  assert.equal(pdf.toString('ascii', 0, 5), '%PDF-')
  assert.equal(pdf.toString('latin1').match(/\/Type \/Page\b/g).length, 5)
})

test('fixtures: lecture.wav and explain.wav are 16 kHz mono 16-bit PCM', () => {
  for (const f of ['lecture.wav', 'explain.wav']) {
    const i = wavInfo(fx(f))
    assert.deepEqual([i.format, i.channels, i.rate, i.bits], [1, 1, 16000, 16], f)
  }
  assert.ok(Math.abs(wavInfo(fx('lecture.wav')).seconds - script().durationSec) < 0.1)
})

test('fixtures: slides.json matches the deck (5 slides, slide 4 image-only, images exist)', () => {
  const s = slidesFixture()
  assert.equal(s.length, 5)
  s.forEach((sl, i) => {
    assert.equal(sl.index, i)
    assert.ok(sl.text.length > 20)
    assert.ok(existsSync(join(ROOT, sl.image)), sl.image)
  })
  assert.deepEqual(s.map((x) => x.imageOnly), [false, false, false, true, false])
})

test('fixtures: script segments cover slides 0..4 in order, non-overlapping, with not-on-slide facts', () => {
  const sc = script()
  assert.equal(sc.moduleId, 'COMP26120'); assert.equal(sc.weekId, 'week-3')
  assert.deepEqual(sc.segments.map((s) => s.slideIndex), [0, 1, 2, 3, 4])
  for (let i = 1; i < sc.segments.length; i++) assert.ok(sc.segments[i].tStart >= sc.segments[i - 1].tEnd)
  for (const s of sc.segments) assert.ok(s.notOnSlide.length >= 2)
  assert.equal(sc.explain.slideIndex, 3)
})
