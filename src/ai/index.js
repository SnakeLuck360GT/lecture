// AI facade for LecScribe (S2 STT, S3 tracking + embed + OCR, S4 agents, S7 explain). Owner: aryan.
// Runs in Node / the Electron MAIN process. See coord/contracts/stage-2.md.
//
//   import { startAI } from './src/ai/index.js'
//   const ai = await startAI({ bus })        // bus: EventEmitter-like { on, off, emit }
//   ai.playClip('fixtures/lecture.wav')       // emits transcript:chunk, slide:changed(auto), note:added
import { config } from './config.js'
import { setStatusBus, sttModel, embedModel, llmModel, closeAll, isClosed, startMemoryLog } from './models.js'
import { transcribeAudio, playClip as sttPlayClip, createLiveStream, transcribeFile, slideVocab, onSttError } from './stt.js'
import { embed as realEmbed, cosine } from './embed.js'
import { createTracker } from './tracker.js'
import { createSummariser } from './agents.js'
import { createExplainer } from './explain.js'
import { complete as realComplete } from './llm.js'
import { ocr as realOcr } from './ocr.js'
import { lecturePrompt, explainThisPrompt } from './prompts.js'
import { newNoteId } from './agents.js'
import { searchEmbedder, transcriptPassages, hybridScore } from './search.js'
import { mockEmbed, mockTranscribe, mockComplete, readSidecar, sidecarTranscriber, liveScriptTranscriber } from './mock.js'

export { cosine }

/**
 * @param {object} o
 * @param {{on,off,emit}} o.bus
 * @param {boolean} [o.mock]      no models (also env LECSCRIBE_AI_MOCK=1)
 * @param {boolean} [o.preload]   load STT/embed/LLM now (default true when not mocked)
 */
