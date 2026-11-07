// H-1: zoom + pan for the slide card. Owner: aaron (reassigned from filip). Mounted by the lecture view.
//
//   import { mountSlideZoom } from '../components/slide-zoom.js'
//   const zoom = mountSlideZoom(cardEl, { getTarget: () => visibleImgOrTextEl })
//   zoom.reset()   // call on every slide change (each page starts fitted)
//
// Scale 1 = fit to the card (contain: whole page visible, aspect ratio kept, no crop).
// Controls: − / + / Fit / 100% buttons (bottom-right of the card), Ctrl/Cmd + scroll or trackpad pinch
// (zooms around the pointer), double-click toggles Fit <-> 2x, drag to pan when zoomed, + / - / 0 keys.
import { injectStyle, h } from './p2p-shared.js'

const MIN = 1
const MAX = 6
const CSS = `
.lec-zoom-target { transform-origin: 0 0; will-change: transform; }
.lec-zoom-zoomed .lec-zoom-target { cursor: grab; }
.lec-zoom-dragging .lec-zoom-target { cursor: grabbing; }
.lec-zoom { position: absolute; right: 10px; bottom: 10px; z-index: 3; display: inline-flex; align-items: center; gap: 2px; padding: 3px;
  border-radius: var(--radius, 8px); border: 1px solid var(--line, #e3dfd6); background: var(--panel, #fff); box-shadow: var(--shadow, none);
  opacity: 0; transition: opacity .15s; font-size: 12px; color: var(--ink, #1f2328); }
.slide-card:hover .lec-zoom, .lec-zoom-zoomed .lec-zoom, .lec-zoom:focus-within { opacity: .95; }
.lec-zoom button { min-width: 26px; height: 24px; padding: 0 6px; border: 0; border-radius: 5px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
.lec-zoom button:hover { background: var(--hover, rgba(0,0,0,.06)); }
.lec-zoom__pct { min-width: 42px; text-align: center; font-variant-numeric: tabular-nums; color: var(--muted, #6b6f76); }
`

