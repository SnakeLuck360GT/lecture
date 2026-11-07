// LecScribe renderer (owner: filip). Talks to main only through window.lec (see src/core/preload.cjs).
import * as pdfjs from '../node_modules/pdfjs-dist/build/pdf.mjs'
import { loadPdf } from '../src/core/pdf.js'
import { startMic } from '../src/ai/browser/mic-capture.js'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

const lec = window.lec
const $ = (id) => document.getElementById(id)

const state = {
  slides: [],
  current: 0,
  notes: [], // Note[]
  saved: new Set(), // note ids
  chunks: new Map(), // chunk id -> TranscriptChunk
  lost: {}, // slideIndex -> count
  moduleId: 'COMP26120',
  weekId: 'week-3',
  listening: false,
  mic: null,
  clipPlaying: false,
  ai: {} // model -> status
}

// ---------- helpers ----------
let toastTimer
function toast (msg, { error = false, ms = 3200 } = {}) {
  const t = $('toast')
  t.textContent = msg
  t.className = `toast${error ? ' error' : ''}`
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, ms)
}
const el = (tag, cls, text) => {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}

// ---------- slides ----------
async function openPdf (bytes, name) {
  try {
    toast(`Loading ${name}…`, { ms: 60000 })
    const raw = await loadPdf(bytes, {
      pdfjs,
      renderImages: true,
      scale: 1.6,
      onProgress: (d, n) => toast(`Rendering slide ${d}/${n}…`, { ms: 60000 })
    })
    toast(`Reading slide text (${raw.length} slides)…`, { ms: 60000 })
    await lec.processSlides(raw) // main OCRs image-only slides, then emits 'slides:loaded'
    toast(`Loaded ${raw.length} slides from ${name}`)
  } catch (e) {
    console.error(e)
    toast(`Could not load PDF: ${e.message || e}`, { error: true, ms: 6000 })
  }
}

function onSlidesLoaded (slides) {
  state.slides = slides
  state.current = 0
  state.notes = []
  state.saved.clear()
  state.lost = {}
  $('empty').hidden = true
  $('btn-listen').disabled = false
  $('btn-listen').title = 'Listen to the lecture through this laptop\'s microphone'
  renderStrip()
  renderSlide()
  renderNotes()
}

function go (index, source = 'manual') {
  if (!state.slides.length) return
  const i = Math.max(0, Math.min(state.slides.length - 1, index))
  if (i === state.current && source === 'manual') return
  lec.emit('slide:changed', { index: i, source })
}

function onSlideChanged ({ index, source, confidence }) {
  if (!Number.isInteger(index) || !state.slides[index]) return
  state.current = index
  const b = $('track-badge')
  b.hidden = false
  b.className = `badge${source === 'manual' ? ' manual' : ''}`
  b.textContent = source === 'auto' ? `auto${typeof confidence === 'number' ? ` · ${Math.round(confidence * 100)}%` : ''}` : 'manual'
  renderSlide()
  renderNotes()
  markActiveThumb()
}

function renderSlide () {
  const s = state.slides[state.current]
  const img = $('slide-img')
  const txt = $('slide-text')
  if (!s) { img.hidden = true; txt.hidden = true; return }
  if (s.image) {
    img.src = s.image
    img.alt = s.text || `Slide ${s.index + 1}`
    img.hidden = false
    txt.hidden = true
  } else {
    txt.textContent = s.text || '(empty slide)'
    txt.hidden = false
    img.hidden = true
  }
  $('slide-count').textContent = `${state.current + 1} / ${state.slides.length}`
  $('btn-prev').disabled = state.current === 0
  $('btn-next').disabled = state.current >= state.slides.length - 1
}

function renderStrip () {
  const strip = $('strip')
  strip.replaceChildren()
  for (const s of state.slides) {
    const b = el('button', 'thumb')
    b.dataset.index = s.index
    b.title = (s.text || '').split('\n')[0] || `Slide ${s.index + 1}`
    if (s.image) { const im = el('img'); im.src = s.image; im.alt = ''; b.append(im) } else b.append(el('div', 'num', String(s.index + 1)))
    b.append(el('span', 'heat'), el('span', 'num', String(s.index + 1)))
    const nc = el('span', 'ncount'); nc.hidden = true; b.append(nc)
    b.addEventListener('click', () => go(s.index, 'manual'))
    strip.append(b)
  }
  markActiveThumb()
  updateThumbBadges()
}

