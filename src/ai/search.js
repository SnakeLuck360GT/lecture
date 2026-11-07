// Search helpers for the per-lecture stores (src/library, aaron). Owner: aryan.
// - EmbeddingGemma is trained with task prefixes (model card): queries and documents are embedded
//   differently, which noticeably improves retrieval. Other models get the raw text.
// - Transcript chunks are ~2-6 s; on their own they embed poorly, so index ~30 s passages instead.
// - hybridScore mixes cosine with exact keyword hits (names, numbers, "O(n)") that embeddings blur.
import { config } from './config.js'

const isGemma = () => /EMBEDDINGGEMMA/i.test(config.models.embed)

export const queryText = (q) => (isGemma() ? `task: search result | query: ${q}` : String(q))
export const docText = (t, title = 'none') => (isGemma() ? `title: ${title || 'none'} | text: ${t}` : String(t))

/** Wrap an embed(string|string[]) function into { query(q), docs(texts, titles?) }. */
export function searchEmbedder (embed) {
  return {
    query: (q) => embed(queryText(q)),
    docs: (texts, titles = []) => embed(texts.map((t, i) => docText(t, titles[i])))
  }
}

/**
 * Merge consecutive transcript chunks of the same slide into passages of <= maxSec seconds.
 * @returns {{ id, slideIndex, tStart, tEnd, text, chunkIds: string[] }[]}
 */
export function transcriptPassages (chunks, { maxSec = 30, maxChars = 900 } = {}) {
  const out = []
  let cur = null
  for (const c of [...(chunks || [])].sort((a, b) => a.tStart - b.tStart)) {
    const text = String(c.text || '').trim()
    if (!text) continue
    const fits = cur && cur.slideIndex === c.slideIndex &&
      (c.tEnd - cur.tStart) <= maxSec && (cur.text.length + text.length) <= maxChars
    if (fits) {
      cur.text += ' ' + text
      cur.tEnd = c.tEnd
      cur.chunkIds.push(c.id)
    } else {
      cur = { id: `p-${c.id}`, slideIndex: c.slideIndex, tStart: c.tStart, tEnd: c.tEnd, text, chunkIds: [c.id] }
      out.push(cur)
    }
  }
  return out
}

const WORD = /[\p{L}\p{N}]+(?:\.\d+)?/gu
const STOP = new Set('the a an and or of to in on for is are was were be it this that with as at by from what how why when which who does do did can'.split(' '))
const terms = (s) => (String(s || '').toLowerCase().match(WORD) || []).filter((w) => !STOP.has(w) && (w.length > 1 || /\d/.test(w)))

/** Fraction of query terms present in text (prefix match for words >= 5 chars, so "probing" ~ "probe"). */
export function keywordHits (query, text) {
  const q = [...new Set(terms(query))]
  if (!q.length) return 0
  const t = terms(text)
  const ts = new Set(t)
  let hit = 0
  for (const w of q) {
    if (ts.has(w)) { hit++; continue }
    const p = w.slice(0, 5)
    if (w.length >= 5 && t.some((x) => x.startsWith(p))) hit += 0.7
  }
  return hit / q.length
}

/** Cosine + keyword blend in [0, 1]-ish. kind boosts favour saved notes over raw transcript. */
export function hybridScore ({ cosine, query, text, kind }) {
  const kw = keywordHits(query, text)
  const boost = kind === 'note' ? 0.03 : kind === 'summary' ? 0.01 : 0
  return 0.8 * (cosine ?? 0) + 0.2 * kw + boost
}
