// H-7 fullscreen PRESENT mode. Owner: aaron. Mounted once by ui/app.js.
//
//   import { mountPresentMode } from './components/present-mode.js'
//   const present = mountPresentMode({ lec, getSlides: () => state.slides, getIndex: () => state.current,
//                                      getNotes: () => state.notes, buttonHost: el })
//   present.open() / present.close() / present.destroy()
//
// F (or the Present button) opens a fullscreen overlay with the current slide letterboxed (no crop).
// Next: → ↓ PageDown Space Enter, click right. Previous: ← ↑ PageUp Backspace, click left. Home / End.
// Esc (or F) exits. T = transcript strip, N = notes for this slide, B = black screen.
// Navigation emits slide:changed { source: 'manual' } on the bus, exactly like the prev/next buttons, and the
// overlay follows slide:changed from anywhere (auto-tracking, the lecture view, the host for a viewer).
// Listening keeps running: it is the same window, nothing is stopped. Talks only to window.lec.
import { injectStyle, h, setKids } from './p2p-shared.js'

const CSS = `
.lec-present { position: fixed; inset: 0; z-index: 10000; background: #000; color: #fff; display: none; user-select: none;
  font-family: var(--font, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif); cursor: none; }
.lec-present.is-open { display: block; }
.lec-present.show-cursor { cursor: default; }
.lec-present__stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.lec-present__img { max-width: 100vw; max-height: 100vh; width: 100%; height: 100%; object-fit: contain; display: block; }
.lec-present__text { max-width: 80vw; font-size: clamp(22px, 3.2vw, 48px); line-height: 1.35; white-space: pre-wrap; text-align: left; }
.lec-present__black { position: absolute; inset: 0; background: #000; display: none; }
.lec-present.is-black .lec-present__black { display: block; }
.lec-present__count { position: absolute; right: 18px; bottom: 14px; font-size: 13px; color: rgba(255,255,255,.55); font-variant-numeric: tabular-nums; }
.lec-present__hint { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); padding: 6px 12px; border-radius: 8px;
  background: rgba(0,0,0,.6); color: rgba(255,255,255,.85); font-size: 12px; transition: opacity .4s; pointer-events: none; }
.lec-present__hint.is-hidden { opacity: 0; }
.lec-present__strip { position: absolute; left: 0; right: 0; bottom: 0; padding: 14px 24px 34px; background: linear-gradient(transparent, rgba(0,0,0,.85) 35%);
  font-size: clamp(16px, 1.6vw, 24px); line-height: 1.4; display: none; }
.lec-present.show-transcript .lec-present__strip { display: block; }
.lec-present__final { color: rgba(255,255,255,.75); }
.lec-present__partial { color: rgba(255,255,255,.5); font-style: italic; }
.lec-present__notes { position: absolute; top: 0; right: 0; bottom: 0; width: min(380px, 32vw); padding: 20px 18px; overflow: auto;
  background: rgba(20,20,22,.92); border-left: 1px solid rgba(255,255,255,.12); display: none; }
.lec-present.show-notes .lec-present__notes { display: block; }
.lec-present__notes-title { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: rgba(255,255,255,.55); margin: 0 0 12px; }
.lec-present__note { padding: 10px 12px; border-radius: 8px; margin-bottom: 8px; font-size: 15px; line-height: 1.45;
  background: rgba(255,241,168,.12); border-left: 3px solid var(--sticky-edge, #e8d46a); }
.lec-present__note.is-lecturer { background: rgba(141,184,234,.14); border-left-color: var(--lecturer-edge, #8db8ea); }
.lec-present__note.is-explain { background: rgba(47,111,94,.22); border-left-color: var(--accent, #2f6f5e); }
.lec-present__note-kind { display: block; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: rgba(255,255,255,.5); margin-bottom: 4px; }
.lec-present__empty { color: rgba(255,255,255,.5); font-size: 14px; }
.lec-present-btn { display: inline-flex; align-items: center; gap: 6px; }
`
const KIND = { ai: 'AI-generated', lecturer: 'Lecturer explanation', explain: 'AI explanation' }