function markActiveThumb () {
  for (const t of document.querySelectorAll('.thumb')) {
    const on = Number(t.dataset.index) === state.current
    t.classList.toggle('active', on)
    if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }
}

function updateThumbBadges () {
  const max = Math.max(1, ...Object.values(state.lost))
  for (const t of document.querySelectorAll('.thumb')) {
    const i = Number(t.dataset.index)
    const n = state.notes.filter((x) => x.slideIndex === i).length
    const nc = t.querySelector('.ncount')
    nc.hidden = n === 0
    nc.textContent = `${n} note${n === 1 ? '' : 's'}`
    const lost = state.lost[i] || 0
    const heat = t.querySelector('.heat')
    heat.style.opacity = lost ? String(0.25 + 0.75 * (lost / max)) : '0'
    heat.title = lost ? `${lost} lost` : ''
  }
}

// ---------- notes ----------
function onNoteAdded (note) {
  if (!note || typeof note.id !== 'string') return
  if (state.notes.some((n) => n.id === note.id)) return
  state.notes.push(note)
  if (note.slideIndex === state.current) renderNotes()
  updateThumbBadges()
}

function renderNotes () {
  const box = $('notes')
  const mine = state.notes.filter((n) => n.slideIndex === state.current)
  $('margin-sub').textContent = state.slides.length ? `for slide ${state.current + 1}` : 'for this slide'
  box.replaceChildren()
  if (!mine.length) {
    box.append(el('p', 'hint', state.slides.length
      ? 'Nothing yet. Notes appear here for things the lecturer says that are not on the slide.'
      : 'Sticky notes appear here for things the lecturer says that are not on the slide. Click one to save it.'))
    return
  }
  // lecturer explanations first, then newest AI notes first
  mine.sort((a, b) => (a.kind === 'lecturer' ? -1 : 0) - (b.kind === 'lecturer' ? -1 : 0) || b.createdAt - a.createdAt)
  for (const n of mine) box.append(stickyEl(n))
}

function stickyEl (n) {
  const saved = state.saved.has(n.id)
  const d = el('div', `sticky${n.kind === 'lecturer' ? ' lecturer' : ''}${saved ? ' saved' : ''}`)
  d.title = saved ? 'Saved to your notebook' : 'Click to save to your notebook'
  const kind = el('div', 'kind')
  kind.append(el('span', null, n.kind === 'lecturer' ? 'Lecturer explanation' : 'AI-generated'))
  kind.append(el('span', saved ? 'saved-tag' : null, saved ? '✓ saved' : 'click to save'))
  d.append(kind, el('div', 'text', n.text))
  const src = (n.sourceChunkIds || []).map((id) => state.chunks.get(id)?.text).filter(Boolean).join(' … ')
  if (src) d.append(el('div', 'src', `Heard: “${src}”`))
  d.addEventListener('click', () => saveNote(n))
  return d
}

function saveNote (n) {
  if (state.saved.has(n.id)) { toast('Already in your notebook'); return }
  state.saved.add(n.id)
  const sources = (n.sourceChunkIds || []).map((id) => state.chunks.get(id)).filter(Boolean)
  lec.emit('note:saved', {
    note: n,
    moduleId: state.moduleId,
    weekId: state.weekId,
    slide: { index: n.slideIndex, text: state.slides[n.slideIndex]?.text || '' },
    sources,
    savedAt: Date.now()
  })
  renderNotes()
  toast(`Saved to ${$('ctx-module').textContent} › ${$('ctx-week').textContent}`)
}

// ---------- transcript ----------
function onChunk (c) {
  if (!c || typeof c.text !== 'string') return
  state.chunks.set(c.id, c)
  const t = $('t-text')
  t.classList.remove('idle')
  t.textContent = c.text.trim() || '…'
}

