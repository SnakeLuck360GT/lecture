// Renderer-safe mic capture (NO QVAC / Node imports). Owner: aryan. Used by filip's UI.
//
//   import { startMic } from '../src/ai/browser/mic-capture.js'
//   const mic = await startMic((f32) => window.lec.ai('pushAudio', f32), { onLevel: (rms) => ... })
//   ...
//   await mic.stop()
//
// Delivers Float32Array, 16 kHz mono, ~100 ms per call (send it straight to ai.pushAudio /
// ai.pushExplainAudio over IPC). macOS: the app must hold mic permission (filip's shell).

const TARGET = 16000

/**
 * @param {(f32: Float32Array) => void} onChunk
 * @param {{ deviceId?: string, chunkMs?: number, onLevel?: (rms:number)=>void }} [opts]
 * @returns {Promise<{ stop(): Promise<void>, sampleRate: number }>}
 */
export async function startMic (onChunk, { deviceId, chunkMs = 100, onLevel } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  })
  let ctx
  try { ctx = new AudioContext({ sampleRate: TARGET }) } catch { ctx = new AudioContext() }
  const src = ctx.createMediaStreamSource(stream)
  const rate = ctx.sampleRate
  const want = Math.round((TARGET * chunkMs) / 1000)
  let acc = new Float32Array(0)

  const handle = (input) => {
    const mono = rate === TARGET ? new Float32Array(input) : downsample(input, rate, TARGET)
    const merged = new Float32Array(acc.length + mono.length)
    merged.set(acc); merged.set(mono, acc.length)
    let off = 0
    for (; off + want <= merged.length; off += want) {
      const piece = merged.slice(off, off + want)
      if (onLevel) onLevel(rms(piece))
      onChunk(piece)
    }
    acc = merged.slice(off)
  }

  // ScriptProcessorNode: deprecated but universally available in Electron/Chromium and needs no
  // worklet file (CSP-safe). 4096 frames ≈ 85-256 ms depending on the context rate.
  const proc = ctx.createScriptProcessor(4096, 1, 1)
  proc.onaudioprocess = (e) => handle(e.inputBuffer.getChannelData(0))
  const mute = ctx.createGain()
  mute.gain.value = 0
  src.connect(proc); proc.connect(mute); mute.connect(ctx.destination)

  return {
    sampleRate: rate,
    async stop () {
      try { proc.disconnect(); src.disconnect(); mute.disconnect() } catch {}
      stream.getTracks().forEach((t) => t.stop())
      try { await ctx.close() } catch {}
      if (acc.length) onChunk(acc)
      acc = new Float32Array(0)
    }
  }
}

/** List microphones (labels appear after permission is granted). */
export async function listMics () {
  const devs = await navigator.mediaDevices.enumerateDevices()
  return devs.filter((d) => d.kind === 'audioinput').map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }))
}

function downsample (input, from, to) {
  const ratio = from / to
  const n = Math.floor(input.length / ratio)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio); const b = Math.min(input.length, Math.floor((i + 1) * ratio))
    let s = 0
    for (let j = a; j < b; j++) s += input[j]
    out[i] = s / Math.max(1, b - a)
  }
  return out
}

function rms (f) {
  let e = 0
  for (let i = 0; i < f.length; i++) e += f[i] * f[i]
  return Math.sqrt(e / (f.length || 1))
}
