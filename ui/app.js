// LecScribe renderer entry (owner: filip): boot, routing between Library and Lecture view, peer join.
// Talks to main only through window.lec (src/core/preload.cjs).
import { $, hydrateIcons, toast } from './views/dom.js'
import { createStore } from './views/store.js'
import { createLibraryView } from './views/library.js'
import { createLectureView } from './views/lecture.js'
import { mountComponent, fallbackJoinRoom } from './views/components.js'

const lec = window.lec

const state = {
  screen: 'library',
  active: false, // a lecture view is open
  role: 'host',
  moduleId: null,
  lectureId: null,
  lecture: null,
  slides: [],
  current: 0,
  notes: [],
  saved: new Set(),
  chunks: new Map(),
  lines: [],
  lost: {},
  listening: false,
  mic: null,
  clipPlaying: false,
  sessionActive: false,
  ai: {}
}

const app = {
  lec,
  state,
  store: null,
  mountMicPicker: null,
  deps: () => ({ lec, getContext: app.context, toast: (m) => toast(m) }),
  context: () => ({ role: state.role, moduleId: state.moduleId || library?.moduleId, lectureId: state.lectureId, slideIndex: state.current, slideCount: state.slides.length }),
  libraryModuleId: () => library?.moduleId || null,
  moduleById: (id) => library?.modules.find((m) => m.id === id) || null,
  libraryChanged: () => { if (state.screen === 'library') library.refresh() },
  openLibrary,
  openLecture
}

let library = null
let lecture = null

function show (screen) {
  state.screen = screen
  $('screen-library').hidden = screen !== 'library'
  $('screen-lecture').hidden = screen !== 'lecture'
  $('app').classList.toggle('in-lecture', screen === 'lecture')
}

async function openLibrary () {
  await lecture?.close()
  show('library')
  await library.show()
}

async function openLecture (lectureId, opts = {}) {
  library.hide()
  show('lecture')
  await lecture.open(lectureId, opts)
}

/** join-room component (or fallback) reports a joined room: open the peer view on a local lecture. */
async function onJoined ({ key, title } = {}) {
  let lectureId = null
  try {
    let mid = library.moduleId
    if (!mid) { const m = await app.store.createModule({ name: 'Live sessions' }); mid = m.id }
    const l = await app.store.createLecture(mid, { title: title || 'Live session', state: 'attended' })
    lectureId = l.id
    await library.refresh()
  } catch (e) { console.warn('could not create a lecture for the joined room', e) }
  await openLecture(lectureId, { role: 'peer', title: title || 'Live session', key })
  toast('Joined the room. Slides and notes arrive live.')
}

async function boot () {
  hydrateIcons()
  try {
    const info = await lec.info()
    document.documentElement.classList.add(`platform-${info.platform}`)
  } catch {}
  try {
    const mod = await import('./components/mic-picker.js')
    app.mountMicPicker = mod.mountMicPicker
  } catch (e) { console.warn('mic picker unavailable', e) }

  app.store = await createStore(lec, {
    onReady: () => { if (state.screen === 'library') library?.refresh() }
  })
  library = createLibraryView(app)
  lecture = createLectureView(app)
  $('btn-back').addEventListener('click', () => openLibrary())
  lec.on('library:changed', () => app.libraryChanged())

  await mountComponent('join-room', $('mount-join-room'), { ...app.deps(), onJoined, onLeft: () => openLibrary() }, fallbackJoinRoom)
  hydrateIcons()
  show('library')
  await library.show()
  document.documentElement.classList.add('ready')
}

// for david's e2e tests / debugging in DevTools
window.__lecscribe = {
  state,
  app,
  go: (i) => lecture?.go(i),
  openPdf: (bytes, name) => lecture?.openPdf(bytes, name),
  loadDemoDeck: () => lecture?.loadDemoDeck(),
  openLibrary,
  openLecture,
  ready: boot().catch((e) => { console.error('boot failed', e); toast(`LecScribe failed to start: ${e.message || e}`, { error: true, ms: 10000 }) })
}
