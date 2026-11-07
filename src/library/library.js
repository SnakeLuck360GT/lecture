// S5 library data layer: modules -> lectures, JSON persistence, one vector store PER LECTURE,
// export/import through the S8 share link. Owner: aaron. Contract: coord/contracts/stage-5-library.md
import { readdir, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, readText, writeJson, writeAtomic, removeDir, newId, keyedQueue } from './fsutil.js'
import { rank } from './vectors.js'
import { imageToBuffer, bufferToDataUrl } from '../p2p/util.js'
import { shareWeek, importWeek } from '../p2p/share.js'

const STATES = new Set(['live', 'attended', 'missed', 'imported'])

/**
 * @param {object} o
 * @param {string} o.dir                      library root folder
 * @param {(t: string|string[]) => Promise<number[]|number[][]>} [o.embed]   on-device embedder (ai.embed)
 * @param {{on,off,emit}} [o.bus]             main bus: emits 'library:changed', used by startSession
 * @param {Array} [o.bootstrap]               DHT bootstrap (tests only)
 */
export async function createLibrary ({ dir, embed, bus, bootstrap } = {}) {
  if (!dir) throw new Error('createLibrary: dir is required')
  await mkdir(join(dir, 'lectures'), { recursive: true })
  const queue = keyedQueue()
  const shares = new Map() // lectureId -> share handle
  const modulesFile = join(dir, 'modules.json')
  const L = (id, ...p) => join(dir, 'lectures', safeId(id), ...p)
  const changed = (what, extra = {}) => { try { bus?.emit('library:changed', { what, ...extra }) } catch {} }

  // ---------------------------------------------------------------- embedding (never throws)
  async function embedMany (texts) {
    if (!embed || !texts.length) return texts.map(() => null)
    try {
      const out = await embed(texts)
      if (Array.isArray(out) && Array.isArray(out[0])) return out.map(toArray)
      if (texts.length === 1 && Array.isArray(out)) return [toArray(out)]
    } catch (err) {
      console.error('[library] embed failed, falling back to keyword search:', err?.message || err)
    }
    return texts.map(() => null)
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
  const readVectors = (id) => readJson(L(id, 'vectors.json'), { items: [] })
  const writeVectors = (id, store) => writeJson(L(id, 'vectors.json'), store)

  async function addItems (id, items) {
    if (!items.length) return
    const vectors = await embedMany(items.map((it) => it.text))
    const store = await readVectors(id)
    const ids = new Set(items.map((it) => it.id))
    store.items = store.items.filter((it) => !ids.has(it.id))
    items.forEach((it, i) => store.items.push({ ...it, vector: vectors[i] }))
    const v = store.items.find((it) => Array.isArray(it.vector))
    store.dim = v ? v.vector.length : null
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
    return { ...meta, slideCount: slides.length, noteCount: notes.length, hasSummary: !!sum.trim() }
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
        await writeVectors(meta.id, { items: [] })
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
        summary: await readText(L(id, 'summary.txt'))
      }
    },
    async deleteLecture (id) {
      const meta = await readMeta(id)
      if (session?.id === id) api.endSession()
      await api.stopSharing(id)
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
        const saved = { ...note, savedAt: note.savedAt || Date.now() }
        const i = notes.findIndex((n) => n.id === note.id)
        if (i >= 0) notes[i] = saved
        else notes.push(saved)
        await writeJson(L(id, 'notes.json'), notes)
        await addItems(id, [{ id: `note-${note.id}`, kind: 'note', refId: note.id, slideIndex: note.slideIndex ?? null, text: String(note.text || '') }])
        return writeMeta(m)
      })
      changed('lecture', { moduleId: meta.moduleId, lectureId: id })
      return summary(meta)
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
          await addItems(id, fresh.map((c) => ({ id: `chunk-${c.id}`, kind: 'transcript', refId: c.id, slideIndex: c.slideIndex ?? null, text: c.text })))
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

    // ---- search (per lecture; never mixes stores)
    async search (id, query, k = 5) {
      await mustMeta(id)
      if (!String(query || '').trim()) return []
      const store = await readVectors(id)
      const [qv] = store.items.some((it) => it.vector) ? await embedMany([String(query)]) : [null]
      return rank(store.items, { query, queryVector: qv, k }).map((h) => ({ ...h, lectureId: id }))
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
        await writeVectors(id, { items: [] })
        const items = [
          ...slides.filter((s) => s.text?.trim()).map((s) => ({ id: `slide-${s.index}`, kind: 'slide', refId: String(s.index), slideIndex: s.index, text: s.text })),
          ...notes.map((n) => ({ id: `note-${n.id}`, kind: 'note', refId: n.id, slideIndex: n.slideIndex ?? null, text: String(n.text || '') })),
          ...transcript.map((c) => ({ id: `chunk-${c.id}`, kind: 'transcript', refId: c.id, slideIndex: c.slideIndex ?? null, text: c.text })),
          ...(sum.trim() ? [{ id: 'summary', kind: 'summary', refId: 'summary', slideIndex: null, text: sum }] : [])
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
      bus.on('slides:loaded', onSlides)
      bus.on('transcript:chunk', onChunk)
      session = { id, off: () => { bus.off('slides:loaded', onSlides); bus.off('transcript:chunk', onChunk) } }
      return id
    },
    async endSession () {
      if (!session) return null
      const { id, off } = session
      session = null
      off()
      await queue(id, async () => {}) // let pending writes land
      const meta = await readMeta(id)
      if (meta && meta.state === 'live') await api.updateLecture(id, { state: 'attended' })
      return id
    },
    activeLecture: () => session?.id ?? null,

    async close () {
      if (session) await api.endSession()
      for (const s of shares.values()) await s.stop().catch(() => {})
      shares.clear()
    }
  }
  return api
}

function toArray (v) { return Array.from(v, Number) }
function safeId (id) {
  const s = String(id || '')
  if (!/^[a-z]+-[0-9a-z]+$/i.test(s)) throw new Error(`bad id: ${s}`)
  return s
}
