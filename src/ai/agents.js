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
        for (const text of parseNotes(out, o.maxNotes)) {
          if (isOnSlide(text, slides[i]?.text)) continue
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
    if (left !== current) schedule(left)
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

/** Drop notes that are basically a copy of slide text (spec: only what is NOT on the slide). */
export function isOnSlide (note, slideText) {
  if (!slideText) return false
  const words = (s) => String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []
  const nw = words(note)
  if (nw.length === 0) return true
  const sw = new Set(words(slideText))
  const overlap = nw.filter((w) => sw.has(w)).length / nw.length
  return overlap >= 0.85
}
