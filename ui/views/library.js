// Library screen (owner: filip): module sidebar + lecture list for the selected module.
import { $, el, icon, toast, fmtDate } from './dom.js'
import { mountComponent } from './components.js'

const STATE_LABEL = { live: 'Live', attended: 'Attended', missed: 'Missed', imported: 'Shared' }

/** HUMAN ANSWER 15:15: a short unique ID per module, e.g. #A3F9C2 (the random-hex tail of module.id). */
export const shortId = (id) => '#' + String(id || '').replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()

async function copyText (text) {
  try { await navigator.clipboard.writeText(text); toast(`Copied ${text}`) } catch { toast(text) }
}

export function createLibraryView (app) {
  const v = { modules: [], lectures: [], moduleId: null, rowHandles: [] }

  // ---------- modules ----------
  async function loadModules (selectId) {
    try {
      v.modules = await app.store.listModules()
    } catch (e) {
      toast(`Could not read the library: ${e.message || e}`, { error: true })
      v.modules = []
    }
    if (selectId) v.moduleId = selectId
    if (!v.modules.some((m) => m.id === v.moduleId)) v.moduleId = v.modules[0]?.id || null
    renderModules()
    await loadLectures()
  }

  function renderModules () {
    const nav = $('module-list')
    nav.replaceChildren()
    for (const m of v.modules) {
      const b = el('button', `module-item${m.id === v.moduleId ? ' active' : ''}`)
      b.type = 'button'
      b.append(icon('folder'), el('span', 'module-name', m.name))
      const sid = el('span', 'module-sid', shortId(m.id))
      sid.title = 'Module ID (click to copy)'
      sid.addEventListener('click', (e) => { e.stopPropagation(); copyText(shortId(m.id)) })
      b.append(sid)
      if (m.lectureCount != null) b.append(el('span', 'module-count', String(m.lectureCount)))
      b.addEventListener('click', () => { v.moduleId = m.id; renderModules(); loadLectures() })
      nav.append(b)
    }
  }

  function showNewModule (on) {
    $('new-module-form').hidden = !on
    $('btn-new-module').hidden = on
    if (on) { $('new-module-name').value = ''; $('new-module-name').focus() }
  }

  async function createModule (name) {
    const trimmed = name.trim()
    if (!trimmed) return showNewModule(false)
    const code = (trimmed.match(/^[A-Z]{3,5}\d{4,6}/) || [])[0]
    try {
      const m = await app.store.createModule({ name: trimmed, code })
      showNewModule(false)
      await loadModules(m.id)
    } catch (e) { toast(`Could not create module: ${e.message || e}`, { error: true }) }
  }

  // ---------- lectures ----------
  async function loadLectures () {
    destroyRows()
    const mod = v.modules.find((m) => m.id === v.moduleId)
    $('btn-new-lecture').hidden = !mod
    $('lib-module-name').textContent = mod ? mod.name : 'Library'
    $('lib-module-id').hidden = !mod
    $('lib-module-id').textContent = mod ? shortId(mod.id) : ''
    if (!mod) { v.lectures = []; renderLectures(); return }
    try {
      v.lectures = await app.store.listLectures(mod.id)
    } catch (e) {
      toast(`Could not list lectures: ${e.message || e}`, { error: true })
      v.lectures = []
    }
    const n = v.lectures.length
    $('lib-module-sub').textContent = `${n} lecture${n === 1 ? '' : 's'}${app.store.persistent ? '' : ' · demo library (not saved)'}`
    renderLectures()
  }

  function destroyRows () {
    for (const h of v.rowHandles) h?.destroy?.()
    v.rowHandles = []
  }

  function renderLectures () {
    const list = $('lecture-list')
    const empty = $('lib-empty')
    list.replaceChildren()
    empty.replaceChildren()
    if (!v.modules.length) {
      empty.hidden = false
      empty.append(icon('folder', 28), el('h2', null, 'Create your first module'),
        el('p', null, 'Modules hold your lectures. Each lecture keeps its slides, saved notes and transcript on this device.'))
      const b = el('button', 'btn primary', 'New module')
      b.type = 'button'
      b.addEventListener('click', () => showNewModule(true))
      empty.append(b)
      return
    }
    if (!v.lectures.length) {
      empty.hidden = false
      empty.append(icon('lecture', 28), el('h2', null, 'No lectures yet'),
        el('p', null, 'Start a lecture to load its slides and take notes live, or add one you missed and import a coursemate\'s notes.'))
      const b = el('button', 'btn primary', 'New lecture')
      b.type = 'button'
      b.addEventListener('click', () => showNewLecture(true))
      empty.append(b)
      return
    }
    empty.hidden = true
    for (const l of v.lectures) list.append(lectureRow(l))
  }

  function lectureRow (l) {
    const missed = l.state === 'missed'
    const row = el('div', `lecture-row state-${l.state}`)
    row.tabIndex = missed ? -1 : 0
    const main = el('div', 'lr-main')
    main.append(el('div', 'lr-title', l.title || 'Untitled lecture'))
    const meta = el('div', 'lr-meta')
    if (l.date) meta.append(el('span', null, fmtDate(l.date)))
    if (l.slideCount) meta.append(el('span', null, `${l.slideCount} slides`))
    meta.append(el('span', null, `${l.noteCount || 0} saved note${l.noteCount === 1 ? '' : 's'}`))
    if (l.hasSummary) meta.append(el('span', 'summary-badge', 'Summary'))
    if (l.state === 'imported') meta.append(el('span', 'shared-tag', l.sharedBy ? `Shared by ${l.sharedBy}` : 'Shared by a coursemate'))
    main.append(meta)
    row.append(el('span', 'lr-icon'), main)
    row.querySelector('.lr-icon').append(icon('lecture'))
    row.append(el('span', `state-badge ${l.state}`, STATE_LABEL[l.state] || l.state))
    if (missed) {
      const slot = el('div', 'lr-import')
      row.append(slot)
      mountComponent('share-lecture', slot, {
        ...app.deps(),
        getContext: () => ({ ...app.context(), lectureId: l.id, moduleId: l.moduleId }),
        mode: 'import',
        lectureId: l.id,
        onImported: () => loadLectures()
      }, (t) => {
        const hint = el('span', 'lr-hint', 'Paste a share link to import notes')
        t.append(hint)
        return { destroy () { hint.remove() } }
      }).then((h) => v.rowHandles.push(h))
      row.addEventListener('click', (e) => { if (!slot.contains(e.target)) app.openLecture(l.id, { role: 'host' }) })
    } else {
      row.append(el('span', 'lr-chev'))
      row.querySelector('.lr-chev').append(icon('chevron-right'))
      const open = () => app.openLecture(l.id, { role: 'host' })
      row.addEventListener('click', open)
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') open() })
    }
    return row
  }

  function showNewLecture (on) {
    $('new-lecture-form').hidden = !on
    $('btn-new-lecture').hidden = on || !v.moduleId
    if (on) {
      $('new-lecture-title').value = ''
      // Viewer-only devices (Windows) can't record a lecture: only a missed one, filled from a share link.
      const viewerOnly = app.hostAllowed === false
      $('new-lecture-missed').checked = viewerOnly
      $('new-lecture-missed').disabled = viewerOnly
      $('new-lecture-missed').parentElement.title = viewerOnly ? 'This device can only follow or import lectures. Recording runs on the lecturer’s Mac.' : ''
      $('new-lecture-title').focus()
    }
  }

  async function createLecture () {
    const title = $('new-lecture-title').value.trim()
    if (!title || !v.moduleId) return
    const missed = $('new-lecture-missed').checked
    try {
      const l = await app.store.createLecture(v.moduleId, { title, state: missed ? 'missed' : 'attended' })
      showNewLecture(false)
      if (missed) await loadModules(v.moduleId)
      else await app.openLecture(l.id, { role: 'host', fresh: true })
    } catch (e) { toast(`Could not create lecture: ${e.message || e}`, { error: true }) }
  }

  // ---------- Ask across lectures (stretch #1): library.searchAll -> grouped results -> jump to slide ----------
  const KIND = { note: 'Saved note', transcript: 'Transcript', summary: 'Summary', slide: 'Slide' }
  let askSeq = 0

  /** lectureId -> { title, moduleName } for every lecture (lists are cheap; no slide images). */
  async function lectureIndex () {
    const idx = new Map()
    for (const m of v.modules) {
      try {
        for (const l of await app.store.listLectures(m.id)) idx.set(l.id, { title: l.title || 'Untitled lecture', moduleName: m.name })
      } catch {}
    }
    return idx
  }

  async function runAsk () {
    const q = $('ask-input').value.trim()
    const box = $('ask-results')
    const seq = ++askSeq
    if (!q) { box.hidden = true; box.replaceChildren(); $('lecture-list').hidden = false; return }
    box.hidden = false
    $('lecture-list').hidden = true
    $('lib-empty').hidden = true
    box.replaceChildren(el('div', 'ask-status', 'Searching every lecture on this laptop…'))
    let hits = []
    try {
      hits = await app.store.searchAll(q, 12)
    } catch (e) {
      if (seq !== askSeq) return
      box.replaceChildren(el('div', 'ask-status', `Search failed: ${e.message || e}`))
      return
    }
    const idx = await lectureIndex()
    if (seq !== askSeq) return // a newer query is running
    box.replaceChildren()
    const head = el('div', 'ask-head')
    head.append(el('h2', null, `Results for “${q}”`), el('span', 'ask-count', `${hits.length} match${hits.length === 1 ? '' : 'es'} across lectures`))
    box.append(head)
    if (!hits.length) {
      box.append(el('div', 'ask-status', 'Nothing found. Try other words: search understands meaning, not just exact text.'))
      return
    }
    // group by lecture, keep the best-scoring lecture first
    const groups = new Map()
    for (const h of hits) {
      if (!groups.has(h.lectureId)) groups.set(h.lectureId, [])
      groups.get(h.lectureId).push(h)
    }
    for (const [lectureId, items] of groups) {
      const info = idx.get(lectureId) || { title: 'Lecture', moduleName: '' }
      const g = el('div', 'ask-group')
      const gh = el('div', 'ask-group-head')
      gh.append(el('span', 'ask-module', info.moduleName), el('span', 'ask-lecture', info.title))
      g.append(gh)
      for (const h of items) {
        const b = el('button', 'ask-hit')
        b.type = 'button'
        const meta = el('span', 'ask-meta')
        if (h.kind !== 'slide') meta.append(el('span', 'ask-kind', KIND[h.kind] || h.kind))
        if (Number.isInteger(h.slideIndex)) meta.append(el('span', 'ask-slide', `Slide ${h.slideIndex + 1}`))
        b.append(meta, el('span', 'ask-snippet', String(h.text || '').slice(0, 220)))
        b.addEventListener('click', () => app.openLecture(lectureId, { role: 'host', jumpTo: Number.isInteger(h.slideIndex) ? h.slideIndex : null }))
        g.append(b)
      }
      box.append(g)
    }
  }

  let askTimer = null
  $('ask-input').addEventListener('input', () => { clearTimeout(askTimer); askTimer = setTimeout(runAsk, 300) })
  $('ask-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(askTimer); runAsk() }
    if (e.key === 'Escape') { e.target.value = ''; runAsk() }
  })

  // ---------- wiring ----------
  $('lib-module-id').addEventListener('click', () => copyText($('lib-module-id').textContent))
  $('btn-new-module').addEventListener('click', () => showNewModule(true))
  $('new-module-form').addEventListener('submit', (e) => { e.preventDefault(); createModule($('new-module-name').value) })
  $('new-module-name').addEventListener('keydown', (e) => { if (e.key === 'Escape') showNewModule(false) })
  $('new-module-name').addEventListener('blur', () => { if (!$('new-module-name').value.trim()) showNewModule(false) })
  $('btn-new-lecture').addEventListener('click', () => showNewLecture(true))
  $('btn-cancel-lecture').addEventListener('click', () => showNewLecture(false))
  $('new-lecture-form').addEventListener('submit', (e) => { e.preventDefault(); createLecture() })
  $('new-lecture-title').addEventListener('keydown', (e) => { if (e.key === 'Escape') showNewLecture(false) })

  return {
    get moduleId () { return v.moduleId },
    get modules () { return v.modules },
    async show () { await loadModules(v.moduleId) },
    hide () { destroyRows() },
    refresh: () => loadModules(v.moduleId),
    createModule,
    showNewLecture
  }
}
