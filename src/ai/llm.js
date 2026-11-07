// Local LLM helper via QVAC completion(). Owner: aryan.
import { sdk, llmModel, noteSdkError } from './models.js'
import { serial } from './serial.js'

/** Run one non-streaming completion → assistant text (thinking blocks stripped). */
export async function complete (messages) {
  const q = await sdk()
  const modelId = await llmModel()
  // B-016: one LLM job at a time (agents, Explain slide, Explain this and the summary share the model)
  const once = (id) => serial('llm', async () => finalText(await q.completion({ modelId: id, history: messages, stream: false }).final))
  try {
    return await once(modelId)
  } catch (e) {
    if (!noteSdkError(e)) throw e
    return once(await llmModel()) // worker was re-initialised: one retry with a freshly loaded model
  }
}

/**
 * Extract the assistant text from a CompletionFinal (B-001).
 * Real shape (@qvac/sdk 0.23.0, verified on the Mac): { contentText, toolCalls, stats, raw: { fullText }, ... }
 */
export function finalText (final) {
  if (typeof final === 'string') return stripThinking(final)
  const candidates = [final?.contentText, final?.content, final?.text, final?.raw?.fullText]
  for (const c of candidates) {
    if (typeof c === 'string') {
      const t = stripThinking(c)
      if (t) return t
    }
  }
  return ''
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