export function mountSlideZoom (card, { getTarget }) {
  injectStyle('lec-slide-zoom-style', CSS)
  let scale = 1
  let tx = 0
  let ty = 0
  let target = null
  let drag = null

  const pct = h('span', { class: 'lec-zoom__pct' }, 'Fit')
  const bar = h('div', { class: 'lec-zoom', role: 'toolbar', 'aria-label': 'Zoom' },
    h('button', { type: 'button', title: 'Zoom out (-)', 'aria-label': 'Zoom out', onclick: (e) => { e.stopPropagation(); zoomBy(1 / 1.25) } }, '−'),
    pct,
    h('button', { type: 'button', title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: (e) => { e.stopPropagation(); zoomBy(1.25) } }, '+'),
    h('button', { type: 'button', title: 'Fit the whole page (0)', onclick: (e) => { e.stopPropagation(); reset() } }, 'Fit'),
    h('button', { type: 'button', title: 'Actual size', onclick: (e) => { e.stopPropagation(); actualSize() } }, '100%'))
  card.append(bar)

  function el () {
    const t = getTarget()
    if (t !== target) {
      target?.classList.remove('lec-zoom-target')
      if (target) target.style.transform = ''
      target = t
      target?.classList.add('lec-zoom-target')
    }
    return target
  }
  // Size of the element as laid out at scale 1 (offsetWidth/Height ignore transforms).
  const base = () => { const t = el(); return t ? { w: t.offsetWidth, h: t.offsetHeight, x: t.offsetLeft, y: t.offsetTop } : null }

  function clamp () {
    const b = base()
    if (!b || scale <= 1) { tx = 0; ty = 0; return }
    // keep the zoomed page covering the card (no empty gaps when panning)
    const cw = card.clientWidth; const ch = card.clientHeight
    const sw = b.w * scale; const sh = b.h * scale
    const minX = Math.min(0, cw - b.x - sw) - b.x * 0; const maxX = Math.max(0, -b.x)
    const minY = Math.min(0, ch - b.y - sh); const maxY = Math.max(0, -b.y)
    const fitX = sw <= cw; const fitY = sh <= ch
    tx = fitX ? (cw - sw) / 2 - b.x : Math.min(maxX, Math.max(minX, tx))
    ty = fitY ? (ch - sh) / 2 - b.y : Math.min(maxY, Math.max(minY, ty))
  }
  function apply () {
    const t = el()
    clamp()
    if (t) t.style.transform = scale === 1 ? '' : `translate(${tx}px, ${ty}px) scale(${scale})`
    card.classList.toggle('lec-zoom-zoomed', scale > 1)
    pct.textContent = scale === 1 ? 'Fit' : `${Math.round(scale * 100)}%`
  }
  /** zoom keeping the point (cx, cy) in card coordinates under the pointer */
  function zoomAt (next, cx, cy) {
    const b = base()
    if (!b) return
    next = Math.min(MAX, Math.max(MIN, next))
    if (next === scale) return
    // point in element space before zoom
    const ex = (cx - b.x - tx) / scale
    const ey = (cy - b.y - ty) / scale
    scale = next
    tx = cx - b.x - ex * scale
    ty = cy - b.y - ey * scale
    if (scale === 1) { tx = 0; ty = 0 }
    apply()
  }
  const zoomBy = (f) => zoomAt(scale * f, card.clientWidth / 2, card.clientHeight / 2)
  function reset () { scale = 1; tx = 0; ty = 0; apply() }
  function actualSize () {
    const t = el()
    const b = base()
    if (!t || !b) return
    // natural pixel size vs the fitted (contain) size of the image content
    const nw = t.naturalWidth || b.w
    const nh = t.naturalHeight || b.h
    const fit = Math.min(b.w / nw, b.h / nh) || 1
    zoomAt(1 / fit, card.clientWidth / 2, card.clientHeight / 2)
  }

  function onWheel (e) {
    if (!(e.ctrlKey || e.metaKey)) return // plain scroll stays plain scroll; pinch arrives as ctrl+wheel
    e.preventDefault()
    const r = card.getBoundingClientRect()
    zoomAt(scale * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top)
  }
  function onDblClick (e) {
    if (e.target.closest('.lec-zoom, .nav, button')) return
    const r = card.getBoundingClientRect()
    if (scale > 1) reset()
    else zoomAt(2, e.clientX - r.left, e.clientY - r.top)
  }
  function onDown (e) {
    if (scale <= 1 || e.button !== 0 || e.target.closest('.lec-zoom, .nav, button')) return
    drag = { x: e.clientX, y: e.clientY, tx, ty }
    card.classList.add('lec-zoom-dragging')
    card.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }
  function onMove (e) {
    if (!drag) return
    tx = drag.tx + (e.clientX - drag.x)
    ty = drag.ty + (e.clientY - drag.y)
    apply()
  }
  function onUp () { drag = null; card.classList.remove('lec-zoom-dragging') }
  function onKey (e) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target?.isContentEditable
    if (typing || e.metaKey || e.ctrlKey || e.altKey || card.offsetParent === null || !el() || document.querySelector('.lec-present.is-open')) return
    if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.25) }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.25) }
    else if (e.key === '0') { e.preventDefault(); reset() }
  }

  card.addEventListener('wheel', onWheel, { passive: false })
  card.addEventListener('dblclick', onDblClick)
  card.addEventListener('pointerdown', onDown)
  card.addEventListener('pointermove', onMove)
  card.addEventListener('pointerup', onUp)
  card.addEventListener('pointercancel', onUp)
  document.addEventListener('keydown', onKey)
  const ro = new ResizeObserver(() => apply())
  ro.observe(card)

  return {
    reset,
    zoomBy,
    actualSize,
    get scale () { return scale },
    destroy () {
      ro.disconnect()
      card.removeEventListener('wheel', onWheel)
      card.removeEventListener('dblclick', onDblClick)
      card.removeEventListener('pointerdown', onDown)
      card.removeEventListener('pointermove', onMove)
      card.removeEventListener('pointerup', onUp)
      card.removeEventListener('pointercancel', onUp)
      document.removeEventListener('keydown', onKey)
      bar.remove()
    }
  }
}
