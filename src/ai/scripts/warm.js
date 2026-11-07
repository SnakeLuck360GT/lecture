// Pre-download + smoke-test every QVAC model LecScribe uses, so the demo runs fully offline.
// Usage: npm run ai:warm   (run once on the demo host WITH internet, before switching it off)
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'
import { sttModel, embedModel, llmModel, ocrModel, setStatusBus, closeAll } from '../models.js'
import { config } from '../config.js'
import { transcribeAudio } from '../stt.js'
import { embed } from '../embed.js'
import { complete } from '../llm.js'
import { ocr } from '../ocr.js'

const bus = new EventEmitter()
const last = {}
bus.on('ai:status', (s) => {
  if (s.state === 'loading') {
    const step = Math.floor((s.progress ?? 0) / 10)
    if (last[s.model] === step) return
    last[s.model] = step
  }
  console.log(`[${s.model}] ${s.state}${s.progress != null ? ' ' + s.progress + '%' : ''}${s.error ? ' ' + s.error : ''}`)
})
setStatusBus(bus)

console.log('models:', config.models)
let ok = true
const step = async (name, fn) => {
  const t = Date.now()
  try { const r = await fn(); console.log(`✔ ${name} (${Date.now() - t} ms)`, r ?? '') } catch (e) { ok = false; console.error(`✖ ${name}:`, e?.message || e) }
}

await step(`load stt partial (${config.models.sttPartial})`, () => sttModel('partial'))
await step(`load stt final (${config.models.stt})`, () => sttModel('final'))
await step('load embed', embedModel)
await step('load llm', llmModel)
await step('load ocr', ocrModel)
if (existsSync('fixtures/explain.wav')) await step('transcribe fixtures/explain.wav', async () => (await transcribeAudio('fixtures/explain.wav')).slice(0, 100))
await step('embed', async () => `dim ${(await embed('hash tables and load factor')).length}`)
await step('llm', async () => (await complete([{ role: 'user', content: 'Reply with the single word: ready /no_think' }])).slice(0, 40))
if (existsSync('fixtures/slides/slide-4.png')) await step('ocr fixtures/slides/slide-4.png', async () => (await ocr('fixtures/slides/slide-4.png')).slice(0, 100))

await closeAll()
console.log(ok ? '\nAll models cached. You can go offline.' : '\nSome steps failed (see above).')
process.exit(ok ? 0 : 1)
