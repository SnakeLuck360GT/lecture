// "My notes": the student's own notes on the current slide. Owner: aaron. Mounted by filip in the notes column.
//
//   import { mountPersonalNotes } from './components/personal-notes.js'
//   const mine = mountPersonalNotes(el, { lectureId, getSlideIndex: () => current, onChange: (notes) => {} })
//   mine.setSlide(i)   // optional: it also follows slide:changed by itself
//   mine.destroy()
//
// LOCAL ONLY: saved through lec.library('addPersonalNote' | 'updatePersonalNote' | 'deletePersonalNote'),
// never emitted on the bus as note:added, never shared or exported. Works for hosts and viewers alike.
// Autosave: typing saves after a short pause and on blur; an empty note is removed when you leave it.
import { injectStyle, h, setKids, friendlyError, BASE_CSS } from './p2p-shared.js'

const SAVE_MS = 600
const CSS = BASE_CSS + `
.lec-personal-notes { display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--ink, #1f2328); }
.lec-personal-notes__head { display: flex; align-items: center; gap: 8px; }
.lec-personal-notes__title { font-weight: 600; font-size: 12px; letter-spacing: .02em; text-transform: uppercase; color: var(--muted, #6b6f76); }
.lec-personal-notes__private { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted, #6b6f76); }
.lec-personal-notes__private svg { width: 12px; height: 12px; }
.lec-personal-notes__add { margin-left: auto; }
.lec-personal-notes__list { display: flex; flex-direction: column; gap: 6px; }
.lec-personal-notes__note { position: relative; border: 1px solid var(--line, #e3dfd6); border-left: 3px solid var(--accent, #2f6f5e);
  border-radius: var(--radius-sm, 6px); background: var(--panel, #fff); }
.lec-personal-notes__note:focus-within { border-color: var(--accent, #2f6f5e); }
.lec-personal-notes__text { display: block; width: 100%; min-height: 34px; resize: none; overflow: hidden; border: 0; outline: 0; background: transparent;
  color: inherit; font: inherit; font-size: 13px; line-height: 1.45; padding: 8px 30px 8px 10px; box-sizing: border-box; -webkit-app-region: no-drag; }
.lec-personal-notes__text::placeholder { color: var(--muted, #6b6f76); }
.lec-personal-notes__del { position: absolute; top: 4px; right: 4px; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 5px; background: transparent;
  color: var(--muted, #6b6f76); cursor: pointer; opacity: 0; transition: opacity .12s; -webkit-app-region: no-drag; }
.lec-personal-notes__note:hover .lec-personal-notes__del, .lec-personal-notes__del:focus-visible { opacity: 1; }
.lec-personal-notes__del:hover { color: var(--danger, #c2412d); }
.lec-personal-notes__status { font-size: 11px; color: var(--muted, #6b6f76); min-height: 14px; }
.lec-personal-notes__empty { font-size: 12px; color: var(--muted, #6b6f76); margin: 0; }
`
const LOCK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/></svg>'
const CROSS = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>'

