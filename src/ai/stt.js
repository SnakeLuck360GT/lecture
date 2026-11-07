// S2: speech-to-text via QVAC (whisper). Owner: aryan.
// Demo path: a recorded clip is cut into fixed windows, each window is transcribed ahead of
// playback, and its chunk is emitted when playback reaches the window end (realtime pacing).
import { sdk, sttModel } from './models.js'
import { config } from './config.js'
import { loadWav16k, writeTempWav, removeTemp } from './wav.js'
import { noteSdkError } from './models.js'
import { serial, busy } from './serial.js'

const SR = 16000

// B-007: the whisper worker RELOADS the model when the prompt changes, which aborts any request in
// flight ("RPCError: Model was reloaded"). So every STT call goes through ONE serial lock, and a
// failed call is retried once.
// B-008: one queue PER MODEL (turbo finals / base partials), so a 2.5 s final never blocks partials.
// (queues live in serial.js and are shared with embed / llm / ocr, B-016)
export const sttBusy = (key = 'final') => busy('stt-' + key)
export function serialSTT (fn, key = 'final') { return serial('stt-' + key, fn) }
let errorSink = null
export function onSttError (fn) { errorSink = fn }

/** Transcribe one audio source (path to a WAV, or Float32Array 16 kHz mono) → plain text. */
export async function transcribeAudio (audio, { prompt, partial } = {}) {
  const q = await sdk()
  const kind = partial ? 'partial' : 'final'
  const modelId = await sttModel(kind)
  const temp = typeof audio !== 'string'
  const audioChunk = temp ? await writeTempWav(audio, SR) : audio
  // same model for both kinds -> same queue (B-007 guarantee)
  const key = partial && config.models.sttPartial !== config.models.stt ? 'partial' : 'final'
  const once = async () => {
    const id = await sttModel(kind) // re-resolve: the model may have been reloaded after a worker crash
    return serialSTT(() => q.transcribe({ modelId: id, audioChunk, ...(prompt ? { prompt } : {}) }), key)
  }
  void modelId
  let text
  try {
    try {
      text = await once()
    } catch (e) {
      noteSdkError(e) // H-3: a crashed worker is re-initialised on the next call
      errorSink?.({ error: String(e?.message || e), partial: !!partial, retried: !partial })
      if (partial) throw e // partials are disposable
      text = await once() // finals: retry once
    }
  } finally {
    if (temp) removeTemp(audioChunk) // H-3: partials alone wrote 2 files/s and never deleted them
  }
  return cleanText(typeof text === 'string' ? text : (text || []).map((s) => s.text).join(' '))
}

