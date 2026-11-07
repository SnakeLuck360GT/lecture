// S3 / shared: text embeddings via QVAC. Owner: aryan.
import { sdk, embedModel, noteSdkError } from './models.js'

/** embed(string) → number[] ; embed(string[]) → number[][] (vectors L2-normalised). */
export async function embed (text) {
  try { return await embedOnce(text) } catch (e) {
    if (!noteSdkError(e)) throw e
    return embedOnce(text) // worker was re-initialised: one retry
  }
}

async function embedOnce (text) {
  const q = await sdk()
  const modelId = await embedModel()
  if (Array.isArray(text)) {
    if (text.length === 0) return []
    const { embedding } = await q.embed({ modelId, text: text.map(safe) })
    return embedding.map(normalise)
  }
  const { embedding } = await q.embed({ modelId, text: safe(text) })
  return normalise(embedding)
}

const safe = (t) => (String(t || '').trim() || '(empty)').slice(0, 2000)

export function normalise (v) {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  return Array.from(v, (x) => x / n)
}

export function cosine (a, b) {
  let dot = 0; let na = 0; let nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return dot / (Math.sqrt(na * nb) || 1)
}
