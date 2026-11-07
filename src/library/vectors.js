// Per-lecture vector store (owner: aaron). One JSON file per lecture, brute-force cosine (a lecture has
// at most a few hundred items, so a query takes well under a millisecond).
export function cosine (a, b) {
  let dot = 0; let na = 0; let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

const WORD = /[\p{L}\p{N}]+/gu
const words = (s) => (String(s || '').toLowerCase().match(WORD) || []).filter((w) => w.length > 1)

/** Keyword fallback score in [0,1] (used when no embedder is available). */
export function keywordScore (query, text) {
  const q = new Set(words(query))
  if (!q.size) return 0
  const t = new Set(words(text))
  let hit = 0
  for (const w of q) if (t.has(w)) hit++
  return hit / q.size
}

/**
 * items: [{ id, kind, refId, slideIndex, text, vector|null, chunkIds? }]
 * -> top-k hits by cosine (or keyword fallback when vectors are missing); `score` (aryan's hybridScore) overrides.
 */
export function rank (items, { query, queryVector, k = 5, score: scorer }) {
  const scored = []
  for (const it of items) {
    const hasVec = queryVector && Array.isArray(it.vector) && it.vector.length
    let score
    if (scorer) {
      try { score = scorer({ cosine: hasVec ? cosine(queryVector, it.vector) : 0, query, text: it.text, kind: it.kind }) } catch { score = 0 }
    } else {
      score = hasVec ? cosine(queryVector, it.vector) : keywordScore(query, it.text)
    }
    if (score > 0) scored.push({ score, kind: it.kind, text: it.text, slideIndex: it.slideIndex ?? null, refId: it.refId, ...(it.chunkIds ? { chunkIds: it.chunkIds } : {}) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, k)
}
