// Small DOM helpers + the inline SVG icon set (owner: filip). 16px, stroke currentColor, 1.75.
export const $ = (id) => document.getElementById(id)

export function el (tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

const P = {
  pen: '<path d="M11.5 2.5l2 2L6 12l-3 1 1-3 7.5-7.5z"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  'chevron-left': '<path d="M10 3.5L5.5 8 10 12.5"/>',
  'chevron-right': '<path d="M6 3.5L10.5 8 6 12.5"/>',
  'chevron-up': '<path d="M3.5 10L8 5.5 12.5 10"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="M10.25 10.25L13.5 13.5"/>',
  folder: '<path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1v-7.5z"/>',
  file: '<path d="M4 1.75h5L12.25 5v9.25H4z"/><path d="M9 1.75V5h3.25"/>',
  slides: '<rect x="1.75" y="3" width="12.5" height="8.5" rx="1"/><path d="M5.5 14h5M8 11.5V14"/>',
  play: '<path d="M5 3.5v9l7-4.5z"/>',
  stop: '<rect x="4.25" y="4.25" width="7.5" height="7.5" rx="1"/>',
  mic: '<rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.75 8a4.25 4.25 0 008.5 0M8 12.25V14"/>',
  users: '<circle cx="6" cy="5.5" r="2.25"/><path d="M2 13c.4-2.2 2-3.5 4-3.5s3.6 1.3 4 3.5"/><path d="M10.5 3.5a2.25 2.25 0 010 4.25M12 9.75c1 .5 1.7 1.6 2 3.25"/>',
  link: '<path d="M6.75 9.25l2.5-2.5"/><path d="M7.5 4.75l1-1a2.5 2.5 0 013.5 3.5l-1 1"/><path d="M8.5 11.25l-1 1a2.5 2.5 0 01-3.5-3.5l1-1"/>',
  check: '<path d="M3.5 8.5L6.5 11.5 12.5 4.5"/>',
  x: '<path d="M4 4l8 8M12 4l-8 8"/>',
  bookmark: '<path d="M4.5 2.5h7v11L8 11l-3.5 2.5z"/>',
  star: '<path d="M8 2.25l1.75 3.6 3.95.55-2.86 2.77.68 3.93L8 11.25 4.48 13.1l.68-3.93L2.3 6.4l3.95-.55z" stroke-linejoin="round"/>',
  lecture: '<rect x="2" y="2.75" width="12" height="9" rx="1.25"/><path d="M5 14h6"/>'
}

/** Return an <svg> string for an icon name. */
export function iconSvg (name, size = 16) {
  const p = P[name]
  if (!p) return ''
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
}

export function icon (name, size) {
  const s = document.createElement('span')
  s.className = 'ico-wrap'
  s.innerHTML = iconSvg(name, size)
  return s
}

/** Fill every [data-icon] placeholder under root. */
export function hydrateIcons (root = document) {
  for (const n of root.querySelectorAll('[data-icon]')) {
    if (n.dataset.iconDone) continue
    n.insertAdjacentHTML('afterbegin', iconSvg(n.dataset.icon))
    n.dataset.iconDone = '1'
  }
}

let toastTimer
export function toast (msg, { error = false, ms = 3200 } = {}) {
  const t = $('toast')
  t.textContent = msg
  t.className = `toast${error ? ' error' : ''}`
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, ms)
}

export function fmtDate (v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return String(v)
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function debounce (fn, ms) {
  let t
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) }
}
