// Library access for the UI (owner: filip). Uses aaron's src/library via window.lec.library when it
// is loaded; otherwise an in-memory demo library with the same method names, so the UI always works.

/**
 * Returns a store that uses the real library when it is up. main.js starts the library after the
 * AI, which can take a while with real models, so until then the in-memory demo library answers and
 * we keep probing; `onReady()` fires once when the real library takes over (the UI re-renders).
 */
export async function createStore (lec, { onReady, waitMs = 180000 } = {}) {
  const memory = memoryStore()
  if (typeof lec?.library !== 'function') return memory
  const real = realStore(lec)
  const probe = async () => { await lec.library('listModules'); return true }
  try {
    await probe()
    return real
  } catch (e) {
    if (!/not loaded/i.test(String(e?.message || e))) {
      console.warn('[store] library unavailable, using in-memory demo library:', e?.message || e)
      return memory
    }
  }
  // Library not started yet: answer from memory, switch over when it appears.
  let current = memory
  const t0 = Date.now()
  const timer = setInterval(async () => {
    if (Date.now() - t0 > waitMs) { clearInterval(timer); return }
    try {
      await probe()
      clearInterval(timer)
      current = real
      onReady?.()
    } catch {}
  }, 1000)
  return new Proxy({}, {
    get (_t, prop) {
      const v = current[prop]
      return typeof v === 'function' ? v.bind(current) : v
    }
  })
}

function realStore (lec) {
  const call = (m, ...a) => lec.library(m, ...a)
  return {
    persistent: true,
    listModules: () => call('listModules'),
    createModule: (o) => call('createModule', o),
    listLectures: (id) => call('listLectures', id),
    createLecture: (mid, o) => call('createLecture', mid, o),
    updateLecture: (id, o) => call('updateLecture', id, o),
    getLecture: (id) => call('getLecture', id),
    saveSlides: (id, s) => call('saveSlides', id, s),
    saveNote: (id, n) => call('saveNote', id, n),
    unsaveNote: (id, nid) => call('unsaveNote', id, nid),
    appendTranscript: (id, c) => call('appendTranscript', id, c),
    setSummary: (id, text) => call('setSummary', id, text),
    // H-2 (stage-5-library v1.2). Until aaron's implementation lands, fall back to saveNote with the flag.
    setNoteImportant: async (id, noteId, important = true, note) => {
      try { return await call('setNoteImportant', id, noteId, important, note) } catch (e) {
        if (!/not implemented/i.test(String(e?.message || e)) || !note) throw e
        return call('saveNote', id, { ...note, important, importantAt: important ? Date.now() : null })
      }
    },
    listImportant: async (moduleId) => {
      try { return await call('listImportant', moduleId) } catch (e) { if (/not implemented/i.test(String(e?.message || e))) return []; throw e }
    },
    search: (id, q, k) => call('search', id, q, k),
    searchAll: (q, k) => call('searchAll', q, k),
    startSession: (id) => call('startSession', id),
    endSession: () => call('endSession')
  }
}

function memoryStore () {
  let n = 0
  const id = (p) => `${p}-${Date.now().toString(36)}-${++n}`
  const now = Date.now()
  const modules = [{ id: 'm-demo', name: 'COMP26120 Algorithms', code: 'COMP26120', createdAt: now }]
  const lectures = [{
    id: 'l-demo', moduleId: 'm-demo', title: 'Week 3 · Hash Tables', date: new Date().toISOString().slice(0, 10),
    state: 'attended', createdAt: now, updatedAt: now, slides: [], notes: [], transcript: [], summary: ''
  }]
  const summary = (l) => ({ ...l, slideCount: l.slides.length, noteCount: l.notes.length, hasSummary: !!l.summary, slides: undefined, notes: undefined, transcript: undefined })
  const find = (lid) => {
    const l = lectures.find((x) => x.id === lid)
    if (!l) throw new Error(`no lecture ${lid}`)
    return l
  }
  return {
    persistent: false,
    async listModules () { return modules.map((m) => ({ ...m, lectureCount: lectures.filter((l) => l.moduleId === m.id).length })).sort((a, b) => a.name.localeCompare(b.name)) },
    async createModule ({ name, code }) { const m = { id: id('m'), name, code, createdAt: Date.now() }; modules.push(m); return m },
    async listLectures (mid) { return lectures.filter((l) => l.moduleId === mid).sort((a, b) => b.createdAt - a.createdAt).map(summary) },
    async createLecture (mid, { title, date, state = 'attended' }) {
      const l = { id: id('l'), moduleId: mid, title, date: date || new Date().toISOString().slice(0, 10), state, createdAt: Date.now(), updatedAt: Date.now(), slides: [], notes: [], transcript: [], summary: '' }
      lectures.push(l)
      return summary(l)
    },
    async updateLecture (lid, o) { Object.assign(find(lid), o); return summary(find(lid)) },
    async getLecture (lid) { const l = find(lid); return { ...l, slideCount: l.slides.length, noteCount: l.notes.length } },
    async saveSlides (lid, s) { find(lid).slides = s; return summary(find(lid)) },
    async saveNote (lid, note) { const l = find(lid); if (!l.notes.some((x) => x.id === note.id)) l.notes.push({ ...note, savedAt: Date.now() }); return summary(l) },
    async unsaveNote (lid, nid) { const l = find(lid); l.notes = l.notes.filter((x) => x.id !== nid); return summary(l) },
    async appendTranscript (lid, chunks) { const l = find(lid); for (const c of chunks) if (!l.transcript.some((x) => x.id === c.id)) l.transcript.push(c); return summary(l) },
    async setSummary (lid, text) { find(lid).summary = String(text || ''); return summary(find(lid)) },
    async setNoteImportant (lid, nid, important = true, note) {
      const l = find(lid)
      let x = l.notes.find((n) => n.id === nid)
      if (!x && note) { x = { ...note, savedAt: Date.now() }; l.notes.push(x) }
      if (x) { x.important = !!important; x.importantAt = important ? Date.now() : null }
      return x || null
    },
    async listImportant (mid) {
      return lectures.filter((l) => l.moduleId === mid && l.notes.some((n) => n.important))
        .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.createdAt - b.createdAt)
        .map((l) => ({ lectureId: l.id, lectureTitle: l.title, date: l.date, state: l.state, notes: l.notes.filter((n) => n.important).sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0)) }))
    },
    async searchAll (q, k = 5) {
      const all = []
      for (const l of lectures) all.push(...await this.search(l.id, q, k))
      return all.sort((a, b) => b.score - a.score).slice(0, k)
    },
    async search (lid, q, k = 5) {
      const l = find(lid)
      const words = String(q).toLowerCase().split(/\s+/).filter(Boolean)
      const items = [
        ...l.notes.map((x) => ({ kind: 'note', text: x.text, slideIndex: x.slideIndex, refId: x.id })),
        ...l.transcript.map((x) => ({ kind: 'transcript', text: x.text, slideIndex: x.slideIndex, refId: x.id })),
        ...l.slides.map((x) => ({ kind: 'slide', text: x.text, slideIndex: x.index, refId: `s-${x.index}` }))
      ]
      return items
        .map((it) => ({ ...it, lectureId: lid, score: words.filter((w) => it.text.toLowerCase().includes(w)).length / (words.length || 1) }))
        .filter((it) => it.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
    },
    async startSession () {},
    async endSession () {}
  }
}
