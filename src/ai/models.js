// QVAC model manager: lazy, de-duplicated model loading with 'ai:status' events.
// Registry constants pick their own modelType, so we only pass it for OCR (as the docs do).
// The SDK is imported dynamically so mock mode / unit tests never need it.
import { config } from './config.js'

let sdkP = null
export function sdk () {
  sdkP ??= import('@qvac/sdk')
  return sdkP
}

const loading = new Map() // kind -> Promise<modelId>
let statusBus = null
export function setStatusBus (bus) { statusBus = bus }
function status (model, state, extra = {}) {
  statusBus?.emit('ai:status', { model, state, ...extra })
}

function resolveConst (q, name) {
  const v = q[name]
  if (!v) throw new Error(`@qvac/sdk has no export ${name}`)
  return v
}

async function load (kind, makeOpts) {
  if (!loading.has(kind)) {
    const p = (async () => {
      const q = await sdk()
      status(kind, 'loading', { progress: 0 })
      let lastPct = -1
      const opts = await makeOpts(q)
      const modelId = await q.loadModel({
        ...opts,
        onProgress: (p) => {
          const pct = Math.floor(p?.percentage ?? 0)
          if (pct !== lastPct) { lastPct = pct; status(kind, 'loading', { progress: pct }) }
        }
      })
      status(kind, 'ready')
      return modelId
    })()
    p.catch((err) => { loading.delete(kind); status(kind, 'error', { error: String(err?.message || err) }) })
    loading.set(kind, p)
  }
  return loading.get(kind)
}

/** STT model. kind 'final' (accurate, drives tracking/notes) or 'partial' (fast live preview).
 *  If both env choices name the same model it is loaded once. */
export function sttModel (kind = 'final') {
  const name = kind === 'partial' ? config.models.sttPartial : config.models.stt
  const key = kind === 'partial' && name !== config.models.stt ? 'stt-partial' : 'stt'
  return load(key, async (q) => ({
    modelSrc: resolveConst(q, name),
    modelConfig: {
      language: config.stt.language,
      strategy: 'greedy',
      translate: false,
      no_timestamps: false,
      single_segment: false,
      temperature: 0.0,
      suppress_blank: true,
      suppress_nst: true
    }
  }))
}

export function embedModel () {
  return load('embed', async (q) => ({
    modelSrc: q[config.models.embed] || resolveConst(q, config.models.embedFallback)
  }))
}

export function llmModel () {
  return load('llm', async (q) => ({
    modelSrc: resolveConst(q, config.models.llm),
    modelConfig: { ctx_size: 4096 }
  }))
}

export function ocrModel () {
  return load('ocr', async (q) => {
    const c = resolveConst(q, config.models.ocr)
    return { modelSrc: c.src || c, modelType: q.MODEL_TYPES?.ggmlOcr }
  })
}

export async function closeAll () {
  if (!sdkP) return
  const q = await sdkP
  for (const p of loading.values()) {
    try { await q.unloadModel({ modelId: await p }) } catch {}
  }
  loading.clear()
  try { await q.close?.() } catch {}
}
