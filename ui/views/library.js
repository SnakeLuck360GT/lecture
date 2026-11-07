// Library screen (owner: filip): module sidebar + lecture list for the selected module.
import { $, el, icon, toast, fmtDate } from './dom.js'
import { mountComponent } from './components.js'

const STATE_LABEL = { live: 'Live', attended: 'Attended', missed: 'Missed', imported: 'Shared' }

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
    if (on) { $('new-lecture-title').value = ''; $('new-lecture-missed').checked = false; $('new-lecture-title').focus() }
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

  // ---------- wiring ----------
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
