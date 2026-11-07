#!/usr/bin/env node
// S6 manual test (owner: aaron). Uses the PUBLIC Hyperswarm DHT, so use it to test two devices / venue Wi-Fi / hotspot.
//   node src/p2p/scripts/room-demo.js host          -> prints a link, loads fixtures/slides.json, advances a slide + adds a note every 5 s
//   node src/p2p/scripts/room-demo.js join <link>   -> prints everything that arrives from the host
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRoom, joinRoom } from '../index.js'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const [mode, key] = process.argv.slice(2)
const bus = new EventEmitter()
const log = (name) => bus.on(name, (p) => console.log(new Date().toISOString().slice(11, 19), name, summarize(p)))
const summarize = (p) => {
  if (Array.isArray(p)) return `[${p.length} slides] ` + p.map((s) => `#${s.index} ${(s.text || '').split('\n')[0]}${s.image ? ' (img ' + Math.round(s.image.length / 1024) + 'KB)' : ''}`).join(' | ')
  return JSON.stringify(p)
}

if (mode === 'host') {
  for (const e of ['p2p:status', 'p2p:peers', 'lost:counts']) log(e)
  const room = await createRoom({ bus, title: 'Week 3: Hash Tables', moduleId: 'COMP26120', weekId: 'w3', baseDir: ROOT })
  console.log('\nROOM LINK:', room.link, '\n(hex key:', room.key + ')\n')
  const slides = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'slides.json'), 'utf8'))
  bus.emit('slides:loaded', slides)
  let i = 0
  setInterval(() => {
    i = (i + 1) % slides.length
    bus.emit('slide:changed', { index: i, source: 'auto' })
    bus.emit('note:added', { id: `demo-${Date.now()}`, slideIndex: i, kind: 'ai', text: `Demo note for slide ${i}`, sourceChunkIds: [], createdAt: Date.now() })
    console.log('host: slide ->', i)
  }, 5000)
  process.on('SIGINT', async () => { await room.close(); process.exit(0) })
} else if (mode === 'join' && key) {
  for (const e of ['p2p:status', 'room:info', 'slides:loaded', 'slide:changed', 'note:added', 'lost:counts', 'room:ended']) log(e)
  const t0 = Date.now()
  bus.once('slides:loaded', () => console.log(`>>> slides arrived ${((Date.now() - t0) / 1000).toFixed(1)} s after join`))
  const peer = await joinRoom({ bus, key })
  process.on('SIGINT', async () => { await peer.close(); process.exit(0) })
} else {
  console.error('usage: room-demo.js host | room-demo.js join <link>')
  process.exit(2)
}