export function mountPresentMode ({ lec = window.lec, getSlides = () => [], getIndex = () => 0, getNotes = () => [], buttonHost = null } = {}) {
  injectStyle('lec-present-style', CSS)
  let openNow = false
  let index = Number(getIndex()) || 0
  let finalLine = ''
  let partialLine = ''
  const extraNotes = new Map() // notes seen on the bus (id -> note), merged with getNotes()
  let hintTimer = null
  let cursorTimer = null

  const img = h('img', { class: 'lec-present__img', alt: '' })
  const text = h('div', { class: 'lec-present__text' })
  const stage = h('div', { class: 'lec-present__stage' })
  const count = h('div', { class: 'lec-present__count' })
  const hint = h('div', { class: 'lec-present__hint' }, '← → to move · T transcript · N notes · B black · Esc to exit')
  const finalEl = h('div', { class: 'lec-present__final' })
  const partialEl = h('div', { class: 'lec-present__partial' })
  const strip = h('div', { class: 'lec-present__strip' }, finalEl, partialEl)
  const notesBox = h('div', { class: 'lec-present__notes' })
  const black = h('div', { class: 'lec-present__black' })
  const root = h('div', { class: 'lec-present', role: 'dialog', 'aria-label': 'Presentation', tabindex: '-1' }, stage, count, strip, notesBox, black, hint)
  document.body.append(root)

  const slides = () => (typeof getSlides === 'function' ? getSlides() : []) || []

  function renderSlide () {
    const list = slides()
    const n = list.length
    if (!n) { setKids(stage, h('div', { class: 'lec-present__text' }, 'No slides loaded yet.')); count.textContent = ''; return }
    index = Math.max(0, Math.min(n - 1, index))
    const s = list[index] || {}
    if (s.image) {
      if (img.getAttribute('src') !== s.image) img.src = s.image
      setKids(stage, img)
    } else {
      text.textContent = s.text || ''
      setKids(stage, text)
    }
    count.textContent = `${index + 1} / ${n}`
    renderNotes()
  }
  function notesFor (i) {
    const byId = new Map()
    for (const n of (typeof getNotes === 'function' ? getNotes() : []) || []) if (n && n.id) byId.set(n.id, n)
    for (const n of extraNotes.values()) byId.set(n.id, n)
    return [...byId.values()].filter((n) => n.slideIndex === i && n.kind !== 'personal').sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  }
  function renderNotes () {
    if (!root.classList.contains('show-notes')) return
    const list = notesFor(index)
    setKids(notesBox, h('p', { class: 'lec-present__notes-title' }, `Notes · slide ${index + 1}`),
      ...(list.length
        ? list.map((n) => h('div', { class: `lec-present__note ${n.kind === 'lecturer' ? 'is-lecturer' : n.kind === 'explain' ? 'is-explain' : ''}` },
          h('span', { class: 'lec-present__note-kind' }, KIND[n.kind] || 'Note'), n.text || ''))
        : [h('p', { class: 'lec-present__empty' }, 'No notes for this slide yet.')]))
  }
  function renderStrip () { finalEl.textContent = finalLine; partialEl.textContent = partialLine }
  function flashHint () {
    hint.classList.remove('is-hidden')
    clearTimeout(hintTimer)
    hintTimer = setTimeout(() => hint.classList.add('is-hidden'), 2500)
  }
  function wakeCursor () {
    root.classList.add('show-cursor')
    clearTimeout(cursorTimer)
    cursorTimer = setTimeout(() => root.classList.remove('show-cursor'), 1500)
  }

  function goTo (i) {
    const n = slides().length
    if (!n) return
    const next = Math.max(0, Math.min(n - 1, i))
    if (next === index) return
    index = next
    renderSlide()
    lec.emit('slide:changed', { index, source: 'manual' }) // same as the prev/next buttons (manual always wins)
  }

  // Keys while presenting: capture phase on window + stopPropagation, so the lecture view's own arrow-key
  // handler doesn't ALSO move the slide (that would skip one).
  function onKey (e) {
    if (!openNow) {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target?.isContentEditable
      if ((e.key === 'f' || e.key === 'F') && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && slides().length) { e.preventDefault(); open() }
      return
    }
    const k = e.key
    let handled = true
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || k === ' ' || k === 'Enter') goTo(index + 1)
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace') goTo(index - 1)
    else if (k === 'Home') goTo(0)
    else if (k === 'End') goTo(slides().length - 1)
    else if (k === 'Escape' || k === 'f' || k === 'F') close()
    else if (k === 't' || k === 'T') root.classList.toggle('show-transcript')
    else if (k === 'n' || k === 'N') { root.classList.toggle('show-notes'); renderNotes() }
    else if (k === 'b' || k === 'B' || k === '.') root.classList.toggle('is-black')
    else handled = false
    if (handled) { e.preventDefault(); e.stopPropagation() }
  }
  function onClick (e) {
    if (!openNow || notesBox.contains(e.target)) return
    const x = e.clientX / window.innerWidth
    goTo(index + (x < 0.33 ? -1 : 1))
  }
  function onFullscreenChange () { if (openNow && !document.fullscreenElement) close({ fromFullscreen: true }) }

  async function open () {
    if (openNow) return
    openNow = true
    index = Number(getIndex()) || 0
    root.classList.add('is-open')
    root.classList.remove('is-black')
    renderSlide()
    renderStrip()
    flashHint()
    root.focus({ preventScroll: true })
    try { if (!document.fullscreenElement) await root.requestFullscreen() } catch { /* overlay still covers the window */ }
  }
  async function close ({ fromFullscreen = false } = {}) {
    if (!openNow) return
    openNow = false
    root.classList.remove('is-open', 'is-black')
    if (!fromFullscreen && document.fullscreenElement) { try { await document.exitFullscreen() } catch {} }
  }

  const offs = [
    lec.on('slide:changed', (e) => { if (Number.isInteger(e?.index)) { index = e.index; if (openNow) renderSlide() } }),
    lec.on('slides:loaded', () => { extraNotes.clear(); index = 0; finalLine = ''; partialLine = ''; if (openNow) { renderSlide(); renderStrip() } }),
    lec.on('note:added', (n) => { if (n && n.id) { extraNotes.set(n.id, n); if (openNow && n.slideIndex === index) renderNotes() } }),
    lec.on('transcript:partial', (p) => { partialLine = p?.text || ''; if (openNow) renderStrip() }),
    lec.on('transcript:chunk', (c) => { finalLine = c?.text || ''; partialLine = ''; if (openNow) renderStrip() })
  ]
  window.addEventListener('keydown', onKey, true)
  root.addEventListener('click', onClick)
  root.addEventListener('mousemove', wakeCursor)
  document.addEventListener('fullscreenchange', onFullscreenChange)

  let button = null
  if (buttonHost) {
    button = h('button', { class: 'btn ghost lec-present-btn', type: 'button', title: 'Present fullscreen (F)', onclick: () => open() })
    button.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="1.5"/><path d="M8 11.5v2M5.5 13.5h5"/></svg>'
    button.append('Present')
    buttonHost.append(button)
  }

  return {
    open,
    close,
    get isOpen () { return openNow },
    destroy () {
      close()
      offs.forEach((off) => off && off())
      window.removeEventListener('keydown', onKey, true)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      clearTimeout(hintTimer); clearTimeout(cursorTimer)
      button?.remove()
      root.remove()
    }
  }
}
