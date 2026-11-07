// Mock AI backends: no models, deterministic, same shapes. For UI dev + tests. Owner: aryan.
// - embed: hashed bag-of-words (so tracking still roughly works on word overlap)
// - transcribe: reads a sidecar transcript `<wav>.transcript.json` ([{tStart,tEnd,text}]) if present
// - complete: echoes sentences from the transcript as notes
import { readFile } from 'node:fs/promises'
import { normalise } from './embed.js'

const DIM = 256
const STOP = new Set('the a an and or of to in on for is are was were be this that it its with as at by from we you they i so but not can will just like'.split(' '))

export async function mockEmbed (text) {
  if (Array.isArray(text)) return Promise.all(text.map(mockEmbed))
  const v = new Array(DIM).fill(0)
  for (const w of String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []) {
    if (STOP.has(w)) continue
    let h = 2166136261
    for (let i = 0; i < w.length; i++) { h ^= w.charCodeAt(i); h = Math.imul(h, 16777619) }
    v[(h >>> 0) % DIM] += 1
  }
  return normalise(v)
}

export async function mockTranscribe (audio) {
  if (typeof audio === 'string') {
    const side = await readSidecar(audio)
    if (side) return side.map((s) => s.text).join(' ')
  }
  const sec = typeof audio === 'string' ? 0 : (audio.length / 16000)
  return `mock transcript of ${sec.toFixed(1)} seconds of audio`
}

export async function readSidecar (wavPath) {
  try {
    const arr = JSON.parse(await readFile(wavPath.replace(/\.wav$/i, '') + '.transcript.json', 'utf8'))
    return Array.isArray(arr) ? arr : null
  } catch { return null }
}

/** For mock playClip: transcribe(samples) returns the sidecar segments whose midpoint falls in each window. */
export function sidecarTranscriber (segments) {
  let t = 0
  return async (samples) => {
    const tStart = t
    const tEnd = t + samples.length / 16000
    t = tEnd
    return segments
      .filter((s) => { const mid = (s.tStart + s.tEnd) / 2; return mid >= tStart && mid < tEnd })
      .map((s) => s.text).join(' ')
  }
}

export async function mockComplete (messages) {
  const user = messages[messages.length - 1]?.content || ''
  const said = (user.split(/WHAT THE LECTURER SAID:|LECTURER'S EXPLANATION:|TRANSCRIPT:/)[1] || '').split('\n\n')[0]
  const sentences = said.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20)
  if (/JSON array/.test(user)) return JSON.stringify(sentences.slice(0, 2).map((s) => s.split(' ').slice(0, 20).join(' ')))
  return sentences.slice(0, 3).join(' ') || 'Mock summary.'
}
