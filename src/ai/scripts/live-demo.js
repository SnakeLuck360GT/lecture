// S2 live-path demo: stream a WAV through ai.pushAudio() in mic-sized frames (simulates the renderer mic).
// Usage: node src/ai/scripts/live-demo.js [fixtures/slides.json] [fixtures/lecture.wav] [--mock] [--fast]
//   --fast  push frames as fast as possible (default: real time, 100 ms frames)
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { startAI } from '../index.js'
import { loadWav16k } from '../wav.js'

const args = process.argv.slice(2)
const pos = args.filter((a) => !a.startsWith('--'))
const slides = JSON.parse(await readFile(pos[0] || 'fixtures/slides.json', 'utf8'))
const samples = await loadWav16k(pos[1] || 'fixtures/lecture.wav')
const mock = args.includes('--mock') || process.env.LECSCRIBE_AI_MOCK === '1'
const fast = args.includes('--fast')

const bus = new EventEmitter()
const t0 = Date.now()
const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's'
bus.on('ai:status', (s) => { if (s.state !== 'loading' || s.progress % 25 === 0) console.log(ts(), '[status]', s.model, s.state, s.progress ?? '', s.error ?? '') })
bus.on('transcript:chunk', (c) => console.log(ts(), `[chunk ${c.id}] slide=${c.slideIndex} ${c.tStart}-${c.tEnd}s (lag ${((Date.now() - t0) / 1000 - c.tEnd).toFixed(1)}s): ${c.text.slice(0, 80)}`))
let partials = 0; let firstPartialLag = null
bus.on('transcript:partial', (p) => { partials++; const lag = (Date.now() - t0) / 1000 - p.tEnd; if (firstPartialLag === null) firstPartialLag = lag; if (args.includes('--partials')) console.log(ts(), `  ~ partial ${p.tStart}-${p.tEnd}s: ${p.text.slice(0, 70)}`) })
bus.on('slide:changed', (e) => console.log(ts(), `>>> slide ${e.index} (${e.source}, conf ${e.confidence?.toFixed?.(2)})`))
bus.on('note:dropped', (n) => console.log(ts(), `  [dropped ${n.reason} s${n.slideIndex}] ${n.text}`))
bus.on('note:added', (n) => console.log(ts(), `  [note ${n.kind} s${n.slideIndex}] ${n.text}`))

const ai = await startAI({ bus, mock })
bus.emit('slides:loaded', slides)
const FRAME = 1600 // 100 ms
const start = Date.now()
for (let off = 0; off < samples.length; off += FRAME) {
  ai.pushAudio(samples.subarray(off, off + FRAME))
  if (!fast) {
    const wait = start + ((off + FRAME) / 16000) * 1000 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  }
}
await ai.flushAudio()
await ai.idle()
await ai.close()
console.log(ts(), `done. partials: ${partials}${firstPartialLag !== null ? `, first partial lag ${firstPartialLag.toFixed(2)}s` : ''}`)
