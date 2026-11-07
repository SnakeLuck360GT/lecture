// Local LLM helper via QVAC completion(). Owner: aryan.
import { sdk, llmModel } from './models.js'

/** Run one non-streaming completion → assistant text (thinking blocks stripped). */
export async function complete (messages) {
  const q = await sdk()
  const modelId = await llmModel()
  const run = q.completion({ modelId, history: messages, stream: false })
  const final = await run.final
  const text = typeof final === 'string' ? final : (final?.content ?? final?.text ?? '')
  return stripThinking(String(text))
}

export function stripThinking (t) {
  return t.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim()
}

/** Pull a JSON string array out of model output; falls back to bullet lines. */
export function parseNotes (text, max = 3) {
  const t = stripThinking(String(text || ''))
  const m = t.match(/\[[\s\S]*\]/)
  if (m) {
    try {
      const arr = JSON.parse(m[0])
      if (Array.isArray(arr)) {
        return tidy(arr.map((x) => (typeof x === 'string' ? x : x?.note || x?.text || '')), max)
      }
    } catch {}
  }
  if (/^\s*(none|no new|nothing|\[\s*\])/i.test(t)) return []
  const lines = t.split('\n').map((l) => l.replace(/^\s*([-*•]|\d+[.)])\s*/, '')).filter((l) => l.length > 8)
  return tidy(lines, max)
}

function tidy (arr, max) {
  const seen = new Set()
  const out = []
  for (let s of arr) {
    s = String(s || '').replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ')
    if (s.length < 6) continue
    const words = s.split(' ')
    if (words.length > 40) s = words.slice(0, 40).join(' ') + '…'
    const k = s.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k); out.push(s)
    if (out.length >= max) break
  }
  return out
}
