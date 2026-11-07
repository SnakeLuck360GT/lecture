// PDF -> slides (owner: filip). Shared by the renderer (with page images) and Node (text only, for
// tests). The pdf.js library is injected so the same code works with the browser build
// (ui/) and the legacy Node build (tests).
//
//   const slides = await loadPdf(bytes, { pdfjs, renderImages: true, scale: 1.5 })
//   -> [{ index, text, image }]   image = JPEG data URL (renderer) or null (Node)

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @param {{ pdfjs: any, renderImages?: boolean, scale?: number, quality?: number, onProgress?: (done:number,total:number)=>void }} opts
 */
export async function loadPdf (data, { pdfjs, renderImages = typeof document !== 'undefined', scale = 1.5, quality = 0.85, onProgress, standardFontDataUrl, cMapUrl } = {}) {
  if (!pdfjs) throw new Error('loadPdf: pass { pdfjs } (pdfjs-dist module)')
  // pdf.js rejects Node Buffers and detaches what it is given, so always pass a fresh Uint8Array copy.
  const bytes = new Uint8Array(data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
  const opts = { data: bytes, isEvalSupported: false }
  if (standardFontDataUrl) opts.standardFontDataUrl = standardFontDataUrl
  if (cMapUrl) { opts.cMapUrl = cMapUrl; opts.cMapPacked = true }
  const doc = await pdfjs.getDocument(opts).promise
  const slides = []
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const text = await pageText(page)
      const image = renderImages ? await renderPage(page, scale, quality) : null
      slides.push({ index: n - 1, text, image })
      page.cleanup()
      onProgress?.(n, doc.numPages)
    }
  } finally {
    await doc.destroy()
  }
  return slides
}

/** Join text items into lines, using pdf.js's hasEOL flag and vertical position changes. */
async function pageText (page) {
  const tc = await page.getTextContent()
  let out = ''
  let lastY = null
  for (const it of tc.items) {
    if (typeof it.str !== 'string') continue
    const y = it.transform ? it.transform[5] : null
    if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n'
    out += it.str
    if (it.hasEOL) out += '\n'
    else if (it.str && !it.str.endsWith(' ')) out += ' '
    lastY = y
  }
  return out
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

async function renderPage (page, scale, quality) {
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  const url = canvas.toDataURL('image/jpeg', quality)
  canvas.width = canvas.height = 0
  return url
}
