// OCR for image-only slides (S1 step) via QVAC OCR_LATIN. Owner: aryan.
import { writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sdk, ocrModel } from './models.js'

/** image: file path | data URL | Buffer → recognised text (reading order, top→bottom). */
export async function ocr (image) {
  const q = await sdk()
  const modelId = await ocrModel()
  const input = await toInput(image)
  const { blocks } = q.ocr({ modelId, image: input })
  return blocksToText(await blocks)
}

export function blocksToText (blocks) {
  const bs = (blocks || []).filter((b) => b && b.text && (b.confidence ?? 1) > 0.2)
  bs.sort((a, b) => {
    const ay = a.bbox?.[1] ?? 0; const by = b.bbox?.[1] ?? 0
    if (Math.abs(ay - by) > 12) return ay - by
    return (a.bbox?.[0] ?? 0) - (b.bbox?.[0] ?? 0)
  })
  return bs.map((b) => b.text.trim()).join(' ').replace(/\s+/g, ' ').trim()
}

let dirP = null
async function toInput (image) {
  if (typeof image === 'string' && image.startsWith('data:')) {
    const m = image.match(/^data:image\/(\w+);base64,(.*)$/)
    if (!m) throw new Error('unsupported data URL')
    dirP ??= mkdtemp(join(tmpdir(), 'lecscribe-ocr-'))
    const p = join(await dirP, `s-${Date.now()}-${Math.random().toString(36).slice(2)}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`)
    await writeFile(p, Buffer.from(m[2], 'base64'))
    return p
  }
  return image
}
