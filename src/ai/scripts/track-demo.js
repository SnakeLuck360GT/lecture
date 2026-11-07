// S3 demo: run the AI pipeline on a slides.json + WAV and print chunk → slide decisions and notes.
// Usage: node src/ai/scripts/track-demo.js [fixtures/slides.json] [fixtures/lecture.wav] [--mock] [--realtime]
// Mock mode reads fixtures/lecture.script.json for the transcript, so it runs without models.
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { startAI } from '../index.js'

const args = process.argv.slice(2)
const pos = args.filter((a) => !a.startsWith('--'))
const slidesPath = pos[0] || 'fixtures/slides.json'
const wavPath = pos[1] || 'fixtures/lecture.wav'
const mock = args.includes('--mock') || process.env.LECSCRIBE_AI_MOCK === '1'

const slides = JSON.parse(await readFile(slidesPath, 'utf8'))
const bus = new EventEmitter()
const t0 = Date.now()
const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's'
bus.on('ai:status', (s) => { if (s.state !== 'loading' || s.progress % 25 === 0) console.log(ts(), '[status]', s.model, s.state, s.progress ?? '', s.error ?? '') })
bus.on('transcript:chunk', (c) => console.log(ts(), `[chunk ${c.id}] slide=${c.slideIndex} ${c.tStart}-${c.tEnd}s: ${c.text.slice(0, 90)}`))
bus.on('tracker:scores', (s) => console.log(ts(), '   scores', Object.entries(s.scores).map(([k, v]) => `${k}:${v.toFixed(2)}`).join(' ')))
bus.on('slide:changed', (e) => console.log(ts(), `>>> slide ${e.index} (${e.source}, conf ${e.confidence?.toFixed?.(2)})`))
bus.on('note:added', (n) => console.log(ts(), `  [note ${n.kind} s${n.slideIndex}] ${n.text}`))

const ai = await startAI({ bus, mock })
bus.emit('slides:loaded', slides)
await ai.playClip(wavPath, { realtime: args.includes('--realtime') })
await ai.idle()
await ai.close()
console.log(ts(), 'done')
