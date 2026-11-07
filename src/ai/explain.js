// S7 (AI half): Explain slide → transcribe the dedicated recording → plain-language summary
// → 'note:added' (kind 'lecturer'). Owner: aryan.
import { explainPrompt } from './prompts.js'
import { newNoteId } from './agents.js'

/**
 * @param {object} o
 * @param {{on,off,emit}} o.bus
 * @param {()=>Array} o.getSlides
 * @param {(audio:Float32Array|string)=>Promise<string>} o.transcribe
 * @param {(messages)=>Promise<string>} o.complete
 */
export function createExplainer ({ bus, getSlides, transcribe, complete }) {
  let rec = null // { slideIndex, parts: Float32Array[], file?: string }
  let queue = Promise.resolve()
  const st = (slideIndex, state, extra = {}) => bus.emit('explain:status', { slideIndex, state, ...extra })

  const start = ({ slideIndex } = {}) => {
    if (rec) finish()
    rec = { slideIndex, parts: [], file: null }
    st(slideIndex, 'recording')
  }

  const MAX_SAMPLES = 16000 * 300 // H-3: cap an Explain recording at 5 min
  const push = (f32) => {
    if (!rec) return
    rec.n = (rec.n || 0) + f32.length
    if (rec.n <= MAX_SAMPLES) rec.parts.push(f32)
  }

  const finish = () => {
    if (!rec) return queue
    const r = rec
    rec = null
    queue = queue.then(() => run(r))
    return queue
  }

  const run = async ({ slideIndex, parts, file }) => {
    try {
      let audio = file
      if (!audio) {
        const n = parts.reduce((a, p) => a + p.length, 0)
        if (n < 16000 * 0.5) { st(slideIndex, 'error', { error: 'recording too short' }); return }
        audio = new Float32Array(n)
        let off = 0
        for (const p of parts) { audio.set(p, off); off += p.length }
      }
      st(slideIndex, 'transcribing')
      const transcript = await transcribe(audio)
      if (!transcript) { st(slideIndex, 'error', { error: 'no speech heard' }); return }
      st(slideIndex, 'summarising', { transcript })
      const slideText = getSlides()[slideIndex]?.text || ''
      const text = String(await complete(explainPrompt({ slideText, transcript }))).trim()
      const note = { id: newNoteId(), slideIndex, kind: 'lecturer', text: text || transcript, sourceChunkIds: [], createdAt: Date.now(), transcript }
      bus.emit('note:added', note)
      st(slideIndex, 'done', { noteId: note.id })
      return note
    } catch (e) {
      console.error('[ai/explain] failed', e)
      st(slideIndex, 'error', { error: String(e?.message || e) })
    }
  }

  const onStart = (ev) => start(ev)
  const onDone = (ev) => { if (rec && (!ev || ev.slideIndex === undefined || ev.slideIndex === rec.slideIndex)) finish() }
  const onChanged = (ev) => { if (rec && ev && ev.index !== rec.slideIndex) finish() }
  bus.on('explain:start', onStart)
  bus.on('explain:done', onDone)
  bus.on('slide:changed', onChanged)

  return {
    push,
    /** Demo path: use a pre-recorded explanation clip instead of the mic. */
    async fromFile (slideIndex, wavPath) {
      if (rec) finish()
      st(slideIndex, 'recording')
      queue = queue.then(() => run({ slideIndex, parts: [], file: wavPath }))
      return queue
    },
    idle: () => queue,
    dispose () {
      bus.off('explain:start', onStart)
      bus.off('explain:done', onDone)
      bus.off('slide:changed', onChanged)
    }
  }
}
