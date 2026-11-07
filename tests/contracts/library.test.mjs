// Contract tests for aaron's library data layer (S5), from coord/contracts/stage-5-library.md v1.
// Uses a deterministic fake embed (hashed bag of words) so isolation + scoped search are testable without models.
// PENDING (skipped) until src/library/index.js is merged into dev.
import { test, describe, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { src, fx, pending, maybeImport, recordingBus, slidesFixture, script, checkNote } from './../helpers.mjs'

const LIB = src('library', 'index.js')
const skip = pending(LIB, 'S5 library data layer (aaron)')
const tmp = () => mkdtempSync(join(tmpdir(), 'lecscribe-lib-'))

// Fake embedder: 64-dim hashed bag of words, L2-normalised. Same text → same vector; shared words → higher cosine.
const DIM = 64
function vec (t) {
  const v = new Array(DIM).fill(0)
  for (const w of String(t).toLowerCase().match(/[a-z0-9]{3,}/g) || []) {
    let h = 2166136261; for (const c of w) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
    v[(h >>> 0) % DIM] += 1
  }
  const n = Math.hypot(...v) || 1
  return v.map((x) => x / n)
}
const embed = async (x) => (Array.isArray(x) ? x.map(vec) : vec(x))

const slidesWithImages = () => slidesFixture().map((s) => ({
  index: s.index, text: s.text, image: 'data:image/png;base64,' + readFileSync(join(fx('..'), s.image)).toString('base64')
}))
const note = (i, slideIndex, text, kind = 'ai') => ({ id: `n-${i}`, slideIndex, kind, text, sourceChunkIds: [`c-${i}`], createdAt: 1_700_000_000_000 + i })

describe('S5 library: modules and lectures', { skip }, () => {
  let mod, dir, lib, bus
  before(async () => {
    mod = await maybeImport(LIB)
    dir = tmp(); bus = recordingBus()
    lib = await mod.createLibrary({ dir, embed, bus })
  })

  test('createModule / listModules (sorted by name) / renameModule', async () => {
    const b = await lib.createModule({ name: 'Operating Systems', code: 'COMP25111' })
    const a = await lib.createModule({ name: 'Algorithms and Data Structures', code: 'COMP26120' })
    for (const m of [a, b]) { assert.equal(typeof m.id, 'string'); assert.equal(typeof m.createdAt, 'number') }
    assert.deepEqual((await lib.listModules()).map((m) => m.name), ['Algorithms and Data Structures', 'Operating Systems'])
    const r = await lib.renameModule(b.id, { name: 'OS' })
    assert.equal(r.name, 'OS')
    assert.ok(bus.events('library:changed').some((e) => e.what === 'modules'))
  })

  test('createLecture defaults to attended; missed state; listLectures newest first; lectureCount', async () => {
    const [m] = await lib.listModules()
    const w2 = await lib.createLecture(m.id, { title: 'Week 2 · Sorting', date: '2026-10-31' })
    const w3 = await lib.createLecture(m.id, { title: 'Week 3 · Hash Tables', date: '2026-11-07' })
    const w4 = await lib.createLecture(m.id, { title: 'Week 4 · Graphs', date: '2026-11-14', state: 'missed' })
    assert.equal(w2.state, 'attended'); assert.equal(w4.state, 'missed'); assert.equal(w3.moduleId, m.id)
    assert.deepEqual((await lib.listLectures(m.id)).map((l) => l.id), [w4.id, w3.id, w2.id])
    assert.equal((await lib.listModules()).find((x) => x.id === m.id).lectureCount, 3)
    const u = await lib.updateLecture(w2.id, { title: 'Week 2 · Sorting II' })
    assert.equal(u.title, 'Week 2 · Sorting II')
  })

  test('saveSlides + saveNote + transcript + summary → getLecture; counts; images back as data URLs', async () => {
    const [m] = await lib.listModules()
    const w3 = (await lib.listLectures(m.id)).find((l) => l.title.includes('Hash'))
    await lib.saveSlides(w3.id, slidesWithImages())
    await lib.saveNote(w3.id, note(1, 1, 'Choose the table size m to be prime'))
    await lib.saveNote(w3.id, note(2, 3, 'Think of the table as a car park: alpha is how full it is', 'lecturer'))
    const segs = script().segments
    await lib.appendTranscript(w3.id, segs.map((s, i) => ({ id: `c-${i + 1}`, slideIndex: s.slideIndex, tStart: s.tStart, tEnd: s.tEnd, text: s.text })))
    await lib.appendTranscript(w3.id, [{ id: 'c-1', slideIndex: 0, tStart: 0, tEnd: 1, text: 'duplicate' }]) // dedup by id
    await lib.setSummary(w3.id, 'Hash tables: hashing, collisions, load factor, resizing.')
    const full = await lib.getLecture(w3.id)
    assert.equal(full.slides.length, 5); assert.match(full.slides[0].image, /^data:image\//); assert.equal(full.slides[2].text, slidesFixture()[2].text)
    assert.equal(full.notes.length, 2)
    for (const n of full.notes) { assert.deepEqual(checkNote(n), []); assert.equal(typeof n.savedAt, 'number') }
    assert.equal(full.transcript.length, segs.length, 'appendTranscript must dedupe by chunk id')
    assert.match(full.summary, /load factor/)
    const l = (await lib.listLectures(m.id)).find((x) => x.id === w3.id)
    assert.equal(l.slideCount, 5); assert.equal(l.noteCount, 2); assert.equal(l.hasSummary, true)
  })

  test('persistence: a NEW library instance on the same dir sees everything; per-lecture folder layout', async () => {
    const lib2 = await mod.createLibrary({ dir, embed })
    const [m] = await lib2.listModules()
    const w3 = (await lib2.listLectures(m.id)).find((l) => l.title.includes('Hash'))
    assert.equal((await lib2.getLecture(w3.id)).notes.length, 2)
    assert.ok(existsSync(join(dir, 'modules.json')))
    assert.ok(existsSync(join(dir, 'lectures', w3.id, 'vectors.json')), 'vector store must live in the lecture folder')
  })

  test('unsaveNote removes the note and its vector', async () => {
    const [m] = await lib.listModules()
    const w3 = (await lib.listLectures(m.id)).find((l) => l.title.includes('Hash'))
    await lib.saveNote(w3.id, note(9, 2, 'zebra quokka platypus'))
    assert.ok((await lib.search(w3.id, 'zebra quokka platypus', 3)).some((h) => h.refId === 'n-9'))
    await lib.unsaveNote(w3.id, 'n-9')
    assert.ok(!(await lib.search(w3.id, 'zebra quokka platypus', 10)).some((h) => h.refId === 'n-9'))
    assert.equal((await lib.getLecture(w3.id)).notes.length, 2)
  })
})

describe('S5 library: per-lecture vector stores are isolated', { skip }, () => {
  test('search is scoped to one lecture; delete/rebuild one lecture never touches another', async () => {
    const { createLibrary } = await maybeImport(LIB)
    const dir = tmp()
    const lib = await createLibrary({ dir, embed })
    const m = await lib.createModule({ name: 'Algorithms' })
    const A = await lib.createLecture(m.id, { title: 'Hash Tables' })
    const B = await lib.createLecture(m.id, { title: 'Graphs' })
    await lib.saveNote(A.id, note(1, 2, 'Linear probing is cache friendly but suffers primary clustering'))
    await lib.saveNote(B.id, note(2, 0, 'Dijkstra needs non-negative edge weights and a priority queue'))

    const hitsA = await lib.search(A.id, 'probing clustering', 5)
    assert.ok(hitsA.length >= 1)
    assert.ok(hitsA.every((h) => h.lectureId === A.id), 'search(A) returned hits from another lecture')
    assert.equal(hitsA[0].refId, 'n-1'); assert.equal(hitsA[0].kind, 'note'); assert.equal(hitsA[0].slideIndex, 2)
    assert.ok((await lib.search(B.id, 'probing clustering', 5)).every((h) => h.lectureId === B.id))

    const all = await lib.searchAll('priority queue dijkstra', 5)
    assert.equal(all[0].lectureId, B.id)

    const vA = join(dir, 'lectures', A.id, 'vectors.json')
    const before = statSync(vA).mtimeMs; const contentA = readFileSync(vA, 'utf8')
    await lib.rebuildIndex(B.id)
    await lib.deleteLecture(B.id)
    assert.equal(statSync(vA).mtimeMs, before, "rebuilding/deleting B touched A's vector store")
    assert.equal(readFileSync(vA, 'utf8'), contentA)
    assert.equal((await lib.search(A.id, 'probing', 5))[0].refId, 'n-1')
    assert.ok(!existsSync(join(dir, 'lectures', B.id)))

    await lib.deleteModule(m.id)
    assert.deepEqual(await lib.listModules(), [])
    assert.ok(!existsSync(join(dir, 'lectures', A.id)), 'deleteModule must delete its lectures')
  })
})

describe('S5 library: live session capture', { skip }, () => {
  test('startSession records slides + transcript + AUTO-SAVES notes from the bus (H-2), not important by default; endSession → attended', async () => {
    const { createLibrary } = await maybeImport(LIB)
    const bus = recordingBus()
    const lib = await createLibrary({ dir: tmp(), embed, bus })
    const m = await lib.createModule({ name: 'Algorithms' })
    const L = await lib.createLecture(m.id, { title: 'Live' })
    await lib.startSession(L.id)
    assert.equal(await lib.activeLecture(), L.id)
    assert.equal((await lib.getLecture(L.id)).state, 'live')
    bus.emit('slides:loaded', slidesWithImages())
    bus.emit('transcript:chunk', { id: 'c-1', slideIndex: 0, tStart: 0, tEnd: 5, text: 'Welcome back everyone' })
    bus.emit('note:added', note(1, 0, 'auto-saved during the live session'))
    await new Promise((r) => setTimeout(r, 300))
    await lib.endSession()
    const full = await lib.getLecture(L.id)
    assert.equal(full.slides.length, 5); assert.equal(full.transcript.length, 1)
    // H-2 (human 15:53): every note:added is auto-saved into the live lecture, linked to slide + transcript, not important by default.
    if (typeof lib.setNoteImportant === 'function') { // H-2 merged → notes are auto-saved
      assert.equal(full.notes.length, 1, 'H-2: note:added must be auto-saved during a live session')
      assert.equal(full.notes[0].slideIndex, 0); assert.deepEqual(full.notes[0].sourceChunkIds, ['c-1'])
      assert.ok(!full.notes[0].important, 'auto-saved notes must not be important by default')
    } // else: pre-H-2 library, auto-save not expected yet (PENDING)
    assert.equal(full.state, 'attended'); assert.equal(await lib.activeLecture(), null)
  })
})

describe('S5 library: export / share / import a lecture (real DHT)', { skip }, () => {
  test('exportLecture is a WeekBundle; shareLecture → importLecture into a MISSED lecture in another library', { timeout: 120_000 }, async () => {
    const { createLibrary } = await maybeImport(LIB)
    const alice = await createLibrary({ dir: tmp(), embed })
    const m = await alice.createModule({ name: 'Algorithms', code: 'COMP26120' })
    const L = await alice.createLecture(m.id, { title: 'Week 3 · Hash Tables' })
    await alice.saveSlides(L.id, slidesWithImages())
    await alice.saveNote(L.id, note(1, 1, 'Choose the table size m to be prime'))
    await alice.setSummary(L.id, 'Hash tables summary')

    const b = await alice.exportLecture(L.id)
    assert.equal(b.weekId, L.id); assert.equal(b.moduleId, m.id)
    assert.equal(b.notes.length, 1); assert.equal(b.summary, 'Hash tables summary')
    assert.ok(b.slides.every((s) => typeof s.text === 'string' && !('image' in s && String(s.image).length > 1000)), 'export shares text, not images/vectors')

    const { link } = await alice.shareLecture(L.id)
    assert.match(link, /^lecscribe:\/\/week\//)
    try {
      const bob = await createLibrary({ dir: tmp(), embed })
      const bm = await bob.createModule({ name: 'Algorithms' })
      const missed = await bob.createLecture(bm.id, { title: 'Week 3', state: 'missed' })
      const got = await bob.importLecture(missed.id, link)
      assert.equal(got.state, 'imported')
      assert.equal(got.notes.length, 1); assert.equal(got.notes[0].shared, true)
      assert.equal(got.summary, 'Hash tables summary')
      // re-embedded locally: searchable in Bob's store for that lecture only
      const hits = await bob.search(missed.id, 'prime table size', 3)
      assert.equal(hits[0]?.refId, 'n-1')
    } finally { await alice.stopSharing(L.id) }
  })
})

// ---- H-2: important notes (human 15:53; spec in PLAN.md "HUMAN BUGS 15:53"; owner aaron). PENDING until setNoteImportant exists.
let h2skip = skip
if (!h2skip) { const l = await (await maybeImport(LIB)).createLibrary({ dir: tmp(), embed }); if (typeof l.setNoteImportant !== 'function') h2skip = 'PENDING: library.setNoteImportant / listImportant not merged yet (H-2, aaron)' }
describe('H-2 library: important notes per module', { skip: h2skip }, () => {
  test('setNoteImportant toggles + persists; listImportant(moduleId) groups starred notes by lecture, in lecture order', async () => {
    const { createLibrary } = await maybeImport(LIB)
    const dir = tmp(); const bus = recordingBus()
    const lib = await createLibrary({ dir, embed, bus })
    const m = await lib.createModule({ name: 'Algorithms' }); const other = await lib.createModule({ name: 'OS' })
    const w2 = await lib.createLecture(m.id, { title: 'Week 2', date: '2026-10-31' })
    const w3 = await lib.createLecture(m.id, { title: 'Week 3', date: '2026-11-07' })
    const os1 = await lib.createLecture(other.id, { title: 'OS 1' })
    await lib.saveNote(w2.id, note(1, 0, 'merge sort is stable'))
    await lib.saveNote(w3.id, note(2, 1, 'choose m prime')); await lib.saveNote(w3.id, note(3, 3, 'Java resizes at 0.75'))
    await lib.saveNote(os1.id, note(4, 0, 'context switch cost'))
    await lib.setNoteImportant(w3.id, 'n-3', true); await lib.setNoteImportant(w2.id, 'n-1', true)
    await lib.setNoteImportant(w3.id, 'n-2', true); await lib.setNoteImportant(w3.id, 'n-2', false) // toggle off
    await lib.setNoteImportant(os1.id, 'n-4', true)
    const lib2 = await createLibrary({ dir, embed }) // persistence
    const groups = await lib2.listImportant(m.id)
    assert.deepEqual(groups.map((g) => g.lectureId).sort(), [w2.id, w3.id].sort(), 'only lectures of THIS module with starred notes')
    const byL = Object.fromEntries(groups.map((g) => [g.lectureId, g]))
    assert.deepEqual(byL[w3.id].notes.map((n) => n.id), ['n-3']); assert.deepEqual(byL[w2.id].notes.map((n) => n.id), ['n-1'])
    assert.equal(byL[w3.id].lectureTitle, 'Week 3')
    for (const g of groups) for (const n of g.notes) { assert.ok(n.important); assert.equal(typeof n.slideIndex, 'number') }
    assert.ok(!(await lib2.getLecture(w3.id)).notes.find((n) => n.id === 'n-2').important, 'toggle off must persist')
  })
})
