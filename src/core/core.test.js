// Unit tests for src/core (owner: filip). Run with `npm test`.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createBus } from './bus.js'
import { processSlides, normaliseText } from './slides.js'
import { loadPdf } from './pdf.js'

const deck = fileURLToPath(new URL('../../fixtures/deck.pdf', import.meta.url))

test('bus: emit reaches listeners and taps, listener errors do not break the bus', () => {
  const bus = createBus()
  const seen = []
  bus.on('x', () => { throw new Error('boom') })
  bus.on('x', (p) => seen.push(['on', p]))
  const off = bus.tap((n, p) => seen.push(['tap', n, p]))
  bus.emit('x', 1)
  off()
  bus.emit('x', 2)
  assert.deepEqual(seen, [['on', 1], ['tap', 'x', 1], ['on', 2]])
})

test('processSlides: OCR only for slides with < 20 chars and an image', async () => {
  const calls = []
  const ocr = async (img) => { calls.push(img); return '  Load   factor\n alpha = n / m ' }
  const out = await processSlides([
    { text: 'Hash functions map keys to indices', image: 'a.png' },
    { text: '', image: 'b.png' },
    { text: 'tiny', image: null }
  ], { ocr })
  assert.deepEqual(calls, ['b.png'])
  assert.equal(out.length, 3)
  assert.deepEqual(out.map((s) => s.index), [0, 1, 2])
  assert.equal(out[1].text, 'Load factor\nalpha = n / m')
  assert.equal(out[2].text, 'tiny')
})

test('processSlides: OCR failure keeps the slide', async () => {
  const out = await processSlides([{ text: '', image: 'x' }], { ocr: async () => { throw new Error('no model') } })
  assert.equal(out[0].text, '')
  assert.equal(out[0].image, 'x')
})

test('normaliseText collapses spaces and drops blank lines', () => {
  assert.equal(normaliseText('  a   b \n\n  c\t d  '), 'a b\nc d')
  assert.equal(normaliseText(undefined), '')
})

test('loadPdf(fixtures/deck.pdf) -> 5 slides with text (Node, no images)', { skip: !existsSync(deck) && 'fixtures/deck.pdf missing' }, async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const slides = await loadPdf(await readFile(deck), { pdfjs, renderImages: false })
  assert.equal(slides.length, 5)
  slides.forEach((s, i) => { assert.equal(s.index, i); assert.equal(s.image, null) })
  assert.match(slides[0].text, /Hash Tables/i)
  assert.ok(slides[3].text.length < 20, 'slide 4 is image-only (needs OCR)')
})
