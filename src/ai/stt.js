// S2: speech-to-text via QVAC (whisper). Owner: aryan.
// Demo path: a recorded clip is cut into fixed windows, each window is transcribed ahead of
// playback, and its chunk is emitted when playback reaches the window end (realtime pacing).
import { sdk, sttModel } from './models.js'
import { config } from './config.js'
import { loadWav16k, writeTempWav } from './wav.js'

const SR = 16000

/** Transcribe one audio source (path to a WAV, or Float32Array 16 kHz mono) → plain text. */
export async function transcribeAudio (audio, { prompt } = {}) {
  const q = await sdk()
  const modelId = await sttModel()
  const audioChunk = typeof audio === 'string' ? audio : await writeTempWav(audio, SR)
  const text = await q.transcribe({ modelId, audioChunk, ...(prompt ? { prompt } : {}) })
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

let chunkN = 0
export function makeChunk ({ tStart, tEnd, text, slideIndex }) {
  return { id: `c-${++chunkN}`, slideIndex, tStart: round2(tStart), tEnd: round2(tEnd), text }
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
export function playClip ({ wavPath, onChunk, getSlideIndex, realtime = true, transcribe = transcribeAudio, chunkSec }) {
  let stopped = false
  const t0 = Date.now()
  const done = (async () => {
    const samples = await loadWav16k(wavPath)
    let prev = ''
    for (const w of windows(samples, chunkSec)) {
      if (stopped) return
      const text = await transcribe(w.samples, prev ? { prompt: prev.slice(-200) } : {})
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
 * Silent segments are dropped. Transcription runs in one serial queue; if it falls behind,
 * queued segments are merged so latency stays bounded.
 */
export function createLiveStream ({
  onChunk, getSlideIndex, transcribe = transcribeAudio,
  minSec = config.stt.liveMinSec, maxSec = config.stt.liveMaxSec, silenceMs = config.stt.liveSilenceMs,
  maxMergeSec = 10
}) {
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

  const isSpeech = (rms) => rms > Math.max(0.008, noise * 3)

  const cut = () => {
    if (!frames.length) return
    const n = frames.length * FRAME
    const audio = new Float32Array(n)
    frames.forEach((f, i) => audio.set(f, i * FRAME))
    const seg = { tStart: segStart, tEnd: segStart + n / SR, audio, speech: speechFrames }
    frames.length = 0; speechFrames = 0; silentRun = 0; segStart = t
    if (seg.speech * FRAME / SR < 0.4) return // basically silence
    backlog.push(seg)
    pump()
  }

  const pump = () => {
    if (running || !backlog.length) return
    // merge everything waiting into one segment (bounded latency when STT is slower than real time)
    const segs = [backlog.shift()]
    while (backlog.length && (backlog[0].tEnd - segs[0].tStart) <= maxMergeSec) segs.push(backlog.shift())
    let audio = segs[0].audio
    if (segs.length > 1) {
      audio = new Float32Array(segs.reduce((a, s) => a + s.audio.length, 0))
      let off = 0
      for (const s of segs) { audio.set(s.audio, off); off += s.audio.length }
    }
    const tStart = segs[0].tStart; const tEnd = segs.at(-1).tEnd
    running = (async () => {
      try {
        const text = await transcribe(audio, { ...(prev ? { prompt: prev.slice(-200) } : {}), tStart, tEnd })
        if (text) { prev = text; onChunk(makeChunk({ tStart, tEnd, text, slideIndex: getSlideIndex() })) }
      } catch (e) { console.error('[ai/stt] live segment failed', e) }
      running = null
      pump()
    })()
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
