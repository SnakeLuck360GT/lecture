// "I'm lost" heatmap strip: one cell per slide, darker = more students lost. Owner: aaron. Mounted by filip
// directly above (or below) the thumbnail strip, at the same width, so cell i lines up with thumbnail i.
//
//   import { mountHeatmap } from './components/heatmap.js'
//   const heat = mountHeatmap(el, { onSelect: (i) => goToSlide(i) })
//
// Listens to lost:counts ({ [slideIndex]: count }) and slides:loaded (cell count). Shows counts, never names.
import { injectStyle, h, BASE_CSS } from './p2p-shared.js'

const CSS = BASE_CSS + `
.lec-heatmap { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--muted, #6b6f76); }
.lec-heatmap__head { display: flex; justify-content: space-between; align-items: baseline; }
.lec-heatmap__title { font-weight: 600; }
.lec-heatmap__strip { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 4px; }
.lec-heatmap__cell { position: relative; height: 22px; border-radius: 5px; border: 1px solid var(--line, #e3dfd6); background: var(--panel, #fff);
  cursor: pointer; padding: 0; font: inherit; font-size: 11px; color: var(--muted, #6b6f76); overflow: hidden; -webkit-app-region: no-drag; }
.lec-heatmap__fill { position: absolute; inset: 0; background: var(--danger, #c2412d); opacity: 0; transition: opacity .25s ease; }
.lec-heatmap__num { position: relative; font-variant-numeric: tabular-nums; }
.lec-heatmap__cell.is-hot .lec-heatmap__num { color: #fff; font-weight: 600; }
.lec-heatmap__cell.is-current { outline: 2px solid var(--accent, #2f6f5e); outline-offset: 1px; }
`

export function mountHeatmap (el, { onSelect, slideCount = 0, showHeader = true } = {}) {
  injectStyle('lec-heatmap-style', CSS)
  const lec = window.lec
  let destroyed = false
  let n = slideCount
  let counts = {}
  let current = 0

  const strip = h('div', { class: 'lec-heatmap__strip', role: 'list' })
  const total = h('span')
  const root = h('div', { class: 'lec-heatmap' },
    showHeader ? h('div', { class: 'lec-heatmap__head' }, h('span', { class: 'lec-heatmap__title' }, 'Students lost'), total) : null,
    strip)
  el.replaceChildren(root)

  function render () {
    if (destroyed) return
    const max = Math.max(1, ...Object.values(counts).map(Number))
    const sum = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0)
    total.textContent = sum ? `${sum} lost` : 'Nobody lost'
    const cells = []
    for (let i = 0; i < n; i++) {
      const c = Number(counts[i] || 0)
      const fill = h('span', { class: 'lec-heatmap__fill' })
      fill.style.opacity = c ? String(0.18 + 0.82 * (c / max)) : '0'
      cells.push(h('button', {
        class: `lec-heatmap__cell ${c / max > 0.45 ? 'is-hot' : ''} ${i === current ? 'is-current' : ''}`,
        role: 'listitem',
        title: `Slide ${i + 1}: ${c} ${c === 1 ? 'student' : 'students'} lost`,
        'aria-label': `Slide ${i + 1}, ${c} lost`,
        onclick: () => onSelect && onSelect(i)
      }, fill, h('span', { class: 'lec-heatmap__num' }, c ? String(c) : '')))
    }
    strip.replaceChildren(...cells)
  }

  const offs = [
    lec.on('lost:counts', (c) => { counts = c || {}; render() }),
    lec.on('slides:loaded', (s) => { n = Array.isArray(s) ? s.length : n; counts = {}; render() }),
    lec.on('slide:changed', (e) => { if (Number.isInteger(e?.index)) { current = e.index; render() } })
  ]
  lec.p2p('lostCounts').then((c) => { if (c && Object.keys(c).length) { counts = c; render() } }).catch(() => {})
  render()

  return {
    setSlideCount (count) { n = Number(count) || 0; render() },
    update (c) { counts = c || {}; render() },
    destroy () { destroyed = true; offs.forEach((off) => off && off()); el.replaceChildren() }
  }
}
