// Share a lecture's notes / import a missed lecture from a coursemate's link. Owner: aaron. Mounted by filip
// in the Lecture view (and on a missed lecture's card).
//
//   import { mountShareLecture } from './components/share-lecture.js'
//   const share = mountShareLecture(el, { lectureId, onImported: (lecture) => reloadLecture(lecture) })
//
// - attended / live lecture: "Share notes" -> lecscribe://week/ link + QR + copy, "Stop sharing".
// - missed lecture: paste box -> lec.library('importLecture', id, link) -> notes arrive tagged "shared".
// - imported lecture: shows "Shared by <name>".
// Talks only to window.lec: lec.library('getLecture'|'shareLecture'|'stopSharing'|'importLecture') + lec.p2p('qr').
import { injectStyle, h, setKids, icon, copyText, friendlyError, BASE_CSS } from './p2p-shared.js'

const CSS = BASE_CSS + `
.lec-share-lecture { display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: var(--ink, #1f2328); }
.lec-share-lecture__title { font-weight: 600; font-size: 13px; }
.lec-share-lecture__row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.lec-share-lecture__body { display: grid; grid-template-columns: 96px 1fr; gap: 12px; align-items: start; }
.lec-share-lecture__qr { width: 96px; height: 96px; border-radius: 8px; border: 1px solid var(--line, #e3dfd6); background: #fff; padding: 4px; }
.lec-share-lecture__qr svg { width: 100%; height: 100%; display: block; }
.lec-share-lecture__link { padding: 6px 8px; border-radius: 6px; background: var(--paper, #f6f4ef); border: 1px solid var(--line, #e3dfd6); user-select: all; }
.lec-share-lecture__tag { display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 999px; font-size: 12px;
  background: var(--lecturer, #dcecff); color: var(--ink, #1f2328); }
`

export function mountShareLecture (el, { lectureId, onImported, toast } = {}) {
  injectStyle('lec-share-lecture-style', CSS)
  const lec = window.lec
  let destroyed = false
  let lecture = null
  let shared = null // { key, link }
  let qrSvg = ''
  let busy = false
  let error = ''
  let copied = false
  let progress = ''

  const root = h('div', { class: 'lec-share-lecture' })
  el.replaceChildren(root)
  const input = h('input', { class: 'lec-input', type: 'text', placeholder: 'Paste a coursemate’s share link', spellcheck: 'false', 'aria-label': 'Share link' })
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doImport() })

  function render () {
    if (destroyed) return
    if (!lecture) { setKids(root, h('span', { class: 'lec-muted' }, error || 'Loading…')); return }
    const errEl = error ? h('span', { class: 'lec-err' }, error) : null

    if (lecture.state === 'missed') {
      setKids(root, 
        h('span', { class: 'lec-share-lecture__title' }, 'Missed this lecture?'),
        h('span', { class: 'lec-muted' }, 'Paste a link from a coursemate who was there. Their notes come straight from their device.'),
        h('div', { class: 'lec-share-lecture__row' }, input,
          h('button', { class: 'lec-btn lec-btn--primary', onclick: doImport, disabled: busy }, icon('link'), busy ? 'Importing…' : 'Import notes')),
        progress && busy ? h('span', { class: 'lec-muted' }, progress) : null,
        errEl)
      return
    }

    const tag = lecture.state === 'imported'
      ? h('span', { class: 'lec-share-lecture__tag' }, `Shared by ${lecture.sharedBy || 'a coursemate'}`)
      : null

    if (!shared) {
      setKids(root, 
        h('div', { class: 'lec-share-lecture__row' }, h('span', { class: 'lec-share-lecture__title' }, 'Share notes'), tag),
        h('span', { class: 'lec-muted' }, `Send a link so a coursemate who missed it can import ${lecture.noteCount ? `your ${lecture.noteCount} saved ${lecture.noteCount === 1 ? 'note' : 'notes'}` : 'this lecture'}, the summary and the transcript.`),
        h('div', { class: 'lec-share-lecture__row' },
          h('button', { class: 'lec-btn lec-btn--primary', onclick: doShare, disabled: busy }, icon('share'), busy ? 'Preparing…' : 'Create share link')),
        errEl)
      return
    }

    const qr = h('div', { class: 'lec-share-lecture__qr', title: 'Scan to import' })
    qr.innerHTML = qrSvg // generated locally by src/p2p (qrcode package), not user input
    setKids(root, 
      h('div', { class: 'lec-share-lecture__row' }, h('span', { class: 'lec-share-lecture__title' }, 'Sharing notes'), tag),
      h('div', { class: 'lec-share-lecture__body' }, qr,
        h('div', { style: 'display:flex;flex-direction:column;gap:8px;min-width:0' },
          h('div', { class: 'lec-share-lecture__link lec-mono' }, shared.link),
          h('div', { class: 'lec-share-lecture__row' },
            h('button', { class: 'lec-btn', onclick: copy }, icon(copied ? 'check' : 'copy'), copied ? 'Copied' : 'Copy link'),
            h('button', { class: 'lec-btn lec-btn--quiet', onclick: stop }, icon('stop'), 'Stop sharing')),
          h('span', { class: 'lec-muted' }, 'The link works while LecScribe is open on this laptop.'))),
      errEl)
  }

  async function load () {
    try { lecture = await lec.library('getLecture', lectureId); error = '' } catch (err) { error = friendlyError(err) }
    render()
  }
  async function doShare () {
    busy = true; error = ''; render()
    try {
      shared = await lec.library('shareLecture', lectureId)
      try { qrSvg = await lec.p2p('qr', shared.link) } catch { qrSvg = '' }
    } catch (err) { error = friendlyError(err) }
    busy = false; render()
  }
  async function stop () {
    try { await lec.library('stopSharing', lectureId) } catch {}
    shared = null; qrSvg = ''; render()
  }
  async function copy () {
    copied = await copyText(shared.link)
    if (copied && toast) toast('Share link copied')
    render()
    setTimeout(() => { copied = false; render() }, 1500)
  }
  async function doImport () {
    const link = input.value.trim()
    if (!link) { error = 'Paste the link your coursemate sent you.'; render(); return }
    busy = true; error = ''; progress = 'Looking for your coursemate’s device…'; render()
    try {
      lecture = await lec.library('importLecture', lectureId, link)
      input.value = ''
      if (toast) toast(`Imported ${lecture.noteCount} ${lecture.noteCount === 1 ? 'note' : 'notes'}`)
      if (onImported) onImported(lecture)
    } catch (err) { error = friendlyError(err) }
    busy = false; progress = ''; render()
  }

  const off = lec.on('library:changed', (c) => { if (c?.lectureId === lectureId && !busy) load() })
  load()

  return {
    destroy () { destroyed = true; off && off(); el.replaceChildren() }
  }
}
