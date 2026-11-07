// S3: automatic slide tracking. Owner: aryan.
// Compares rolling transcript windows with slide embeddings; advances only when confident.
import { config } from './config.js'
import { cosine } from './embed.js'

/**
 * Pure decision function (unit-tested).
 * @returns {{ index:number, confidence:number, scores:Object }|null} target slide or null to stay.
 */
export function decide ({ scores, current, threshold, margin }) {
  const cur = scores[current] ?? 0
  let best = current; let bestS = -Infinity
  for (const [k, s] of Object.entries(scores)) {
    const i = Number(k)
    if (i > current && s > bestS) { best = i; bestS = s }
  }
  if (best === current) return null
  if (bestS >= threshold && bestS - cur >= margin) return { index: best, confidence: clamp01(bestS), margin: bestS - cur }
  return null
}
const clamp01 = (x) => Math.max(0, Math.min(1, x))

/**
 * Wire a tracker onto the bus.
 * @param {object} o
 * @param {{on,off,emit}} o.bus
 * @param {(texts:string[])=>Promise<number[][]>} o.embedMany
 * @param {(text:string)=>Promise<number[]>} o.embedOne
 */
export function createTracker ({ bus, embedMany, embedOne, opts = {} }) {
  const o = { ...config.tracker, ...opts }
  let slideVecs = [] // number[][] (index-aligned with slides)
  let slidesReady = Promise.resolve()
  let current = 0
  let holdUntil = 0
  const recent = [] // recent chunk texts
  let busy = Promise.resolve()
  let pending = null // narrow-win candidate awaiting confirmation

  const onSlides = (slides) => {
    current = 0
    recent.length = 0
    slideVecs = []
    const texts = (slides || []).map((s) => s.text || '')
    slidesReady = embedMany(texts).then((v) => { slideVecs = v }).catch((e) => {
      console.error('[ai/tracker] slide embedding failed', e)
    })
  }

  const onChanged = (ev) => {
    if (!ev || typeof ev.index !== 'number') return
    current = ev.index
    if (ev.source === 'manual') { holdUntil = Date.now() + o.manualHoldMs; recent.length = 0; pending = null }
  }

  const onChunk = (chunk) => {
    recent.push(chunk.text || '')
    while (recent.length > o.windowChunks) recent.shift()
    const windowText = recent.join(' ')
    busy = busy.then(async () => {
      await slidesReady
      if (!slideVecs.length) return
      const qv = await embedOne(windowText)
      const scores = {}
      const last = Math.min(slideVecs.length - 1, current + o.lookahead)
      for (let i = current; i <= last; i++) {
        scores[i] = cosine(qv, slideVecs[i]) + (i === current + 1 ? o.nextBonus : 0)
      }
      bus.emit('tracker:scores', { chunkId: chunk.id, scores })
      if (Date.now() < holdUntil) return
      const d = decide({ scores, current, threshold: o.threshold, margin: o.margin })
      if (!d) { pending = null; return }
      // Clear win -> advance now; narrow win -> needs the same candidate on two consecutive chunks.
      const sure = d.margin >= o.strongMargin || (pending && pending.index === d.index)
      if (!sure) { pending = d; return }
      {
        pending = null
        current = d.index
        recent.length = 0
        bus.emit('slide:changed', { index: d.index, source: 'auto', confidence: d.confidence, chunkId: chunk.id })
      }
    }).catch((e) => console.error('[ai/tracker] chunk scoring failed', e))
  }

  bus.on('slides:loaded', onSlides)
  bus.on('slide:changed', onChanged)
  bus.on('transcript:chunk', onChunk)
  return {
    current: () => current,
    idle: () => busy,
    dispose () {
      bus.off('slides:loaded', onSlides)
      bus.off('slide:changed', onChanged)
      bus.off('transcript:chunk', onChunk)
    }
  }
}
