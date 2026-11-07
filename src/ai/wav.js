// Minimal WAV helpers (PCM16 / float32, any channels) — pure JS, no deps.
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Parse a WAV buffer → { sampleRate, channels, samples: Float32Array (mono, -1..1) } */
export function parseWav (buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let off = 12
  let fmt = null
  let data = null
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14)
      }
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length))
    }
    off = body + size + (size & 1)
  }
  if (!fmt || !data) throw new Error('WAV missing fmt or data chunk')
  const { channels, bits, format } = fmt
  const bytes = bits / 8
  const frames = Math.floor(data.length / (bytes * channels))
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let sum = 0
    for (let c = 0; c < channels; c++) {
      const p = (i * channels + c) * bytes
      if (format === 3 && bits === 32) sum += data.readFloatLE(p)
      else if (bits === 16) sum += data.readInt16LE(p) / 32768
      else if (bits === 32) sum += data.readInt32LE(p) / 2147483648
      else if (bits === 8) sum += (data.readUInt8(p) - 128) / 128
      else throw new Error(`unsupported WAV bit depth ${bits}`)
    }
    out[i] = sum / channels
  }
  return { sampleRate: fmt.sampleRate, channels, samples: out }
}

/** Linear resample mono Float32Array to targetRate. */
export function resample (samples, fromRate, toRate = 16000) {
  if (fromRate === toRate) return samples
  const ratio = fromRate / toRate
  const n = Math.floor(samples.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = i * ratio
    const i0 = Math.floor(x)
    const i1 = Math.min(i0 + 1, samples.length - 1)
    const t = x - i0
    out[i] = samples[i0] * (1 - t) + samples[i1] * t
  }
  return out
}

/** Encode mono Float32Array → 16-bit PCM WAV Buffer. */
export function encodeWav (samples, sampleRate = 16000) {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }
  return buf
}

/** Load any WAV file as 16 kHz mono Float32Array. */
export async function loadWav16k (path) {
  const { sampleRate, samples } = parseWav(await readFile(path))
  return resample(samples, sampleRate, 16000)
}

let tmpDirP = null
let tmpN = 0
/** Write samples to a temp 16 kHz WAV and return its path. */
export async function writeTempWav (samples, sampleRate = 16000) {
  tmpDirP ??= mkdtemp(join(tmpdir(), 'lecscribe-'))
  const p = join(await tmpDirP, `a-${process.pid}-${tmpN++}.wav`)
  await writeFile(p, encodeWav(samples, sampleRate))
  return p
}
