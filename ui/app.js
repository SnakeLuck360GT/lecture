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
  hostAllowed: true, // false on Windows (viewer-only), set in boot()
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

/**
 * HUMAN UI REQUEST (2): going Home must NOT stop a live session (host listening / clip / sharing a room,
 * or a joined peer). The lecture view keeps running hidden and the Library shows "Back to live lecture".
 */
async function openLibrary () {
  await lecture?.refreshLive?.()
  if (!lecture?.isLive()) await lecture?.close()
  show('library')
  renderLiveBanner()
  await library.show()
}

/** End the session for real (Leave session / room ended), then go Home. */
async function endLecture () {
  await lecture?.close()
  show('library')
  renderLiveBanner()
  await library.show()
}

async function openLecture (lectureId, opts = {}) {
  await lecture?.refreshLive?.()
  // Same live lecture (and no jump requested): just bring it back, don't re-open.
  if (lecture?.isLive() && lectureId && lectureId === state.lectureId && opts.jumpTo == null) return backToLive()
  if (lecture?.isLive()) {
    await lecture.close() // opening another lecture ends the live one
    toast('Ended the live session')
  }
  library.hide()
  show('lecture')
  renderLiveBanner()
  await lecture.open(lectureId, opts)
}

function backToLive () {
  library.hide()
  show('lecture')
  renderLiveBanner()
}

function renderLiveBanner () {
  const live = !!lecture?.isLive()
  const banner = $('live-banner')
  banner.hidden = !live || state.screen !== 'library'
  if (!live) return
  const title = $('crumb-lecture').textContent || 'Live lecture'
  $('live-banner-title').textContent = title
  $('live-banner-kind').textContent = state.role === 'peer' ? 'Following live' : state.listening ? 'Live · listening' : 'Live'
}
app.liveChanged = () => renderLiveBanner()

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

// H-3: never let a stray error kill the UI silently; main prints these as [renderer:error].
window.addEventListener('error', (e) => console.error('[ui] uncaught:', e.message, e.filename ? `${e.filename}:${e.lineno}` : ''))
window.addEventListener('unhandledrejection', (e) => console.error('[ui] unhandled rejection:', e.reason?.stack || e.reason))

async function boot () {
  hydrateIcons()
  try {
    const info = await lec.info()
    document.documentElement.classList.add(`platform-${info.platform}`)
    // HUMAN DECISION 15:26: no hosting on Windows. Viewer-only devices hide every host control.
    app.hostAllowed = info.hostAllowed !== false
    document.documentElement.classList.toggle('no-host', !app.hostAllowed)
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
  $('btn-back-live').addEventListener('click', () => backToLive())
  $('btn-leave').addEventListener('click', async () => {
    try { await lec.p2p('leaveRoom') } catch {}
    await endLecture()
  })
  lec.on('library:changed', () => app.libraryChanged())
  for (const ev of ['listen:state', 'p2p:status', 'clip:ended']) lec.on(ev, () => setTimeout(renderLiveBanner, 0))

  await mountComponent('join-room', $('mount-join-room'), { ...app.deps(), onJoined, onLeft: () => endLecture() }, fallbackJoinRoom)
  // aryan's Nearby sessions (6-digit codes on the LAN): clicking a session goes through aaron's join box,
  // so its timeouts / Leave state stay consistent.
  await mountComponent('nearby-sessions', $('mount-nearby'), {
    ...app.deps(),
    onJoin: (link) => {
      const input = $('mount-join-room').querySelector('input')
      if (!input) return lec.p2p('joinRoom', link).then((info) => onJoined(info || {})).catch((e) => toast(`Could not join: ${e.message || e}`, { error: true }))
      input.value = link
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }
  })
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
  backToLive,
  endLecture,
  isLive: () => !!lecture?.isLive(),
  ready: boot().catch((e) => { console.error('boot failed', e); toast(`LecScribe failed to start: ${e.message || e}`, { error: true, ms: 10000 }) })
}