export async function startAI ({ bus, mock = config.mock, preload = !mock, agentOpts = {} } = {}) {
  if (!bus) throw new Error('startAI needs a bus')
  setStatusBus(bus)
  if (!mock && !process.env.LECSCRIBE_TEST) startMemoryLog(bus)
  onSttError((e) => bus.emit('stt:error', e))
  const embed = mock ? mockEmbed : realEmbed
  const transcribe = mock ? mockTranscribe : transcribeAudio
  const complete = mock ? mockComplete : realComplete

  let slides = []
  let current = 0
  const onSlides = (s) => { slides = s || []; current = 0 }
  const onChanged = (ev) => { if (typeof ev?.index === 'number') current = ev.index }
  bus.on('slides:loaded', onSlides)
  bus.on('slide:changed', onChanged)

  const trackOpts = mock && !process.env.LECSCRIBE_TRACK_THRESHOLD ? { threshold: config.tracker.mockThreshold } : {}
  const tracker = createTracker({ bus, embedMany: (t) => embed(t), embedOne: (t) => embed(t), opts: trackOpts })
  const agents = createSummariser({ bus, complete, opts: agentOpts })
  const explainer = createExplainer({ bus, getSlides: () => slides, transcribe, complete })
  // H-6: keep the transcript so far (bounded) for "Explain this"
  const said = [] // TranscriptChunk[]
  const onFinal = (c) => { said.push(c); if (said.length > 600) said.splice(0, said.length - 600) }
  bus.on('transcript:chunk', onFinal)
  const emitChunk = (c) => bus.emit('transcript:chunk', c)
  const explaining = new Set()
  async function explainThis (slideIndex) {
    const i = Number(slideIndex)
    if (!Number.isInteger(i) || i < 0 || (slides.length && i >= slides.length)) throw new Error('bad slideIndex')
    if (explaining.has(i)) return null // one at a time per slide
    explaining.add(i)
    const st = (state, extra = {}) => bus.emit('explain:status', { slideIndex: i, state, kind: 'explain', ...extra })
    try {
      st('summarising')
      const outline = slides.map((s, k) => `${k + 1}. ${String(s.text || '').replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')
      const onSlide = said.filter((c) => c.slideIndex === i)
      const text = String(await complete(explainThisPrompt({
        slideIndex: i,
        slideText: slides[i]?.text || '',
        outline,
        said: onSlide.map((c) => c.text).join(' '),
        recent: said.slice(-8).map((c) => c.text).join(' ')
      }))).trim()
      if (!text) { st('error', { error: 'empty explanation' }); return null }
      const note = { id: newNoteId(), slideIndex: i, kind: 'explain', text, sourceChunkIds: onSlide.slice(-20).map((c) => c.id), createdAt: Date.now() }
      bus.emit('note:added', note)
      st('done', { noteId: note.id })
      return note
    } catch (e) {
      st('error', { error: String(e?.message || e) })
      throw e
    } finally { explaining.delete(i) }
  }
  // Host answers requests from its own UI and forwarded peer requests (aaron re-emits them with
  // forwarded: true). A peer's un-forwarded request is ignored here so it is never answered twice.
  const onExplainRequest = (ev) => {
    if (!ev || typeof ev.slideIndex !== 'number') return
    if (ev.from === 'peer' && !ev.forwarded) return
    explainThis(ev.slideIndex).catch((e) => console.error('[ai] explainThis failed', e?.message || e))
  }
  bus.on('explain:request', onExplainRequest)
  // Mock live mic: map stream time onto a script fixture (LECSCRIBE_MOCK_SCRIPT, default fixtures/lecture.script.json).
  const liveTx = mock ? await liveScriptTranscriber(process.env.LECSCRIBE_MOCK_SCRIPT || 'fixtures/lecture.script.json') : transcribe
  const getVocab = () => slideVocab(slides[current]?.text, slides[current + 1]?.text)
  // B-011: quick (fast-model) text drives the tracker; the accurate final is filed to the slide the
  // tracker chose for that chunk (assign), even if it arrives after the slide changed.
  const assign = new Map() // chunkId -> slideIndex
  const num = (id) => Number(String(id).replace(/\D/g, '')) || 0
  bus.on('slide:changed', (ev) => {
    if (ev?.source !== 'auto' || !ev.chunkId) return
    const n = num(ev.chunkId)
    for (const id of assign.keys()) if (num(id) >= n) assign.set(id, ev.index)
  })
  const live = createLiveStream({
    onChunk: emitChunk,
    getSlideIndex: () => current,
    getSlideIndexFor: (id) => { const v = assign.has(id) ? assign.get(id) : current; assign.delete(id); return v },
    onQuick: (c) => { assign.set(c.id, c.slideIndex); bus.emit('transcript:quick', c) },
    transcribe: liveTx,
    getVocab,
    onPartial: (p) => bus.emit('transcript:partial', p)
  })

  let ready = Promise.resolve()
  if (preload) {
    // Load in the BACKGROUND (first run downloads models) so the facade is usable at once;
    // every method awaits its own model lazily. Sequential so the first model is ready quickly.
    ready = (async () => {
      for (const f of [() => sttModel('partial'), () => sttModel('final'), embedModel, llmModel]) {
        if (isClosed()) return // B-014: stop preloading after close()
        try { await f() } catch (e) { if (!isClosed()) console.error('[ai] preload failed', e?.message || e) }
      }
    })()
  } else if (mock) {
    for (const m of ['stt', 'embed', 'llm']) bus.emit('ai:status', { model: m, state: 'ready', mock: true })
  }

  let clip = null
  return {
    mock,
    /** Resolves when STT, embedding and LLM models are loaded (or failed). */
    ready: () => ready,
    /** S2 demo path: stream a recorded 16 kHz WAV as transcript chunks (paced to wall clock). */
    async playClip (wavPath, { realtime = true } = {}) {
      clip?.stop()
      let tx = transcribe
      if (mock) {
        const side = await readSidecar(wavPath)
        if (side) tx = sidecarTranscriber(side)
      }
      const c = sttPlayClip({ wavPath, onChunk: emitChunk, getSlideIndex: () => current, realtime, transcribe: tx, getVocab })
      clip = c
      try {
        await c.done
        await tracker.idle()
        await agents.flush()
        bus.emit('clip:ended', { wavPath })
      } catch (e) {
        console.error('[ai] clip failed', e)
        bus.emit('ai:status', { model: 'stt', state: 'error', error: String(e?.message || e) })
      }
    },
    stopClip () { clip?.stop(); clip = null },
    /** Auto-follow toggle: false = the tracker never auto-advances (manual prev/next only). */
    setAutoFollow (on) {
      const v = tracker.setAutoFollow(on)
      bus.emit('ai:autofollow', { on: v })
      return v
    },
    getAutoFollow () { return tracker.autoFollow() },
    /** S2 live mic: Float32Array 16 kHz mono PCM from the renderer. */
    pushAudio (f32) { live.push(toF32(f32)) },
    /** S2 live mic: transcribe whatever is buffered (call on "Stop listening"). Resolves when done. */
    async flushAudio () { await live.flush(); await tracker.idle(); await agents.flush() },
    /** S7: audio for the active Explain recording. */
    pushExplainAudio (f32) { explainer.push(toF32(f32)) },
    /** S7 demo path: pre-recorded explanation clip. */
    explainFromFile (slideIndex, wavPath) { return explainer.fromFile(slideIndex, wavPath) },
    /** H-6: "Explain this" -> Promise<Note|null> (kind 'explain'), also emitted as note:added. */
    explainThis,
    embed,
    cosine,
    /** Search (src/library): embed a query / documents with the model's retrieval prefixes. */
    embedQuery: (q) => searchEmbedder(embed).query(q),
    embedDocs: (texts, titles) => searchEmbedder(embed).docs(texts, titles),
    transcriptPassages,
    hybridScore,
    async ocr (image) { return mock ? '' : realOcr(image) },
    transcribeFile: mock ? null : transcribeFile,
    async summariseLecture (chunks, slidesArg = slides) {
      const outline = (slidesArg || []).map((s, i) => `${i + 1}. ${String(s.text || '').split('\n')[0].slice(0, 80)}`).join('\n')
      const transcript = (chunks || []).map((c) => c.text).join(' ')
      // H-4: a summary needs something to summarise
      if ((transcript.match(/\S+/g) || []).length < config.agents.minLectureWords) return 'Not enough of the lecture has been transcribed yet to write a summary.'
      return complete(lecturePrompt({ outline, transcript }))
    },
    /** Wait until tracker, agents and explainer queues are drained (tests). */
    async idle () { await tracker.idle(); await agents.idle(); await explainer.idle() },
    /** Fast (<= ~1.5 s) even while models are still downloading (B-014). */
    async close () {
      clip?.stop()
      bus.off('slides:loaded', onSlides)
      bus.off('transcript:chunk', onFinal)
      bus.off('explain:request', onExplainRequest)
      bus.off('slide:changed', onChanged)
      tracker.dispose(); agents.dispose(); explainer.dispose()
      if (!mock) await closeAll()
    }
  }
}

function toF32 (x) {
  if (x instanceof Float32Array) return x
  if (Array.isArray(x)) return Float32Array.from(x)
  if (x?.buffer) return new Float32Array(x.buffer, x.byteOffset || 0, Math.floor((x.byteLength || 0) / 4))
  return new Float32Array(0)
}
