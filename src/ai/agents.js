// S4: per-slide summariser agents → 'note:added' (kind 'ai'). Owner: aryan.
// One logical agent per slide; all LLM work goes through one serial queue so it never
// blocks STT or tracking.
import { config } from './config.js'
import { stickyPrompt } from './prompts.js'
import { parseNotes } from './llm.js'

let noteN = 0
export const newNoteId = () => `n-${Date.now().toString(36)}-${++noteN}`

/**
 * @param {object} o
 * @param {{on,off,emit}} o.bus
 * @param {(messages)=>Promise<string>} o.complete  LLM call
 * @param {object} [o.opts]
 */
export function createSummariser ({ bus, complete, opts = {} }) {
  const o = { ...config.agents, ...opts }
  let slides = []
  let current = 0
  const agents = new Map() // slideIndex -> { pending: chunk[], lastRun, notes: string[] }
  let queue = Promise.resolve()
  let generation = 0 // bumps on slides:loaded so stale jobs are dropped

  const agent = (i) => {
    if (!agents.has(i)) agents.set(i, { pending: [], lastRun: 0, notes: [], queued: false })
    return agents.get(i)
  }

  const schedule = (i) => {
    const a = agent(i)
    if (a.queued || a.pending.length === 0) return
    a.queued = true
    const gen = generation
    bus.emit('agent:status', { slideIndex: i, state: 'queued' })
    queue = queue.then(async () => {
      a.queued = false
      if (gen !== generation) return
      const chunks = a.pending.splice(0)
      if (!chunks.length) return
      a.lastRun = Date.now()
      bus.emit('agent:status', { slideIndex: i, state: 'running' })
      try {
        const out = await complete(stickyPrompt({
          slideText: slides[i]?.text || '',
          transcript: chunks.map((c) => c.text).join(' '),
          max: o.maxNotes,
          already: a.notes
        }))
        if (gen !== generation) return
        const said = chunks.map((c) => c.text).join(' ')
        for (const raw of parseNotes(out, o.maxNotes)) {
          const text = tidyNote(raw)
          if (!text) continue
          // B-005: drop paraphrases of the slide and anything not grounded in what was said.
          if (isOnSlide(text, slides[i]?.text, o.onSlideOverlap)) continue
          if (grounding(text, said, slides[i]?.text) < o.minGrounding) continue
          if (a.notes.some((n) => similar(n, text))) continue
          a.notes.push(text)
          bus.emit('note:added', {
            id: newNoteId(),
            slideIndex: i,
            kind: 'ai',
            text,
            sourceChunkIds: chunks.map((c) => c.id),
            createdAt: Date.now()
          })
        }
        bus.emit('agent:status', { slideIndex: i, state: 'done' })
      } catch (e) {
        console.error('[ai/agents] summarise failed', e)
        bus.emit('agent:status', { slideIndex: i, state: 'error', error: String(e?.message || e) })
      }
    })
  }

  const onSlides = (s) => { slides = s || []; current = 0; agents.clear(); generation++ }
  const onChunk = (c) => {
    const i = typeof c.slideIndex === 'number' ? c.slideIndex : current
    const a = agent(i)
    a.pending.push(c)
    const chars = a.pending.reduce((n, x) => n + (x.text?.length || 0), 0)
    if (chars >= o.minNewChars && Date.now() - a.lastRun >= o.minIntervalMs) schedule(i)
  }
  const onChanged = (ev) => {
    if (!ev || typeof ev.index !== 'number') return
    const left = current
    current = ev.index
    if (left === current) return
    // The chunk that triggered an auto-advance was spoken about the NEW slide: move it over.
    if (ev.chunkId && agents.has(left)) {
      const from = agent(left).pending
      const k = from.findIndex((c) => c.id === ev.chunkId)
      if (k >= 0) agent(current).pending.push(...from.splice(k).map((c) => ({ ...c, slideIndex: current })))
    }
    schedule(left)
  }

  bus.on('slides:loaded', onSlides)
  bus.on('transcript:chunk', onChunk)
  bus.on('slide:changed', onChanged)
  return {
    /** Force-summarise everything still pending (e.g. at the end of the clip). */
    flush () { for (const i of agents.keys()) schedule(i); return queue },
    idle: () => queue,
    dispose () {
      bus.off('slides:loaded', onSlides)
      bus.off('transcript:chunk', onChunk)
      bus.off('slide:changed', onChanged)
    }
  }
}

