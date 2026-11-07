// S5 library data layer: modules -> lectures, JSON persistence, one vector store PER LECTURE,
// export/import through the S8 share link. Owner: aaron. Contract: coord/contracts/stage-5-library.md
import { readdir, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, readText, writeJson, writeAtomic, removeDir, newId, keyedQueue } from './fsutil.js'
import { rank } from './vectors.js'
import { loadStore, saveStore, flushUnder, dropStore } from './vecstore.js'
import { imageToBuffer, bufferToDataUrl } from '../p2p/util.js'
import { shareWeek, importWeek } from '../p2p/share.js'

const STATES = new Set(['live', 'attended', 'missed', 'imported'])

/**
 * @param {object} o
 * @param {string} o.dir                      library root folder
 * @param {(t: string|string[]) => Promise<number[]|number[][]>} [o.embed]   on-device embedder (ai.embed)
 * @param {{on,off,emit}} [o.bus]             main bus: emits 'library:changed', used by startSession
 * @param {Array} [o.bootstrap]               DHT bootstrap (tests only)
 * Optional search helpers from aryan's AI facade (src/ai/search.js). Each falls back to plain behaviour:
 * @param {(q: string) => Promise<number[]>} [o.embedQuery]        query embedding (task prefix)
 * @param {(texts: string[]) => Promise<number[][]>} [o.embedDocs] document embedding (task prefix)
 * @param {(chunks) => {id, slideIndex, tStart, tEnd, text, chunkIds}[]} [o.passages]  merge chunks into ~30 s passages
 * @param {({cosine, query, text, kind}) => number} [o.score]       hybrid ranking score
 */
