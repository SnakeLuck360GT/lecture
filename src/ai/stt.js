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

/** Live mic: accumulate pushed Float32 PCM and emit a chunk every chunkSec seconds. */
export function createLiveStream ({ onChunk, getSlideIndex, transcribe = transcribeAudio, chunkSec = config.stt.chunkSec }) {
  const need = Math.round(chunkSec * SR)
  let buf = new Float32Array(0)
  let t = 0
  let queue = Promise.resolve()
  let prev = ''
  return {
    push (f32) {
      const next = new Float32Array(buf.length + f32.length)
      next.set(buf); next.set(f32, buf.length)
      buf = next
      while (buf.length >= need) {
        const piece = buf.slice(0, need)
        buf = buf.slice(need)
        const tStart = t; t += chunkSec
        queue = queue.then(async () => {
          const text = await transcribe(piece, prev ? { prompt: prev.slice(-200) } : {})
          if (text) { prev = text; onChunk(makeChunk({ tStart, tEnd: tStart + chunkSec, text, slideIndex: getSlideIndex() })) }
        }).catch((e) => console.error('[ai/stt] live chunk failed', e))
      }
    },
    flushed: () => queue
  }
}

function sleep (ms, isStopped) {
  return new Promise((resolve) => {
    const end = Date.now() + ms
    const tick = () => (isStopped() || Date.now() >= end) ? resolve() : setTimeout(tick, Math.min(200, end - Date.now()))
    tick()
  })
}