// ---------- listening (live mic) ----------
async function toggleListen () {
  const btn = $('btn-listen')
  if (state.listening) {
    btn.disabled = true
    try {
      await state.mic?.stop()
      state.mic = null
      await lec.ai('flushAudio').catch(() => {})
    } finally {
      setListening(false)
      btn.disabled = false
    }
    return
  }
  btn.disabled = true
  try {
    const perm = await lec.requestMic()
    if (!perm.granted) { toast(perm.hint || 'Microphone access was denied.', { error: true, ms: 8000 }); return }
    const info = await lec.info()
    if (!info.aiLoaded) toast('AI is still loading; audio will be transcribed once it is ready.', { ms: 5000 })
    state.mic = await startMic((f32) => lec.ai('pushAudio', f32), {
      onLevel: (rms) => { $('meter-fill').style.width = `${Math.min(100, Math.round(rms * 400))}%` }
    })
    setListening(true)
  } catch (e) {
    console.error(e)
    toast(`Could not start the microphone: ${e.message || e}`, { error: true, ms: 7000 })
  } finally {
    btn.disabled = !state.slides.length
  }
}

function setListening (on) {
  state.listening = on
  const btn = $('btn-listen')
  btn.classList.toggle('listening', on)
  btn.querySelector('.label').textContent = on ? 'Stop listening' : 'Start listening'
  $('meter-fill').style.width = '0'
  if (!on && !state.chunks.size) { $('t-text').textContent = 'Not listening.'; $('t-text').classList.add('idle') } else if (on && !state.chunks.size) $('t-text').textContent = 'Listening…'
  lec.emit('listen:state', { listening: on })
}

// ---------- backup clip ----------
async function toggleClip () {
  const audio = $('clip-audio')
  if (state.clipPlaying) {
    audio.pause()
    await lec.ai('stopClip').catch(() => {})
    setClip(false)
    return
  }
  if (!state.slides.length) { toast('Load the slides first'); return }
  try {
    audio.src = 'app://lecscribe/fixtures/lecture.wav'
    audio.currentTime = 0
    const p = lec.ai('playClip', 'fixtures/lecture.wav', { realtime: true })
    await audio.play()
    setClip(true)
    p.catch((e) => { toast(`Clip failed: ${e.message || e}`, { error: true }); setClip(false) })
  } catch (e) {
    toast(`Could not play the clip: ${e.message || e}`, { error: true })
    setClip(false)
  }
}
function setClip (on) {
  state.clipPlaying = on
  $('btn-clip').textContent = on ? '■ Stop clip' : '▶ Clip'
}

// ---------- AI status ----------
function onAiStatus (s) {
  if (!s || !s.model) return
  state.ai[s.model] = s
  const box = $('ai-status')
  box.replaceChildren()
  const names = { stt: 'Speech', embed: 'Embeddings', llm: 'LLM', ocr: 'OCR' }
  for (const [m, st] of Object.entries(state.ai)) {
    const label = `${names[m] || m}${st.state === 'loading' && st.progress != null ? ` ${Math.round(st.progress)}%` : ''}${st.mock ? ' (mock)' : ''}`
    const c = el('span', `chip ${st.state}`, label)
    c.title = st.error || `${names[m] || m}: ${st.state}`
    box.append(c)
  }
  if (s.state === 'error') toast(`${names[s.model] || s.model}: ${s.error || 'error'}`, { error: true, ms: 7000 })
}

// ---------- wiring ----------
lec.on('slides:loaded', onSlidesLoaded)
lec.on('slide:changed', onSlideChanged)
lec.on('note:added', onNoteAdded)
lec.on('transcript:chunk', onChunk)
lec.on('ai:status', onAiStatus)
lec.on('lost:counts', (counts) => { state.lost = counts || {}; updateThumbBadges() })
lec.on('clip:ended', () => setClip(false))

$('btn-prev').addEventListener('click', () => go(state.current - 1))
$('btn-next').addEventListener('click', () => go(state.current + 1))
$('btn-listen').addEventListener('click', toggleListen)
$('btn-clip').addEventListener('click', toggleClip)
$('file-input').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]
  if (f) await openPdf(await f.arrayBuffer(), f.name)
  e.target.value = ''
})
$('btn-demo-deck').addEventListener('click', async () => {
  try {
    const r = await fetch('app://lecscribe/fixtures/deck.pdf')
    if (!r.ok) throw new Error(`fixtures/deck.pdf not found (${r.status})`)
    await openPdf(await r.arrayBuffer(), 'deck.pdf')
  } catch (e) { toast(e.message, { error: true }) }
})
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(state.current + 1) }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(state.current - 1) }
})

// for david's e2e tests / debugging in DevTools
window.__lecscribe = { state, go, openPdf }