export function mountPersonalNotes (el, { lec = window.lec, lectureId, getSlideIndex = () => 0, onChange } = {}) {
  injectStyle('lec-personal-notes-style', CSS)
  let destroyed = false
  let slide = Number(getSlideIndex()) || 0
  let notes = []
  let status = ''
  let loadSeq = 0
  const timers = new Map() // noteId -> pending autosave timer

  const list = h('div', { class: 'lec-personal-notes__list' })
  const statusEl = h('div', { class: 'lec-personal-notes__status', 'aria-live': 'polite' })
  const lock = h('span', { class: 'lec-personal-notes__private', title: 'Saved only on this device. Never shared.' })
  lock.innerHTML = LOCK
  lock.append('Only on this device')
  const addBtn = h('button', { class: 'lec-btn lec-btn--quiet lec-personal-notes__add', onclick: addNote, title: 'Add a note for this slide' }, '+ Add note')
  const root = h('div', { class: 'lec-personal-notes' },
    h('div', { class: 'lec-personal-notes__head' }, h('span', { class: 'lec-personal-notes__title' }, 'My notes'), lock, addBtn),
    list, statusEl)
  el.replaceChildren(root)

  const setStatus = (s) => { status = s; statusEl.textContent = s; statusEl.className = 'lec-personal-notes__status' + (/fail|couldn/i.test(s) ? ' lec-err' : '') }
  const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px' }

  function render (focusId) {
    if (destroyed) return
    if (!lectureId) { setKids(list, h('p', { class: 'lec-personal-notes__empty' }, 'Open a lecture to write your own notes.')); addBtn.disabled = true; return }
    addBtn.disabled = false
    if (!notes.length) {
      setKids(list, h('p', { class: 'lec-personal-notes__empty' }, `Nothing yet for slide ${slide + 1}. Add a note only you can see.`))
      return
    }
    setKids(list, ...notes.map((n) => {
      const ta = h('textarea', { class: 'lec-personal-notes__text', rows: '1', placeholder: 'Type your note…', 'aria-label': `My note on slide ${slide + 1}` })
      ta.value = n.text || ''
      ta.addEventListener('input', () => { grow(ta); n.text = ta.value; schedule(n) })
      ta.addEventListener('blur', () => flush(n, { dropIfEmpty: true }))
      ta.addEventListener('keydown', (e) => { if (e.key === 'Escape') ta.blur() })
      const del = h('button', { class: 'lec-personal-notes__del', title: 'Delete note', 'aria-label': 'Delete note', onclick: () => removeNote(n) })
      del.innerHTML = CROSS
      const card = h('div', { class: 'lec-personal-notes__note', 'data-id': n.id }, ta, del)
      setTimeout(() => { grow(ta); if (n.id === focusId) ta.focus() }, 0)
      return card
    }))
  }

  async function load () {
    const seq = ++loadSeq
    if (!lectureId) { notes = []; render(); return }
    try {
      const got = await lec.library('listPersonalNotes', lectureId, slide)
      if (seq !== loadSeq || destroyed) return
      notes = got || []
      render()
    } catch (err) { setStatus('Couldn’t load your notes: ' + friendlyError(err)) }
  }

  function schedule (n) {
    clearTimeout(timers.get(n.id))
    setStatus('Saving…')
    timers.set(n.id, setTimeout(() => flush(n), SAVE_MS))
  }
  async function flush (n, { dropIfEmpty = false } = {}) {
    clearTimeout(timers.get(n.id))
    timers.delete(n.id)
    if (dropIfEmpty && !String(n.text || '').trim()) return removeNote(n, { quiet: true })
    try {
      await lec.library('updatePersonalNote', lectureId, n.id, { text: n.text })
      setStatus('Saved on this device')
      if (onChange) onChange(notes.slice())
    } catch (err) { setStatus('Couldn’t save: ' + friendlyError(err)) }
  }
  async function addNote () {
    try {
      const n = await lec.library('addPersonalNote', lectureId, { slideIndex: slide, text: '' })
      notes.push(n)
      render(n.id)
    } catch (err) { setStatus('Couldn’t add a note: ' + friendlyError(err)) }
  }
  async function removeNote (n, { quiet = false } = {}) {
    clearTimeout(timers.get(n.id))
    timers.delete(n.id)
    notes = notes.filter((x) => x.id !== n.id)
    render()
    try {
      await lec.library('deletePersonalNote', lectureId, n.id)
      if (!quiet) setStatus('Note deleted')
      if (onChange) onChange(notes.slice())
    } catch (err) { setStatus('Couldn’t delete: ' + friendlyError(err)) }
  }
  async function flushAll () {
    for (const n of notes) if (timers.has(n.id)) await flush(n)
  }

  async function setSlide (i) {
    const next = Number(i) || 0
    if (next === slide) return
    await flushAll() // never lose typing when the slide changes under you
    slide = next
    setStatus('')
    await load()
  }

  const off = lec.on ? lec.on('slide:changed', (e) => { if (Number.isInteger(e?.index)) setSlide(e.index) }) : null
  load()

  return {
    setSlide,
    /** Point the component at another lecture (e.g. after onJoined created the local lecture). */
    async setLecture (id) { await flushAll(); lectureId = id; await load() },
    async destroy () { destroyed = true; off && off(); await flushAll(); el.replaceChildren() }
  }
}
