// Lecture view (owner: filip): slides x notes, transcript drawer, thumbnails, live mic, components.
import * as pdfjs from '../../node_modules/pdfjs-dist/build/pdf.mjs'
import { loadPdf } from '../../src/core/pdf.js'
import { startMic } from '../../src/ai/browser/mic-capture.js'
import { $, el, iconSvg, toast, debounce } from './dom.js'
import { mountComponent, fallbackRoomPanel, fallbackLostButton } from './components.js'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../node_modules/pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href

const AI_NAMES = { stt: 'Speech', embed: 'Embeddings', llm: 'LLM', ocr: 'OCR' }

export function createLectureView (app) {
  const lec = app.lec
  const state = app.state
  let handles = [] // component handles for this screen
  let micPicker = null
  let pendingChunks = []
  let replayCache = () => {}

  // ---------- open / close ----------
  async function open (lectureId, { role = 'host', fresh = false, title, jumpTo = null } = {}) {
    state.active = true
    state.pendingJump = Number.isInteger(jumpTo) ? jumpTo : null // Ask-across result: open at that slide
    state.role = role
    state.lectureId = lectureId || null
    state.lecture = null
    state.slides = []
    state.current = 0
    state.notes = []
    state.saved = new Set()
    state.chunks = new Map()
    state.lines = []
    state.lost = {}
    state.persistSlides = false
    state.heatmapMounted = false
    if (lectureId) {
      try { state.lecture = await app.store.getLecture(lectureId) } catch (e) { toast(`Could not open lecture: ${e.message || e}`, { error: true }) }
    }
    const L = state.lecture
    state.moduleId = L?.moduleId || app.libraryModuleId()
    const mod = app.moduleById(state.moduleId)
    $('crumb-module').textContent = mod?.name || (role === 'peer' ? 'Live room' : 'Library')
    $('crumb-lecture').textContent = L?.title || title || (role === 'peer' ? 'Joined session' : 'Lecture')
    $('role-badge').hidden = role !== 'peer'
    $('screen-lecture').classList.toggle('role-peer', role === 'peer')
    $('screen-lecture').classList.toggle('role-host', role !== 'peer')
    $('search-box').hidden = !lectureId

    // saved notes come back as saved stickies
    for (const n of L?.notes || []) { state.notes.push(n); state.saved.add(n.id) }
    for (const c of L?.transcript || []) addLine(c, false)
    summary.text = String(L?.summary || '')
    summary.busy = false
    renderSummary()
    renderTranscript()
    resetSlideUi(fresh)
    renderNotes()
    renderStrip()

    await mountScreenComponents()

    if (role === 'peer') replayCache()
    else if (L?.slides?.length) {
      // Re-publish the stored deck on the bus so the tracker / room / UI all see it.
      lec.emit('slides:loaded', L.slides.map((s, i) => ({ index: i, text: s.text || '', image: s.image || null })))
    }
  }

  async function close () {
    if (!state.active) return
    if (explain.recording) await stopExplain(true)
    explain.busy = false
    setExplainStatus('')
    if (state.listening) await toggleListen()
    if (state.clipPlaying) await toggleClip()
    await flushTranscript()
    if (state.role === 'peer') { try { await lec.p2p('leaveRoom') } catch {} }
    destroyComponents()
    $('search-input').value = ''
    $('search-results').hidden = true
    state.active = false
  }

  function resetSlideUi (fresh) {
    $('empty').hidden = false
    $('slide-img').hidden = true
    $('slide-text').hidden = true
    $('track-badge').hidden = true
    $('slide-count').textContent = ''
    $('btn-prev').disabled = true
    $('btn-next').disabled = true
    $('btn-listen').disabled = true
    if (state.role === 'peer') {
      $('empty-title').textContent = 'Waiting for the host…'
      $('empty-text').textContent = 'Slides and notes appear here as soon as the room sends them.'
    } else {
      $('empty-title').textContent = fresh ? 'Load the slides for this lecture' : 'No slides yet'
      $('empty-text').textContent = 'Open a PDF or use the demo deck. Everything runs on this laptop.'
    }
  }

  // ---------- components ----------
  function ctx () {
    return {
      role: state.role,
      moduleId: state.moduleId,
      lectureId: state.lectureId,
      lectureTitle: $('crumb-lecture').textContent,
      slideIndex: state.current,
      slideCount: state.slides.length
    }
  }
  const deps = (extra) => ({ lec, getContext: ctx, toast: (m) => toast(m), ...extra })

  async function mountScreenComponents () {
    destroyComponents()
    const host = state.role !== 'peer'
    const jobs = []
    if (state.lectureId) {
      jobs.push(mountComponent('share-lecture', $('mount-share-lecture'), deps({ mode: 'share', lectureId: state.lectureId, onImported: () => {} })))
    }
    if (host) {
      jobs.push(mountComponent('room-panel', $('mount-room-panel'), deps({
        getRoomOptions: () => ({ title: $('crumb-lecture').textContent || 'Lecture', moduleId: state.moduleId, weekId: state.lectureId })
      }), fallbackRoomPanel))
      jobs.push(mountComponent('heatmap', $('mount-heatmap'), deps({
        onSelect: (i) => go(i),
        slideCount: state.slides.length,
        showHeader: false
      })).then((h) => { state.heatmapMounted = !!h; updateThumbBadges(); return h }))
      try {
        micPicker = app.mountMicPicker?.($('mount-mic-picker'), { onChange: () => switchMic(), toast: (m) => toast(m) }) || null
      } catch (e) { console.error('mic picker failed to mount', e); micPicker = null }
    } else {
      jobs.push(mountComponent('lost-button', $('mount-lost-button'), deps({ getSlideIndex: () => state.current }), fallbackLostButton))
    }
    handles = (await Promise.all(jobs)).filter(Boolean)
  }

  function destroyComponents () {
    for (const h of handles) h?.destroy?.()
    handles = []
    try { micPicker?.destroy?.() } catch {}
    micPicker = null
    for (const id of ['mount-share-lecture', 'mount-room-panel', 'mount-heatmap', 'mount-lost-button', 'mount-mic-picker']) {
      const n = $(id)
      n.replaceChildren()
      n.className = n.className.split(' ').filter((c) => !c.startsWith('lec-')).join(' ')
    }
  }

  // ---------- slides ----------
  async function openPdf (bytes, name) {
    try {
      toast(`Loading ${name}…`, { ms: 60000 })
      const raw = await loadPdf(bytes, {
        pdfjs,
        renderImages: true,
        scale: 1.6,
        standardFontDataUrl: new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).href,
        cMapUrl: new URL('../../node_modules/pdfjs-dist/cmaps/', import.meta.url).href,
        onProgress: (d, n) => toast(`Rendering slide ${d} of ${n}…`, { ms: 60000 })
      })
      toast(`Reading slide text (${raw.length} slides)…`, { ms: 60000 })
      state.persistSlides = true
      await lec.processSlides(raw) // main OCRs image-only slides, then emits 'slides:loaded'
      toast(`Loaded ${raw.length} slides`)
    } catch (e) {
      console.error(e)
      state.persistSlides = false
      toast(`Could not load the PDF: ${e.message || e}`, { error: true, ms: 6000 })
    }
  }

  async function loadDemoDeck () {
    try {
      const r = await fetch('app://lecscribe/fixtures/deck.pdf')
      if (!r.ok) throw new Error(`fixtures/deck.pdf not found (${r.status})`)
      await openPdf(await r.arrayBuffer(), 'deck.pdf')
    } catch (e) { toast(e.message, { error: true }) }
  }

  function onSlidesLoaded (slides) {
    if (!state.active || !Array.isArray(slides)) return
    state.slides = slides
    state.current = 0
    state.lost = {}
    // keep saved notes; drop unsaved live notes from a previous deck
    state.notes = state.notes.filter((n) => state.saved.has(n.id))
    $('empty').hidden = true
    if (state.role !== 'peer') { $('btn-listen').disabled = false; $('btn-listen').title = 'Listen through the selected microphone' }
    renderStrip()
    renderSlide()
    renderNotes()
    refreshExplain()
    if (state.pendingJump != null) {
      const j = state.pendingJump
      state.pendingJump = null
      if (j > 0 && j < slides.length) go(j, 'manual')
    }
    if (state.persistSlides && state.lectureId) {
      state.persistSlides = false
      app.store.saveSlides(state.lectureId, slides).then(() => app.libraryChanged()).catch((e) => console.warn('saveSlides failed', e))
    }
  }

  function go (index, source = 'manual') {
    if (!state.slides.length) return
    const i = Math.max(0, Math.min(state.slides.length - 1, index))
    if (i === state.current && source === 'manual') return
    if (state.role === 'peer') { // peers browse locally; the host drives the room
      onSlideChanged({ index: i, source: 'manual' })
      return
    }
    lec.emit('slide:changed', { index: i, source })
  }

  function onSlideChanged ({ index, source, confidence } = {}) {
    if (!state.active || !Number.isInteger(index) || !state.slides[index]) return
    if (explain.recording && index !== explain.slide) stopExplain(false) // spec: moving on ends the recording
    state.current = index
    const b = $('track-badge')
    b.hidden = false
    b.className = `track-badge ${source === 'auto' ? 'auto' : source === 'remote' ? 'remote' : 'manual'}`
    b.textContent = source === 'auto'
      ? `Auto${typeof confidence === 'number' ? ` · ${Math.round(confidence * 100)}%` : ''}`
      : source === 'remote' ? 'Following host' : 'Manual'
    renderSlide()
    renderNotes()
    markActiveThumb()
    refreshExplain()
  }

  function renderSlide () {
    const s = state.slides[state.current]
    const img = $('slide-img')
    const txt = $('slide-text')
    if (!s) return
    if (s.image) {
      if (img.src !== s.image) img.src = s.image
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
    const strip = $('lec-strip')
    strip.replaceChildren()
    for (const s of state.slides) {
      const b = el('button', 'lec-thumb')
      b.type = 'button'
      b.dataset.index = s.index
      b.title = (s.text || '').split('\n')[0] || `Slide ${s.index + 1}`
      if (s.image) { const im = el('img'); im.src = s.image; im.alt = ''; im.loading = 'lazy'; b.append(im) } else b.append(el('div', 'thumb-text', (s.text || '').split('\n')[0] || ''))
      b.append(el('span', 'thumb-heat'), el('span', 'thumb-num', String(s.index + 1)))
      const nc = el('span', 'thumb-notes')
      nc.hidden = true
      b.append(nc)
      b.addEventListener('click', () => go(s.index, 'manual'))
      strip.append(b)
    }
    markActiveThumb()
    updateThumbBadges()
  }

  function markActiveThumb () {
    for (const t of document.querySelectorAll('#lec-strip .lec-thumb')) {
      const on = Number(t.dataset.index) === state.current
      t.classList.toggle('active', on)
      if (on) t.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    }
  }

  function updateThumbBadges () {
    const max = Math.max(1, ...Object.values(state.lost))
    for (const t of document.querySelectorAll('#lec-strip .lec-thumb')) {
      const i = Number(t.dataset.index)
      const n = state.notes.filter((x) => x.slideIndex === i).length
      const nc = t.querySelector('.thumb-notes')
      nc.hidden = n === 0
      nc.textContent = String(n)
      nc.title = `${n} note${n === 1 ? '' : 's'}`
      const lost = state.lost[i] || 0
      const heat = t.querySelector('.thumb-heat')
      // built-in heat bar only if aaron's heatmap component is not mounted
      heat.style.opacity = !state.heatmapMounted && lost ? String(0.3 + 0.7 * (lost / max)) : '0'
      heat.title = lost ? `${lost} lost` : ''
    }
  }

  // ---------- notes ----------
  function onNoteAdded (note) {
    if (!state.active || !note || typeof note.id !== 'string') return
    if (state.notes.some((n) => n.id === note.id)) return
    state.notes.push(note)
    if (note.slideIndex === state.current) renderNotes()
    updateThumbBadges()
  }

  function renderNotes () {
    const box = $('notes')
    const mine = state.notes.filter((n) => n.slideIndex === state.current)
    $('notes-sub').textContent = state.slides.length ? `Slide ${state.current + 1}` : ''
    box.replaceChildren()
    if (!mine.length) {
      const e = el('div', 'notes-empty')
      e.append(el('p', null, state.slides.length
        ? 'Nothing yet for this slide.'
        : 'Notes appear here while the lecture runs.'))
      e.append(el('p', 'muted', 'LecScribe writes a sticky note when the lecturer says something that is not on the slide. Click a note to save it.'))
      box.append(e)
      return
    }
    mine.sort((a, b) => (a.kind === 'lecturer' ? -1 : 0) - (b.kind === 'lecturer' ? -1 : 0) || (b.createdAt || 0) - (a.createdAt || 0))
    for (const n of mine) box.append(stickyEl(n))
  }

  function stickyEl (n) {
    const saved = state.saved.has(n.id)
    const d = el('button', `sticky ${n.kind === 'lecturer' ? 'lecturer' : 'ai'}${saved ? ' saved' : ''}`)
    d.type = 'button'
    d.title = saved ? 'Saved. Click to remove from your notes.' : 'Click to save to your notes'
    const top = el('div', 'sticky-top')
    const kind = el('span', 'sticky-kind', n.kind === 'lecturer' ? 'Lecturer explanation' : 'AI-generated')
    if (n.emphasis === 'exam') {
      const b = el('span', 'exam-badge', 'Exam')
      b.title = 'The lecturer flagged this as likely to come up in the exam'
      kind.append(b)
    }
    top.append(kind)
    const st = el('span', 'sticky-state')
    st.innerHTML = saved ? `${iconSvg('check', 12)}<span>Saved</span>` : `${iconSvg('bookmark', 12)}<span>Save</span>`
    top.append(st)
    d.append(top, el('div', 'sticky-text', n.text))
    const src = (n.sourceChunkIds || []).map((id) => state.chunks.get(id)?.text).filter(Boolean).join(' … ')
    if (src) d.append(el('div', 'sticky-src', `Heard: “${src}”`))
    d.addEventListener('click', () => toggleSave(n))
    return d
  }

  async function toggleSave (n) {
    if (state.saved.has(n.id)) {
      state.saved.delete(n.id)
      renderNotes()
      if (state.lectureId) app.store.unsaveNote(state.lectureId, n.id).then(() => app.libraryChanged()).catch(() => {})
      toast('Removed from your notes')
      return
    }
    state.saved.add(n.id)
    const sources = (n.sourceChunkIds || []).map((id) => state.chunks.get(id)).filter(Boolean)
    lec.emit('note:saved', {
      note: n,
      moduleId: state.moduleId,
      weekId: state.lectureId,
      lectureId: state.lectureId,
      slide: { index: n.slideIndex, text: state.slides[n.slideIndex]?.text || '' },
      sources,
      savedAt: Date.now()
    })
    renderNotes()
    updateThumbBadges()
    if (state.lectureId) {
      try {
        await app.store.saveNote(state.lectureId, { ...n, savedAt: Date.now() })
        app.libraryChanged()
        toast(`Saved to ${$('crumb-lecture').textContent}`)
      } catch (e) {
        toast(`Could not save the note: ${e.message || e}`, { error: true })
      }
    } else toast('Saved')
  }

  // ---------- transcript ----------
  function addLine (c, live = true) {
    if (!c || typeof c.text !== 'string' || !c.text.trim()) return
    if (state.chunks.has(c.id)) return
    state.chunks.set(c.id, c)
    state.lines.push(c)
    if (state.lines.length > 200) state.lines.shift()
    if (live) {
      pendingChunks.push(c)
      scheduleFlush()
    }
  }

  function onChunk (c) {
    if (!state.active) return
    addLine(c, true)
    // B-008: a final for segment N can arrive after segment N+1's partials began. Only clear the
    // grey line if the partial belongs to this (or an earlier) segment.
    const p = lastPartial
    if (!p || typeof p.tStart !== 'number' || typeof c?.tEnd !== 'number' || p.tStart < c.tEnd) {
      $('t-partial').textContent = ''
      lastPartial = null
    }
    renderTranscript()
  }

  let lastPartial = null
  function onPartial (p) {
    if (!state.active) return
    lastPartial = typeof p === 'object' ? p : null
    const text = typeof p === 'string' ? p : p?.text
    $('t-partial').textContent = text || ''
    if (text) $('t-last').textContent = text
    $('t-last').classList.toggle('partial', !!text)
  }

  function renderTranscript () {
    const lines = $('t-lines')
    lines.replaceChildren()
    for (const c of state.lines.slice(-60)) {
      const row = el('div', 't-line')
      row.append(el('span', 't-slide', Number.isInteger(c.slideIndex) ? String(c.slideIndex + 1) : ''), el('span', 't-text', c.text.trim()))
      lines.append(row)
    }
    const last = state.lines[state.lines.length - 1]
    const lastEl = $('t-last')
    lastEl.classList.remove('partial')
    lastEl.textContent = last ? last.text.trim() : (state.listening ? 'Listening…' : 'Not listening')
    lastEl.classList.toggle('idle', !last)
    const body = $('transcript-body')
    body.scrollTop = body.scrollHeight
  }

  const scheduleFlush = debounce(() => flushTranscript(), 1500)
  async function flushTranscript () {
    if (!pendingChunks.length || !state.lectureId || state.sessionActive) { pendingChunks = []; return }
    const batch = pendingChunks
    pendingChunks = []
    try { await app.store.appendTranscript(state.lectureId, batch) } catch (e) { console.warn('appendTranscript failed', e) }
  }

  // ---------- listening (live mic) ----------
  async function openMic () {
    // While an explanation is recording, the live mic feeds the separate explain buffer instead.
    state.mic = await startMic((f32) => lec.ai(explain.recording ? 'pushExplainAudio' : 'pushAudio', f32), {
      deviceId: micPicker?.getDeviceId?.() || undefined,
      onLevel: (rms) => micPicker?.setLevel?.(rms)
    })
  }

  // ---------- Lecture summary (PLAN 'NEXT FOR FILIP' #2) ----------
  const summary = { text: '', busy: false }

  function renderSummary () {
    const card = $('summary-card')
    const live = state.listening
    const canWrite = state.role !== 'peer' && state.lines.length > 0 && !summary.busy
    card.hidden = live || state.role === 'peer' || (!summary.text && !summary.busy && !canWrite)
    $('summary-text').textContent = summary.text
    const st = $('summary-state')
    st.textContent = summary.busy ? 'Writing on this laptop…' : summary.text ? 'AI-generated' : ''
    st.classList.toggle('busy', summary.busy)
    const btn = $('btn-summarise')
    btn.hidden = !canWrite
    btn.textContent = summary.text ? 'Rewrite summary' : 'Write summary'
  }

  /** Summarise the transcript with the local LLM and store it on the lecture. */
  async function writeSummary () {
    if (summary.busy || state.role === 'peer') return
    const chunks = state.lines.map((c) => ({ id: c.id, slideIndex: c.slideIndex, tStart: c.tStart, tEnd: c.tEnd, text: c.text }))
    if (!chunks.length) return
    summary.busy = true
    renderSummary()
    const lectureId = state.lectureId
    try {
      const slides = state.slides.map((s) => ({ index: s.index, text: s.text || '' })) // no images over IPC
      const text = String(await lec.ai('summariseLecture', chunks, slides) || '').trim()
      if (!text) throw new Error('the model returned an empty summary')
      if (lectureId !== state.lectureId) return // user opened another lecture meanwhile
      summary.text = text
      if (lectureId) {
        try { await app.store.setSummary(lectureId, text); app.libraryChanged() } catch (e) { console.warn('setSummary failed', e) }
      }
    } catch (e) {
      toast(`Could not write the summary: ${e.message || e}`, { error: true, ms: 6000 })
    } finally {
      summary.busy = false
      renderSummary()
    }
  }

  // ---------- Explain slide (stage 7, aryan's contract stage-7-ai.md) ----------
  const explain = { recording: false, slide: null, ownMic: null, busy: false }

  function refreshExplain () {
    const bar = $('explain-bar')
    bar.hidden = state.role === 'peer' || !state.slides.length
    const btn = $('btn-explain')
    const lost = Number(state.lost?.[state.current]) || 0
    btn.classList.toggle('recording', explain.recording)
    btn.classList.toggle('hot', !explain.recording && lost > 0)
    btn.disabled = explain.busy && !explain.recording
    btn.querySelector('.label').textContent = explain.recording
      ? 'Done'
      : lost > 0 ? `Explain slide · ${lost} lost` : 'Explain slide'
  }

  function setExplainStatus (text, busy = false) {
    const s = $('explain-status')
    s.hidden = !text
    s.textContent = text || ''
    s.classList.toggle('busy', busy)
  }

  async function startExplain () {
    if (explain.recording || explain.busy || state.role === 'peer' || !state.slides.length) return
    try {
      const perm = await lec.requestMic()
      if (!perm.granted) { toast(perm.hint || 'Microphone access was denied.', { error: true, ms: 8000 }); return }
      explain.recording = true
      explain.slide = state.current
      lec.emit('explain:start', { slideIndex: explain.slide })
      // Not listening? Open a mic just for the explanation (otherwise the live mic is rerouted).
      if (!state.listening) {
        explain.ownMic = await startMic((f32) => lec.ai('pushExplainAudio', f32), {
          deviceId: micPicker?.getDeviceId?.() || undefined,
          onLevel: (rms) => micPicker?.setLevel?.(rms)
        })
      }
      setExplainStatus(`Recording an explanation for slide ${explain.slide + 1}…`)
    } catch (e) {
      explain.recording = false
      toast(`Could not start recording: ${e.message || e}`, { error: true })
      setExplainStatus('')
    }
    refreshExplain()
  }

  /** @param {boolean} emitDone  false when the slide changed (the AI stops on slide:changed by itself) */
  async function stopExplain (emitDone = true) {
    if (!explain.recording) return
    explain.recording = false
    explain.busy = true
    const slideIndex = explain.slide
    try { await explain.ownMic?.stop() } catch {}
    explain.ownMic = null
    if (emitDone) lec.emit('explain:done', { slideIndex })
    setExplainStatus('Transcribing the explanation…', true)
    refreshExplain()
  }

  function onExplainStatus ({ slideIndex, state: st, error } = {}) {
    if (!state.active) return
    const n = (Number.isInteger(slideIndex) ? slideIndex : explain.slide ?? state.current) + 1
    if (st === 'recording') { setExplainStatus(`Recording an explanation for slide ${n}…`); return }
    if (st === 'transcribing') { explain.busy = true; setExplainStatus('Transcribing the explanation…', true) }
    if (st === 'summarising') { explain.busy = true; setExplainStatus('Summarising in plain language…', true) }
    if (st === 'done') { explain.busy = false; setExplainStatus(''); toast(`Lecturer explanation pinned to slide ${n}`) }
    if (st === 'error') { explain.busy = false; explain.recording = false; setExplainStatus(''); toast(`Explain slide failed: ${error || 'unknown error'}`, { error: true, ms: 7000 }) }
    refreshExplain()
  }

  /** Demo fallback (Shift+L): 3 "I'm lost" taps on the current slide, via the room if one is open, else locally. */
  async function simulateLost () {
    if (state.role === 'peer' || !state.slides.length) return
    const i = state.current
    try {
      await lec.p2p('simulateLost', i, 3) // room merges and emits lost:counts
    } catch {
      // No live room (e.g. offline demo): bump the counts on the bus so heatmap + Explain button light up.
      lec.emit('lost:counts', { ...state.lost, [i]: (Number(state.lost?.[i]) || 0) + 3 })
    }
  }

  /** Demo fallback (Shift+E): explain the current slide from fixtures/explain.wav. */
  async function explainFromFile () {
    if (state.role === 'peer' || !state.slides.length || explain.busy || explain.recording) return
    explain.busy = true
    explain.slide = state.current
    setExplainStatus('Transcribing the explanation…', true)
    refreshExplain()
    try {
      await lec.ai('explainFromFile', state.current, 'fixtures/explain.wav')
    } catch (e) {
      explain.busy = false
      setExplainStatus('')
      toast(`Explain from file failed: ${e.message || e}`, { error: true })
      refreshExplain()
    }
  }

  async function switchMic () {
    if (!state.listening) return
    try {
      await state.mic?.stop()
      await openMic()
      toast('Switched microphone')
    } catch (e) {
      toast(`Could not switch microphone: ${e.message || e}`, { error: true })
    }
  }

  async function toggleListen () {
    const btn = $('btn-listen')
    if (state.listening) {
      btn.disabled = true
      try {
        await state.mic?.stop()
        state.mic = null
        await lec.ai('flushAudio').catch(() => {})
        await flushTranscript().catch(() => {})
        if (state.sessionActive) { await app.store.endSession().catch(() => {}); state.sessionActive = false; app.libraryChanged() }
      } finally {
        setListening(false)
        btn.disabled = !state.slides.length
      }
      // Ending the session writes the lecture summary in the background.
      if (state.active && state.lines.length) writeSummary()
      return
    }
    btn.disabled = true
    try {
      const perm = await lec.requestMic()
      if (!perm.granted) { toast(perm.hint || 'Microphone access was denied.', { error: true, ms: 8000 }); return }
      const info = await lec.info()
      if (!info.aiLoaded) toast('The AI is still loading. Speech is transcribed once it is ready.', { ms: 5000 })
      await openMic()
      if (state.lectureId && app.store.persistent) {
        try { await app.store.startSession(state.lectureId); state.sessionActive = true } catch (e) { console.warn('startSession failed', e) }
      }
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
    btn.classList.toggle('on', on)
    btn.querySelector('.label').textContent = on ? 'Stop listening' : 'Start listening'
    $('transcript').classList.toggle('live', on)
    renderTranscript()
    renderSummary()
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
    const b = $('btn-clip')
    b.querySelector('.ico')?.remove()
    b.insertAdjacentHTML('afterbegin', iconSvg(on ? 'stop' : 'play'))
    b.querySelector('.label').textContent = on ? 'Stop clip' : 'Play clip'
  }

  // ---------- AI status ----------
  function onAiStatus (s) {
    if (!s || !s.model) return
    state.ai[s.model] = s
    const box = $('ai-status')
    box.replaceChildren()
    for (const [m, st] of Object.entries(state.ai)) {
      const label = `${AI_NAMES[m] || m}${st.state === 'loading' && st.progress != null ? ` ${Math.round(st.progress)}%` : ''}`
      const c = el('span', `chip ${st.state}`)
      c.append(el('span', 'chip-dot'), el('span', null, label))
      c.title = st.error || `${AI_NAMES[m] || m}: ${st.state}${st.mock ? ' (mock)' : ''}`
      box.append(c)
    }
    if (s.state === 'error' && state.active) toast(`${AI_NAMES[s.model] || s.model}: ${s.error || 'error'}`, { error: true, ms: 7000 })
  }

  // ---------- search ----------
  const runSearch = debounce(async () => {
    const q = $('search-input').value.trim()
    const box = $('search-results')
    if (!q || !state.lectureId) { box.hidden = true; return }
    let hits = []
    try { hits = await app.store.search(state.lectureId, q, 6) } catch (e) { console.warn('search failed', e) }
    box.replaceChildren()
    if (!hits.length) {
      box.append(el('div', 'sr-empty', 'No matches in this lecture'))
    } else {
      for (const h of hits) {
        const r = el('button', 'sr-item')
        r.type = 'button'
        const kind = { note: 'Note', transcript: 'Transcript', summary: 'Summary', slide: 'Slide' }[h.kind] || h.kind
        r.append(el('span', 'sr-kind', `${kind}${Number.isInteger(h.slideIndex) ? ` · slide ${h.slideIndex + 1}` : ''}`), el('span', 'sr-text', h.text))
        r.addEventListener('click', () => { box.hidden = true; if (Number.isInteger(h.slideIndex)) go(h.slideIndex, 'manual') })
        box.append(r)
      }
    }
    box.hidden = false
  }, 250)

  // ---------- wiring (once) ----------
  // Remember the latest room/deck state even while no lecture is open, so a peer view opened right
  // after joinRoom() can replay what already arrived.
  const cache = { slides: null, change: null, notes: [] }
  lec.on('slides:loaded', (s) => { cache.slides = s; cache.change = null; cache.notes = [] })
  lec.on('slide:changed', (c) => { cache.change = c })
  lec.on('note:added', (n) => { cache.notes.push(n) })
  replayCache = () => {
    if (!cache.slides) return
    onSlidesLoaded(cache.slides)
    for (const n of cache.notes) onNoteAdded(n)
    if (cache.change) onSlideChanged(cache.change)
  }
  lec.on('slides:loaded', onSlidesLoaded)
  lec.on('slide:changed', onSlideChanged)
  lec.on('note:added', onNoteAdded)
  lec.on('transcript:chunk', onChunk)
  lec.on('transcript:partial', onPartial)
  lec.on('ai:status', onAiStatus)
  lec.on('lost:counts', (counts) => {
    state.lost = counts || {}
    document.querySelector('.strip-wrap')?.classList.toggle('has-heat', Object.values(state.lost).some((n) => Number(n) > 0))
    if (state.active) { updateThumbBadges(); refreshExplain() }
  })
  lec.on('explain:status', onExplainStatus)
  $('btn-summarise').addEventListener('click', () => writeSummary())
  $('btn-explain').addEventListener('click', () => (explain.recording ? stopExplain(true) : startExplain()))
  // aaron PR #33: show reconnecting while the swarm restarts after a network change
  lec.on('p2p:status', (s) => {
    if (s?.role !== 'host') return
    const btn = $('btn-room-pop')
    const reconnecting = (s.state === 'starting' || s.state === 'connecting') && !!s.reason
    btn.classList.toggle('reconnecting', reconnecting)
    if (reconnecting) btn.lastChild.textContent = 'Reconnecting…'
    else if (btn.lastChild.textContent === 'Reconnecting…') btn.lastChild.textContent = 'Live session'
  })
  window.addEventListener('online', () => { lec.p2p('refreshNetwork').catch(() => {}) })
  lec.on('clip:ended', () => setClip(false))
  lec.on('room:ended', () => { if (state.role === 'peer') toast('The host ended the room') })

  $('btn-prev').addEventListener('click', () => go(state.current - 1))
  $('btn-next').addEventListener('click', () => go(state.current + 1))
  $('btn-listen').addEventListener('click', toggleListen)
  $('btn-clip').addEventListener('click', toggleClip)
  for (const id of ['file-input', 'file-input-2']) {
    $(id).addEventListener('change', async (e) => {
      const f = e.target.files?.[0]
      if (f) await openPdf(await f.arrayBuffer(), f.name)
      e.target.value = ''
    })
  }
  $('btn-demo-deck').addEventListener('click', loadDemoDeck)
  $('btn-demo-deck-2').addEventListener('click', loadDemoDeck)
  $('transcript-toggle').addEventListener('click', () => {
    const open = $('transcript').classList.toggle('open')
    $('transcript-toggle').setAttribute('aria-expanded', String(open))
    if (open) $('transcript-body').scrollTop = $('transcript-body').scrollHeight
  })
  // header popovers: Share notes (aaron's share-lecture) and Live session (aaron's room-panel)
  const pops = [['btn-share-pop', 'pop-share'], ['btn-room-pop', 'pop-room']]
  const closePops = (except) => {
    for (const [b, p] of pops) if (p !== except) { $(p).hidden = true; $(b).setAttribute('aria-expanded', 'false') }
  }
  for (const [b, p] of pops) {
    $(b).addEventListener('click', (e) => {
      e.stopPropagation()
      const opening = $(p).hidden
      closePops(p)
      $(p).hidden = !opening
      $(b).setAttribute('aria-expanded', String(opening))
    })
    $(p).addEventListener('click', (e) => e.stopPropagation())
  }
  document.addEventListener('click', () => closePops())
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePops() })
  lec.on('p2p:status', (s) => { if (s?.role === 'host') $('room-live-dot').classList.toggle('on', s.state === 'open') })
  lec.on('p2p:peers', (p) => {
    const n = Number(p?.count) || 0
    $('btn-room-pop').lastChild.textContent = n ? `Live · ${n} ${n === 1 ? 'peer' : 'peers'}` : 'Live session'
  })

  $('search-input').addEventListener('input', runSearch)
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.target.value = ''; $('search-results').hidden = true } })
  document.addEventListener('click', (e) => { if (!$('search-box').contains(e.target)) $('search-results').hidden = true })
  document.addEventListener('keydown', (e) => {
    if (!state.active || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(state.current + 1) }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(state.current - 1) }
    if (e.key === 'E' && e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); explainFromFile() } // demo fallback
    if (e.key === 'L' && e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); simulateLost() } // demo fallback
  })

  return { open, close, go, openPdf, loadDemoDeck }
}
