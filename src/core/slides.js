// Slide post-processing in MAIN (owner: filip). Runs OCR for image-only slides, then the caller
// emits 'slides:loaded'. Pure apart from the injected `ocr` function, so it is unit-testable.
import { OCR_MIN_CHARS } from './types.js'

/**
 * @param {{ index?: number, text?: string, image?: string|null }[]} raw  slides from the PDF loader
 * @param {{ ocr?: (image: string) => Promise<string>, log?: (msg: string) => void }} [opts]
 * @returns {Promise<import('./types.js').Slide[]>}
 */
export async function processSlides (raw, { ocr, log = () => {} } = {}) {
  if (!Array.isArray(raw)) throw new TypeError('processSlides: expected an array of slides')
  const out = []
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] || {}
    let text = normaliseText(s.text)
    const image = s.image ?? null
    if (text.length < OCR_MIN_CHARS && image && typeof ocr === 'function') {
      try {
        const got = normaliseText(await ocr(image))
        if (got) { text = text ? `${text}\n${got}` : got; log(`slide ${i + 1}: OCR added ${got.length} chars`) }
      } catch (e) {
        log(`slide ${i + 1}: OCR failed (${e?.message || e})`)
      }
    }
    out.push({ index: i, text, image })
  }
  return out
}

/** Collapse runs of spaces, keep line breaks, trim. */
export function normaliseText (t) {
  if (typeof t !== 'string') return ''
  return t
    .split('\n')
    .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}
