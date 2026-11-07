// Stretch: exam-emphasis flag. Owner: aryan.
// Notes about things the lecturer flagged ("this will come up in the exam") get `emphasis: 'exam'`.
import { contentWords } from './agents.js'

export const EXAM_RE = /\b(come|comes|coming) up (in|on) (the |your |an )?(exam|test|final)s?\b|\b(in|on|for) (the |your )?(exam|test|final|midterm)s?\b|\bexam(inable| question| tip| hint)?s?\b|\b(will|might|could|may) be (tested|examined|assessed|asked)\b|\b(i|we)('ll| will) (test|ask|examine) you\b|\bdefinitely (know|learn|remember)\b/i

const sentences = (t) => String(t || '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)

/** Sentences the lecturer flagged for the exam, plus the sentence after each (context). */
export function emphasisSpans (said) {
  const ss = sentences(said)
  const out = []
  ss.forEach((s, i) => {
    if (!EXAM_RE.test(s)) return
    out.push(s)
    if (ss[i + 1]) out.push(ss[i + 1]) // "This will come up in the exam. <the thing>": context follows
  })
  return out
}

/** 'exam' if the note mentions the exam itself, or shares >= 2 content words (>= 30%) with a flagged span. */
export function examEmphasis (note, said) {
  if (EXAM_RE.test(note)) return 'exam'
  const spans = emphasisSpans(said)
  if (!spans.length) return null
  const nw = [...new Set(contentWords(note))]
  if (!nw.length) return null
  for (const sp of spans) {
    const sw = new Set(contentWords(sp))
    const hit = nw.filter((w) => sw.has(w)).length
    if (hit >= 2 && hit / nw.length >= 0.3) return 'exam'
  }
  return null
}