// ---- B-005 note filters (content words only; light stemming so "probes" ~ "probing") ----
const STOP = new Set(('the a an and or of to in on for is are was were be been being this that these those it its with as at by ' +
  'from we you they i he she so but not can will just like also than then there their them our your which what when where ' +
  'how why who all any each more most some such into over under about very too only one two use used uses using do does did ' +
  'lecturer said says explained mentioned noted note notes slide important remember point key really').split(' '))

export function contentWords (s) {
  return (String(s || '').toLowerCase()
    .replace(/\bo\(\s*([^)]{1,12})\)/g, (_, x) => ' bigo' + x.replace(/[^a-z0-9]/g, '') + ' ') // O(n) -> bigon
    .match(/[a-z0-9]+(?:'[a-z]+)?/g) || [])
    .map((w) => w.replace(/'s$/, ''))
    .filter((w) => (w.length > 2 || /\d/.test(w)) && !STOP.has(w))
    .map(stem)
}
const stem = (w) => (/^\d+$/.test(w) ? w : w.replace(/(ing|ed|es|s|e)$/, '')).slice(0, 5)
const isNum = (w) => /^\d+$/.test(w)

/** Share of the note's content words that are already on the slide. */
export function slideOverlap (note, slideText) {
  const nw = contentWords(note)
  if (!nw.length) return 1
  const sw = new Set(contentWords(slideText))
  return nw.filter((w) => sw.has(w)).length / nw.length
}

/**
 * Is the note a copy/paraphrase of the slide? (spec: notes are only for what is NOT on the slide)
 * Drops when: < 2 new content words, OR >= 70% of its words are on the slide, OR it covers
 * >= 60% of one slide line while adding at most 2 new words.
 */
export function isOnSlide (note, slideText, maxOverlap = 0.7) {
  const nw = contentWords(note)
  if (nw.length === 0) return true
  if (!slideText) return false
  const sw = new Set(contentWords(slideText))
  const novel = new Set(nw.filter((w) => !sw.has(w))).size
  if (novel < 2) return true
  if (slideOverlap(note, slideText) >= maxOverlap) return true
  const ns = new Set(nw)
  for (const line of String(slideText).split(/\n+/)) {
    const lw = [...new Set(contentWords(line))]
    if (lw.length < 2) continue
    const cov = lw.filter((w) => ns.has(w)).length / lw.length
    if (cov >= 0.6 && novel <= 2) return true
  }
  return false
}

/**
 * Anti-hallucination: share of the note's NEW words (not on the slide, not numbers, which are
 * spoken as words) that the lecturer actually said.
 */
export function grounding (note, said, slideText = '') {
  const sw = new Set(contentWords(slideText))
  const nw = contentWords(note).filter((w) => !sw.has(w) && !isNum(w))
  if (!nw.length) return 1
  const tw = new Set(contentWords(said))
  return nw.filter((w) => tw.has(w)).length / nw.length
}

function similar (a, b) {
  const A = new Set(contentWords(a)); const B = contentWords(b)
  if (!B.length) return true
  return B.filter((w) => A.has(w)).length / B.length >= 0.7
}

/** Strip "The lecturer explained that ..." style prefixes; capitalise. */
export function tidyNote (t) {
  let s = String(t || '').trim()
    .replace(/^(note:\s*)/i, '')
    .replace(/^(the\s+)?(lecturer|professor|speaker|they|he|she)\s+(also\s+)?(said|says|explained|explains|mentioned|mentions|noted|notes|pointed out|emphasi[sz]ed|stressed|highlighted)\s+(that\s+)?/i, '')
    .replace(/^(it\s+was\s+(mentioned|noted|explained)\s+that\s+)/i, '')
    .trim()
  if (!s) return ''
  s = s[0].toUpperCase() + s.slice(1)
  return s
}