export async function createLibrary ({ dir, embed, embedQuery, embedDocs, passages, score, bus, bootstrap } = {}) {
  if (!dir) throw new Error('createLibrary: dir is required')
  await mkdir(join(dir, 'lectures'), { recursive: true })
  const queue = keyedQueue()
  const shares = new Map() // lectureId -> share handle
  const modulesFile = join(dir, 'modules.json')
  const L = (id, ...p) => join(dir, 'lectures', safeId(id), ...p)
  const changed = (what, extra = {}) => { try { bus?.emit('library:changed', { what, ...extra }) } catch {} }
  // Vectors made by different embedders are not comparable; a store made by another one gets rebuilt.
  const EMBEDDER = embedDocs ? 'docs-v1' : embed ? 'plain-v1' : 'none'

  // ---------------------------------------------------------------- embedding (never throws)
  async function embedMany (texts) {
    const fn = embedDocs || embed
    if (!fn || !texts.length) return texts.map(() => null)
    try {
      const out = await fn(texts)
      if (Array.isArray(out) && Array.isArray(out[0])) return out.map(toArray)
      if (texts.length === 1 && Array.isArray(out)) return [toArray(out)]
    } catch (err) {
      console.error('[library] embed failed, falling back to keyword search:', err?.message || err)
    }
    return texts.map(() => null)
  }
  async function embedOneQuery (q) {
    try {
      if (embedQuery) { const v = await embedQuery(q); return toArray(Array.isArray(v[0]) ? v[0] : v) }
      if (embed) { const v = await embed([q]); return toArray(Array.isArray(v[0]) ? v[0] : v) }
    } catch (err) {
      console.error('[library] query embed failed, keyword search only:', err?.message || err)
    }
    return null
  }
  /** Transcript -> index items: ~30 s passages when aryan's helper is there, else one item per chunk. */
  function transcriptItems (transcript) {
    if (passages) {
      try {
        return passages(transcript).map((p) => ({ id: `passage-${p.id}`, kind: 'transcript', refId: p.chunkIds?.[0] ?? p.id, chunkIds: p.chunkIds || [], slideIndex: p.slideIndex ?? null, text: p.text }))
      } catch (err) { console.error('[library] passages failed, indexing raw chunks:', err?.message || err) }
    }
    return transcript.map((c) => ({ id: `chunk-${c.id}`, kind: 'transcript', refId: c.id, chunkIds: [c.id], slideIndex: c.slideIndex ?? null, text: c.text }))
  }

  // ---------------------------------------------------------------- lecture files
  const readMeta = (id) => readJson(L(id, 'lecture.json'), null)
  async function mustMeta (id) {
    const meta = await readMeta(id)
    if (!meta) throw new Error(`lecture not found: ${id}`)
    return meta
  }
  async function writeMeta (meta) {
    meta.updatedAt = Date.now()
    await writeJson(L(meta.id, 'lecture.json'), meta)
    return meta
  }
  // B-017: in-memory per-lecture stores, flushed debounced (see vecstore.js)
  const readVectors = (id) => loadStore(L(id, 'vectors.json'))
  const writeVectors = (id, store, opts) => saveStore(L(id, 'vectors.json'), store, opts)

  async function addItems (id, items) {
    if (!items.length) return
    const vectors = await embedMany(items.map((it) => it.text))
    const store = await readVectors(id)
    const ids = new Set(items.map((it) => it.id))
    store.items = store.items.filter((it) => !ids.has(it.id))
    items.forEach((it, i) => store.items.push({ ...it, vector: vectors[i] ? Float32Array.from(vectors[i]) : null }))
    const v = store.items.find((it) => it.vector && it.vector.length)
    store.dim = v ? v.vector.length : null
    store.embedder = EMBEDDER
    await writeVectors(id, store)
  }
  /** Replace all items of one kind, re-embedding only items whose text changed (cheap per new chunk). */
  async function syncKind (id, kind, items) {
    const store = await readVectors(id)
    const old = new Map(store.items.filter((it) => it.kind === kind).map((it) => [it.id, it]))
    const keep = []
    const fresh = []
    for (const it of items) {
      const prev = old.get(it.id)
      if (prev && prev.text === it.text && store.embedder === EMBEDDER) keep.push({ ...it, vector: prev.vector })
      else fresh.push(it)
    }
    const vectors = await embedMany(fresh.map((it) => it.text))
    store.items = [...store.items.filter((it) => it.kind !== kind), ...keep, ...fresh.map((it, i) => ({ ...it, vector: vectors[i] ? Float32Array.from(vectors[i]) : null }))]
    const v = store.items.find((it) => it.vector && it.vector.length)
    store.dim = v ? v.vector.length : null
    store.embedder = EMBEDDER
    await writeVectors(id, store)
  }
  async function removeItems (id, pred) {
    const store = await readVectors(id)
    store.items = store.items.filter((it) => !pred(it))
    await writeVectors(id, store)
  }

  async function summary (meta) {
    const notes = await readJson(L(meta.id, 'notes.json'), [])
    const slides = await readJson(L(meta.id, 'slides.json'), [])
    const sum = await readText(L(meta.id, 'summary.txt'))
    const personal = await readJson(L(meta.id, 'personal.json'), [])
    return { ...meta, slideCount: slides.length, noteCount: notes.length, personalCount: personal.length, hasSummary: !!sum.trim() }
  }

  async function allLectureMetas () {
    let names = []
    try { names = await readdir(join(dir, 'lectures')) } catch {}
    const metas = await Promise.all(names.map((n) => readJson(join(dir, 'lectures', n, 'lecture.json'), null)))
    return metas.filter(Boolean)
  }

  // ---------------------------------------------------------------- slides
  async function writeSlides (id, slides) {
    const out = []
    for (const s of slides || []) {
      let imageFile = null
      const img = await imageToBuffer(s.image)
      if (img) {
        imageFile = `slides/${s.index}${img.ext}`
        await writeAtomic(L(id, imageFile), img.buf)
      }
      out.push({ index: s.index, text: s.text || '', imageFile })
    }
    await writeJson(L(id, 'slides.json'), out)
    await removeItems(id, (it) => it.kind === 'slide')
    await addItems(id, out.filter((s) => s.text.trim()).map((s) => ({ id: `slide-${s.index}`, kind: 'slide', refId: String(s.index), slideIndex: s.index, text: s.text })))
    return out
  }

  // ---------------------------------------------------------------- session capture
  let session = null // { id, off() }

  const api = {
    // ---- modules
    async listModules () {
      const mods = await readJson(modulesFile, [])
      const metas = await allLectureMetas()
      return mods
        .map((m) => ({ ...m, lectureCount: metas.filter((l) => l.moduleId === m.id).length }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    async createModule ({ name, code } = {}) {
      if (!name || !String(name).trim()) throw new Error('createModule: name is required')
      return queue('modules', async () => {
        const mods = await readJson(modulesFile, [])
        const mod = { id: newId('mod'), name: String(name).trim(), code: code ? String(code).trim() : null, createdAt: Date.now() }
        mods.push(mod)
        await writeJson(modulesFile, mods)
        changed('modules', { moduleId: mod.id })
        return { ...mod, lectureCount: 0 }
      })
    },
    async renameModule (id, { name, code } = {}) {
      return queue('modules', async () => {
        const mods = await readJson(modulesFile, [])
        const mod = mods.find((m) => m.id === id)
        if (!mod) throw new Error(`module not found: ${id}`)
        if (name !== undefined) mod.name = String(name).trim()
        if (code !== undefined) mod.code = code ? String(code).trim() : null
        await writeJson(modulesFile, mods)
        changed('modules', { moduleId: id })
        return mod
      })
    },
    async deleteModule (id) {
      for (const l of await allLectureMetas()) if (l.moduleId === id) await api.deleteLecture(l.id)
      await queue('modules', async () => {
        const mods = await readJson(modulesFile, [])
        await writeJson(modulesFile, mods.filter((m) => m.id !== id))
      })
      changed('modules', { moduleId: id })
      return true
    },

    // ---- lectures
    async listLectures (moduleId) {
      const metas = (await allLectureMetas()).filter((l) => l.moduleId === moduleId)
      const out = await Promise.all(metas.map(summary))
      return out.sort((a, b) => (b.date || b.createdAt || '').toString().localeCompare((a.date || a.createdAt || '').toString()) || b.createdAt - a.createdAt)
    },
    async createLecture (moduleId, { title, date = null, state = 'attended' } = {}) {
      const mods = await readJson(modulesFile, [])
      if (!mods.some((m) => m.id === moduleId)) throw new Error(`module not found: ${moduleId}`)
      if (!STATES.has(state)) throw new Error(`bad state: ${state}`)
      const meta = { id: newId('lec'), moduleId, title: String(title || 'Untitled lecture').trim(), date, state, sharedBy: null, createdAt: Date.now(), updatedAt: Date.now() }
      await queue(meta.id, async () => {
        await writeMeta(meta)
        await writeJson(L(meta.id, 'notes.json'), [])
        await writeJson(L(meta.id, 'transcript.json'), [])
        await writeJson(L(meta.id, 'slides.json'), [])
        await writeVectors(meta.id, { items: [] }, { now: true })
      })
      changed('lectures', { moduleId, lectureId: meta.id })
      return summary(meta)
    },
    async updateLecture (id, patch = {}) {
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        if (patch.title !== undefined) m.title = String(patch.title).trim()
        if (patch.date !== undefined) m.date = patch.date
        if (patch.state !== undefined) {
          if (!STATES.has(patch.state)) throw new Error(`bad state: ${patch.state}`)
          m.state = patch.state
        }
        return writeMeta(m)
      })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id })
      return summary(meta)
    },
    async getLecture (id) {
      const meta = await mustMeta(id)
      const slidesRaw = await readJson(L(id, 'slides.json'), [])
      const slides = []
      for (const s of slidesRaw) {
        let image = null
        if (s.imageFile) {
          try { image = bufferToDataUrl(await readFile(L(id, s.imageFile)), s.imageFile) } catch {}
        }
        slides.push({ index: s.index, text: s.text, image })
      }
      return {
        ...(await summary(meta)),
        slides,
        notes: await readJson(L(id, 'notes.json'), []),
        transcript: await readJson(L(id, 'transcript.json'), []),
        summary: await readText(L(id, 'summary.txt')),
        personalNotes: await readJson(L(id, 'personal.json'), []) // this device only; never exported
      }
    },
    async deleteLecture (id) {
      const meta = await readMeta(id)
      if (session?.id === id) api.endSession()
      await api.stopSharing(id)
      dropStore(L(id, 'vectors.json')) // never let a pending flush re-create a deleted lecture
      await queue(id, () => removeDir(L(id)))
      changed('lectures', { moduleId: meta?.moduleId, lectureId: id })
      return true
    },

    // ---- content
    async saveSlides (id, slides) {
      const meta = await queue(id, async () => { const m = await mustMeta(id); await writeSlides(id, slides); return writeMeta(m) })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id })
      return summary(meta)
    },
    async saveNote (id, note) {
      if (!note || !note.id) throw new Error('saveNote: note.id is required')
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        const notes = await readJson(L(id, 'notes.json'), [])
        const i = notes.findIndex((n) => n.id === note.id)
        const prev = i >= 0 ? notes[i] : null
        // H-2: re-saving (e.g. auto-save, then a click) never loses the star or the first save time.
        const saved = { ...prev, ...note, important: note.important ?? prev?.important ?? false, savedAt: prev?.savedAt || note.savedAt || Date.now() }
        // keep the note linked to its transcript even if a re-save carries no chunk ids
        if (!(note.sourceChunkIds && note.sourceChunkIds.length) && prev?.sourceChunkIds?.length) saved.sourceChunkIds = prev.sourceChunkIds
        if (i >= 0) notes[i] = saved
        else notes.push(saved)
        await writeJson(L(id, 'notes.json'), notes)
        await addItems(id, [{ id: `note-${note.id}`, kind: 'note', refId: note.id, slideIndex: note.slideIndex ?? null, text: String(note.text || '') }])
        return writeMeta(m)
      })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id })
      return summary(meta)
    },
    /** H-2: star / unstar a note. If it isn't saved yet, pass the note as the 4th arg and it is saved first. */
    async setNoteImportant (id, noteId, important = true, note = null) {
      let result = null
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        const notes = await readJson(L(id, 'notes.json'), [])
        let n = notes.find((x) => x.id === noteId)
        if (!n) {
          if (!note || note.id !== noteId) throw new Error('note not found: ' + noteId)
          n = { ...note, savedAt: Date.now() }
          notes.push(n)
          await addItems(id, [{ id: `note-${n.id}`, kind: 'note', refId: n.id, slideIndex: n.slideIndex ?? null, text: String(n.text || '') }])
        }
        n.important = !!important
        n.importantAt = important ? Date.now() : null
        await writeJson(L(id, 'notes.json'), notes)
        result = n
        return writeMeta(m)
      })
      changed('important', { moduleId: meta.moduleId, lectureId: id, noteId })
      return result
    },
    /** H-2: a module's starred notes, grouped by lecture in lecture order (date, then creation). */
    async listImportant (moduleId) {
      const metas = (await allLectureMetas()).filter((l) => l.moduleId === moduleId)
      metas.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.createdAt - b.createdAt)
      const out = []
      for (const l of metas) {
        const notes = (await readJson(L(l.id, 'notes.json'), [])).filter((n) => n.important)
        if (!notes.length) continue
        notes.sort((a, b) => (a.slideIndex ?? 1e9) - (b.slideIndex ?? 1e9) || (a.createdAt || 0) - (b.createdAt || 0))
        out.push({ lectureId: l.id, lectureTitle: l.title, date: l.date || null, state: l.state, notes })
      }
      return out
    },
    async unsaveNote (id, noteId) {
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        const notes = await readJson(L(id, 'notes.json'), [])
        await writeJson(L(id, 'notes.json'), notes.filter((n) => n.id !== noteId))
        await removeItems(id, (it) => it.kind === 'note' && it.refId === noteId)
        return writeMeta(m)
      })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id })
      return summary(meta)
    },
    async appendTranscript (id, chunks) {
      const list = (Array.isArray(chunks) ? chunks : [chunks]).filter((c) => c && c.id && c.text)
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        const transcript = await readJson(L(id, 'transcript.json'), [])
        const have = new Set(transcript.map((c) => c.id))
        const fresh = list.filter((c) => !have.has(c.id))
        if (fresh.length) {
          transcript.push(...fresh)
          await writeJson(L(id, 'transcript.json'), transcript)
          await syncKind(id, 'transcript', transcriptItems(transcript))
        }
        return writeMeta(m)
      })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id })
      return summary(meta)
    },
    async setSummary (id, text) {
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        await writeAtomic(L(id, 'summary.txt'), String(text || ''))
        await removeItems(id, (it) => it.kind === 'summary')
        if (String(text || '').trim()) await addItems(id, [{ id: 'summary', kind: 'summary', refId: 'summary', slideIndex: null, text: String(text) }])
        return writeMeta(m)
      })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id })
      return summary(meta)
    },

    // ---- personal notes: the student's own notes per slide. LOCAL ONLY: kept in personal.json, never
    // emitted as note:added, never in the room feed, never in exportLecture / shareLecture / imports.
    async listPersonalNotes (id, slideIndex) {
      await mustMeta(id)
      const all = await readJson(L(id, 'personal.json'), [])
      const list = Number.isInteger(slideIndex) ? all.filter((n) => n.slideIndex === slideIndex) : all
      return list.sort((a, b) => a.createdAt - b.createdAt)
    },
    async addPersonalNote (id, { slideIndex = null, text = '' } = {}) {
      const note = { id: newId('pn'), kind: 'personal', slideIndex: Number.isInteger(slideIndex) ? slideIndex : null, text: String(text ?? ''), createdAt: Date.now(), updatedAt: Date.now() }
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        const all = await readJson(L(id, 'personal.json'), [])
        all.push(note)
        await writeJson(L(id, 'personal.json'), all)
        if (note.text.trim()) await addItems(id, [personalItem(note)])
        return writeMeta(m)
      })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id, personal: true })
      return note
    },
    async updatePersonalNote (id, noteId, { text } = {}) {
      let updated = null
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        const all = await readJson(L(id, 'personal.json'), [])
        const n = all.find((x) => x.id === noteId)
        if (!n) throw new Error('personal note not found: ' + noteId)
        if (text !== undefined) n.text = String(text)
        n.updatedAt = Date.now()
        await writeJson(L(id, 'personal.json'), all)
        if (n.text.trim()) await addItems(id, [personalItem(n)])
        else await removeItems(id, (it) => it.id === 'personal-' + n.id)
        updated = n
        return writeMeta(m)
      })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id, personal: true })
      return updated
    },
    async deletePersonalNote (id, noteId) {
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        const all = await readJson(L(id, 'personal.json'), [])
        await writeJson(L(id, 'personal.json'), all.filter((x) => x.id !== noteId))
        await removeItems(id, (it) => it.id === 'personal-' + noteId)
        return writeMeta(m)
      })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id, personal: true })
      return true
    },

    // ---- search (per lecture; never mixes stores)
    async search (id, query, k = 5) {
      await mustMeta(id)
      if (!String(query || '').trim()) return []
      let store = await readVectors(id)
      if (EMBEDDER !== 'none' && store.items.length && store.embedder !== EMBEDDER) {
        await api.rebuildIndex(id) // made by another embedder (e.g. before embedDocs existed): vectors not comparable
        store = await readVectors(id)
      }
      const qv = store.items.some((it) => it.vector) ? await embedOneQuery(String(query)) : null
      return rank(store.items, { query, queryVector: qv, k, score }).map((h) => ({ ...h, lectureId: id }))
    },
    async searchAll (query, k = 5) {
      if (!String(query || '').trim()) return []
      const hits = []
      for (const meta of await allLectureMetas()) hits.push(...await api.search(meta.id, query, k))
      return hits.sort((a, b) => b.score - a.score).slice(0, k)
    },
    async rebuildIndex (id) {
      return queue(id, async () => {
        await mustMeta(id)
        const slides = await readJson(L(id, 'slides.json'), [])
        const notes = await readJson(L(id, 'notes.json'), [])
        const transcript = await readJson(L(id, 'transcript.json'), [])
        const sum = await readText(L(id, 'summary.txt'))
        const personal = await readJson(L(id, 'personal.json'), [])
        await writeVectors(id, { items: [] })
        const items = [
          ...slides.filter((s) => s.text?.trim()).map((s) => ({ id: `slide-${s.index}`, kind: 'slide', refId: String(s.index), slideIndex: s.index, text: s.text })),
          ...notes.map((n) => ({ id: `note-${n.id}`, kind: 'note', refId: n.id, slideIndex: n.slideIndex ?? null, text: String(n.text || '') })),
          ...transcriptItems(transcript),
          ...(sum.trim() ? [{ id: 'summary', kind: 'summary', refId: 'summary', slideIndex: null, text: sum }] : []),
          ...personal.filter((n) => String(n.text || '').trim()).map(personalItem)
        ]
        await addItems(id, items)
        return { items: items.length }
      })
    },

    // ---- sharing (S8)
    async exportLecture (id) {
      const full = await api.getLecture(id)
      return {
        v: 1,
        moduleId: full.moduleId,
        weekId: full.id,
        title: full.title,
        sharedBy: null,
        slides: full.slides.map((s) => ({ index: s.index, text: s.text })),
        notes: full.notes.map(({ savedAt, ...n }) => n),
        summary: full.summary,
        transcript: full.transcript,
        exportedAt: Date.now()
      }
    },
    async shareLecture (id, { sharedBy } = {}) {
      if (shares.has(id)) { const s = shares.get(id); return { key: s.key, link: s.link } }
      const bundle = await api.exportLecture(id)
      if (sharedBy) bundle.sharedBy = sharedBy
      const s = await shareWeek(bundle, { bootstrap })
      shares.set(id, s)
      return { key: s.key, link: s.link }
    },
    async stopSharing (id) {
      const s = shares.get(id)
      shares.delete(id)
      if (s) await s.stop()
      return true
    },
    async importLecture (id, link, { timeoutMs } = {}) {
      await mustMeta(id)
      const bundle = await importWeek(link, { bootstrap, ...(timeoutMs ? { timeoutMs } : {}) })
      const meta = await queue(id, async () => {
        const m = await mustMeta(id)
        const slides = await readJson(L(id, 'slides.json'), [])
        if (!slides.length && bundle.slides?.length) await writeJson(L(id, 'slides.json'), bundle.slides.map((s) => ({ index: s.index, text: s.text || '', imageFile: null })))
        const notes = await readJson(L(id, 'notes.json'), [])
        const have = new Set(notes.map((n) => n.id))
        for (const n of bundle.notes || []) if (!have.has(n.id)) notes.push({ ...n, shared: true, savedAt: Date.now() })
        await writeJson(L(id, 'notes.json'), notes)
        const transcript = await readJson(L(id, 'transcript.json'), [])
        if (!transcript.length && bundle.transcript?.length) await writeJson(L(id, 'transcript.json'), bundle.transcript)
        if (bundle.summary) await writeAtomic(L(id, 'summary.txt'), bundle.summary)
        m.state = 'imported'
        m.sharedBy = bundle.sharedBy || 'a coursemate'
        if (!m.title || m.title === 'Untitled lecture') m.title = bundle.title || m.title
        return writeMeta(m)
      })
      await api.rebuildIndex(id) // we share text, not vectors: embed locally
      changed('lecture', { moduleId: meta.moduleId, lectureId: id })
      return api.getLecture(id)
    },

    // ---- live-session capture
    async startSession (id) {
      if (!bus) throw new Error('startSession needs a bus')
      if (session) await api.endSession()
      await api.updateLecture(id, { state: 'live' })
      const onSlides = (slides) => { api.saveSlides(id, slides).catch((e) => console.error('[library] saveSlides', e)) }
      const onChunk = (c) => { api.appendTranscript(id, [c]).catch((e) => console.error('[library] appendTranscript', e)) }
      // H-2: every generated note (AI + lecturer) is saved the moment it arrives, linked to its slide and
      // transcript chunks (slideIndex + sourceChunkIds). Works the same on a peer (notes come from the room).
      const onNote = (n) => { if (n && n.id && n.kind !== 'personal') api.saveNote(id, n).catch((e) => console.error('[library] auto-save note', e)) }
      bus.on('slides:loaded', onSlides)
      bus.on('transcript:chunk', onChunk)
      bus.on('note:added', onNote)
      session = { id, off: () => { bus.off('slides:loaded', onSlides); bus.off('transcript:chunk', onChunk); bus.off('note:added', onNote) } }
      return id
    },
    async endSession () {
      if (!session) return null
      const { id, off } = session
      session = null
      off()
      await queue(id, async () => {}) // let pending writes land
      await flushUnder(dir)
      const meta = await readMeta(id)
      if (meta && meta.state === 'live') await api.updateLecture(id, { state: 'attended' })
      return id
    },
    activeLecture: () => session?.id ?? null,

    /** Write any pending vector-store changes now (they are otherwise flushed within ~1 s). */
    flush: () => flushUnder(dir),
    async close () {
      if (session) await api.endSession()
      await flushUnder(dir)
      for (const s of shares.values()) await s.stop().catch(() => {})
      shares.clear()
    }
  }
  return api
}

function toArray (v) { return Array.from(v, Number) }
function personalItem (n) { return { id: `personal-${n.id}`, kind: 'personal', refId: n.id, slideIndex: n.slideIndex ?? null, text: String(n.text || '') } }
function safeId (id) {
  const s = String(id || '')
  if (!/^[a-z]+-[0-9a-z]+$/i.test(s)) throw new Error(`bad id: ${s}`)
  return s
}