export function cleanText (t) {
  return String(t || '')
    .replace(/\[(BLANK_AUDIO|MUSIC|NOISE|SILENCE)[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Split samples into windows of chunkSec seconds. → [{ tStart, tEnd, samples }] */
export function windows (samples, chunkSec = config.stt.chunkSec) {
  const step = Math.round(chunkSec * SR)
  const out = []
  for (let s = 0; s < samples.length; s += step) {
    const e = Math.min(samples.length, s + step)
    if (e - s < SR * 0.3) break // drop a tail shorter than 0.3 s
    out.push({ tStart: s / SR, tEnd: e / SR, samples: samples.subarray(s, e) })
  }
  return out
}

/**
 * B-005: whisper's prompt biases decoding towards its words, so we feed the vocabulary of the
 * current + next slide (e.g. "HashMap", "modulus").
 * B-007: the prompt is the slide vocabulary ONLY (no previous-chunk tail), so it changes only on a
 * slide change and the worker rarely has to reload. `prev` is accepted but ignored.
 */
export function promptOpts (vocab, prev) { // eslint-disable-line no-unused-vars
  const p = String(vocab || '').slice(0, 240).trim()
  return p ? { prompt: p } : {}
}

/** Distinct, informative words of slide text, for the STT prompt. */
// Slides use shorthand the lecturer SAYS in full: put the spoken form first in the prompt
// (Mac run 14:44: "k mod m" was spoken "modulus" and heard as "Majulis").
const SPOKEN = {
  mod: 'modulus', '%': 'modulo', 'α': 'alpha', 'β': 'beta', 'λ': 'lambda', 'θ': 'theta', 'Σ': 'sum',
  'O(1)': 'constant time', 'O(n)': 'linear time', 'O(log': 'logarithmic', 'avg': 'average',
  'e.g.': 'for example', 'i.e.': 'that is', 'approx': 'approximately', 'w.r.t.': 'with respect to'
}

export function slideVocab (...texts) {
  const seen = new Set(); const spoken = []; const out = []
  const add = (list, w) => { const k = w.toLowerCase(); if (!seen.has(k)) { seen.add(k); list.push(w) } }
  for (const t of texts) {
    const str = String(t || '')
    for (const [short, full] of Object.entries(SPOKEN)) {
      const re = /^[a-z]+$/i.test(short) ? new RegExp(`\\b${short}\\b`, 'i') : null
      if (re ? re.test(str) : str.includes(short)) add(spoken, full)
    }
    for (const w of str.split(/[\s,;:()\[\]•\-–]+/)) {
      const k = w.toLowerCase().replace(/[^a-z0-9'.]/g, '')
      if (k.length < 3 || seen.has(k)) continue
      add(out, w.replace(/[.]+$/, ''))
    }
  }
  return [...spoken, ...out].join(', ')
}

let chunkN = 0
export const newChunkId = () => `c-${++chunkN}`
export function makeChunk ({ tStart, tEnd, text, slideIndex, id }) {
  return { id: id || newChunkId(), slideIndex, tStart: round2(tStart), tEnd: round2(tEnd), text }
}
const round2 = (x) => Math.round(x * 100) / 100

/** Transcribe a whole WAV file into TranscriptChunk[] (slideIndex = 0). */
export async function transcribeFile (wavPath, { chunkSec } = {}) {
  const samples = await loadWav16k(wavPath)
  const out = []
  let prev = ''
  for (const w of windows(samples, chunkSec)) {
    const text = await transcribeAudio(w.samples, prev ? { prompt: prev.slice(-200) } : {})
    if (text) out.push(makeChunk({ ...w, text, slideIndex: 0 }))
    prev = text || prev
  }
  return out
}

/**
 * Stream a clip as 'transcript:chunk' events.
 * @param {object} o
 * @param {string} o.wavPath
 * @param {(chunk)=>void} o.onChunk
 * @param {()=>number} o.getSlideIndex
 * @param {boolean} [o.realtime=true]  pace emission to wall clock (sync with UI audio playback)
 * @param {(audio, opts)=>Promise<string>} [o.transcribe]  injectable for tests/mock
 * @returns {{ stop(): void, done: Promise<void> }}
 */
export function playClip ({ wavPath, onChunk, getSlideIndex, realtime = true, transcribe = transcribeAudio, chunkSec, getVocab = () => '' }) {
  let stopped = false
  const t0 = Date.now()
  const done = (async () => {
    const samples = await loadWav16k(wavPath)
    let prev = ''
    for (const w of windows(samples, chunkSec)) {
      if (stopped) return
      const text = await transcribe(w.samples, promptOpts(getVocab(), prev))
      if (stopped) return
      if (realtime) {
        const wait = t0 + w.tEnd * 1000 - Date.now()
        if (wait > 0) await sleep(wait, () => stopped)
        if (stopped) return
      }
      if (text) {
        onChunk(makeChunk({ ...w, text, slideIndex: getSlideIndex() }))
        prev = text
      }
    }
  })()
  return { stop () { stopped = true }, done }
}

/**
 * Live mic (PRIMARY demo path): energy-VAD segmenter over pushed Float32 16 kHz mono PCM.
 * Cuts a segment at a pause (>= silenceMs) once it is >= minSec long, or hard-cuts at maxSec.
 * Silent segments are dropped.
 * B-011: every segment first gets a QUICK text from the fast model (onQuick, drives the tracker so
 * slides advance ~as soon as the words are spoken), then the accurate FINAL (onChunk, same chunk id,
 * drives notes/transcript/library). If the final model falls more than one segment behind, the
 * older segments are finalised with their quick text (quality: 'fast') so lag stays bounded.
 * B-006: while a segment is still open, the growing audio is re-transcribed every partialMs and
 * reported through onPartial({ text, tStart, tEnd }) so words show up < 1 s after being spoken.
 * Partials use the fast partial model on its own queue (B-008), so they keep flowing while a
 * slower, accurate final is transcribed. A partial is skipped while another partial is running
 * (no queue build-up), and a partial that resolves after its segment's final is dropped.
 */
export function createLiveStream ({
  onChunk, getSlideIndex, transcribe = transcribeAudio,
  getVocab = () => '',
  minSec = config.stt.liveMinSec, maxSec = config.stt.liveMaxSec, silenceMs = config.stt.liveSilenceMs,
  onQuick = null, getSlideIndexFor = null,
  onPartial = null, partialMs = config.stt.livePartialMs, now = () => Date.now()
}) {
  const slideFor = (id) => (getSlideIndexFor ? getSlideIndexFor(id) : getSlideIndex())
  const FRAME = 480 // 30 ms
  const frames = [] // current segment's frames (Float32Array each)
  let frameBuf = new Float32Array(0)
  let segStart = 0 // stream time (s) of the current segment start
  let t = 0 // stream time (s) consumed so far
  let speechFrames = 0
  let silentRun = 0
  let noise = 0.003 // adaptive noise floor (RMS)
  const backlog = [] // segments waiting for transcription
  let running = null
  let prev = ''
  let segN = 0 // id of the currently open segment
  let lastFinalSeg = -1 // highest segment id whose final chunk has been emitted
  let partialRunning = false
  let lastPartialAt = 0

  const isSpeech = (rms) => rms > Math.max(0.008, noise * 3)

  const cut = () => {
    if (!frames.length) return
    const n = frames.length * FRAME
    const audio = new Float32Array(n)
    frames.forEach((f, i) => audio.set(f, i * FRAME))
    const seg = { id: segN++, tStart: segStart, tEnd: segStart + n / SR, audio, speech: speechFrames, quick: null, quickP: null }
    frames.length = 0; speechFrames = 0; silentRun = 0; segStart = t
    if (seg.speech * FRAME / SR < 0.4) { lastFinalSeg = Math.max(lastFinalSeg, seg.id); return } // basically silence
    seg.chunkId = newChunkId()
    if (onQuick) {
      seg.quickP = transcribe(audio, { ...promptOpts(getVocab(), prev), tStart: seg.tStart, tEnd: seg.tEnd, partial: true, quick: true })
        .then((text) => {
          seg.quick = text || ''
          if (text) onQuick({ id: seg.chunkId, slideIndex: getSlideIndex(), tStart: round2(seg.tStart), tEnd: round2(seg.tEnd), text })
        })
        .catch((e) => { seg.quick = ''; console.error('[ai/stt] quick failed', e?.message || e) })
    }
    backlog.push(seg)
    pump()
  }

  const emitFinal = (s, text, quality) => {
    lastFinalSeg = Math.max(lastFinalSeg, s.id)
    if (!text) return
    prev = text
    onChunk({ ...makeChunk({ id: s.chunkId, tStart: s.tStart, tEnd: s.tEnd, text, slideIndex: slideFor(s.chunkId) }), ...(quality ? { quality } : {}) })
  }

  const pump = () => {
    if (running || !backlog.length) return
    running = (async () => {
      // Behind by more than one segment: finalise the older ones with their quick text.
      while (backlog.length > 1 && backlog[0].quickP) {
        const s = backlog.shift()
        await s.quickP
        emitFinal(s, s.quick, 'fast')
      }
      const s = backlog.shift()
      try {
        const text = await transcribe(s.audio, { ...promptOpts(getVocab(), prev), tStart: s.tStart, tEnd: s.tEnd })
        if (text) emitFinal(s, text)
        else { if (s.quickP) await s.quickP; emitFinal(s, s.quick, s.quick ? 'fast' : undefined) }
      } catch (e) {
        console.error('[ai/stt] live segment failed', e?.message || e)
        if (s.quickP) await s.quickP
        emitFinal(s, s.quick, 'fast')
      }
      running = null
      pump()
    })()
  }

  const maybePartial = () => {
    // B-008: partials run on their own (fast) model, so they no longer wait for a running final.
    if (!onPartial || partialRunning || sttBusy(config.models.sttPartial !== config.models.stt ? 'partial' : 'final')) return
    if (speechFrames * FRAME / SR < 0.5) return // wait for ~0.5 s of speech
    const at = now()
    if (at - lastPartialAt < partialMs) return
    lastPartialAt = at
    const id = segN
    const n = frames.length * FRAME
    const audio = new Float32Array(n)
    frames.forEach((f, i) => audio.set(f, i * FRAME))
    const tStart = segStart; const tEnd = segStart + n / SR
    partialRunning = true
    transcribe(audio, { ...promptOpts(getVocab(), prev), tStart, tEnd, partial: true })
      .then((text) => {
        if (text && lastFinalSeg < id) onPartial({ text, tStart: round2(tStart), tEnd: round2(tEnd), slideIndex: getSlideIndex() })
      })
      .catch((e) => console.error('[ai/stt] partial failed', e?.message || e))
      .finally(() => { partialRunning = false })
  }

  return {
    push (f32) {
      if (!f32?.length) return
      const merged = new Float32Array(frameBuf.length + f32.length)
      merged.set(frameBuf); merged.set(f32, frameBuf.length)
      let off = 0
      for (; off + FRAME <= merged.length; off += FRAME) {
        const f = merged.slice(off, off + FRAME)
        let e = 0
        for (let i = 0; i < FRAME; i++) e += f[i] * f[i]
        const rms = Math.sqrt(e / FRAME)
        const speech = isSpeech(rms)
        if (!speech) noise = noise * 0.95 + rms * 0.05
        if (!frames.length && !speech) { t += FRAME / SR; segStart = t; continue } // skip leading silence
        frames.push(f)
        t += FRAME / SR
        if (speech) { speechFrames++; silentRun = 0 } else silentRun++
        const len = frames.length * FRAME / SR
        if ((len >= minSec && silentRun * 30 >= silenceMs) || len >= maxSec) cut()
      }
      frameBuf = merged.slice(off)
      if (frames.length) maybePartial()
    },
    /** Transcribe whatever is buffered now (call on "Stop listening"). */
    async flush () { cut(); while (running || backlog.length) { pump(); await running } },
    flushed: async () => { while (running || backlog.length) { pump(); await running } }
  }
}

function sleep (ms, isStopped) {
  return new Promise((resolve) => {
    const end = Date.now() + ms
    const tick = () => (isStopped() || Date.now() >= end) ? resolve() : setTimeout(tick, Math.min(200, end - Date.now()))
    tick()
  })
}
