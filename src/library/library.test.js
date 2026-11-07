// Unit tests for src/library (owner: aaron). Temp dirs, deterministic fake embedder, local DHT testnet for sharing.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import { createLibrary } from './index.js'

const require = createRequire(import.meta.url)
const createTestnet = require('hyperdht/testnet')
let testnet, bootstrap
before(async () => { testnet = await createTestnet(3); bootstrap = testnet.bootstrap })
after(async () => { await testnet.destroy() })

const tmp = () => mkdtempSync(join(tmpdir(), 'lecscribe-lib-'))
// Hashed bag of words: texts sharing words get high cosine. Deterministic.
const DIM = 64
const fakeEmbed = async (t) => {
  const one = (s) => {
    const v = new Array(DIM).fill(0)
    for (const w of String(s).toLowerCase().match(/[a-z0-9]+/g) || []) {
      let h = 0
      for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0
      v[h % DIM] += 1
    }
    return v
  }
  return Array.isArray(t) ? t.map(one) : one(t)
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const note = (id, slideIndex, text) => ({ id, slideIndex, kind: 'ai', text, sourceChunkIds: [], createdAt: 1 })

test('modules + lectures CRUD, persistence across instances', async () => {
  const dir = tmp()
  const lib = await createLibrary({ dir, embed: fakeEmbed })
  const m = await lib.createModule({ name: 'COMP26120 Algorithms', code: 'COMP26120' })
  const l1 = await lib.createLecture(m.id, { title: 'Week 3 · Hash Tables', date: '2026-11-03' })
  const l2 = await lib.createLecture(m.id, { title: 'Week 4 · Trees', date: '2026-11-10', state: 'missed' })
  assert.equal(l1.state, 'attended')
  assert.equal(l2.state, 'missed')
  await assert.rejects(lib.createLecture('mod-nope', { title: 'x' }), /module not found/)

  const lib2 = await createLibrary({ dir, embed: fakeEmbed }) // fresh instance, same folder
  const mods = await lib2.listModules()
  assert.equal(mods.length, 1)
  assert.equal(mods[0].lectureCount, 2)
  const lectures = await lib2.listLectures(m.id)
  assert.deepEqual(lectures.map((l) => l.title), ['Week 4 · Trees', 'Week 3 · Hash Tables'])
  await lib2.renameModule(m.id, { name: 'Algorithms' })
  assert.equal((await lib2.listModules())[0].name, 'Algorithms')
  const u = await lib2.updateLecture(l2.id, { state: 'attended' })
  assert.equal(u.state, 'attended')
  await assert.rejects(lib2.updateLecture(l2.id, { state: 'bogus' }), /bad state/)
})

test('lecture content: slides (with images), notes, transcript, summary; getLecture returns it all', async () => {
  const lib = await createLibrary({ dir: tmp(), embed: fakeEmbed })
  const m = await lib.createModule({ name: 'M' })
  const l = await lib.createLecture(m.id, { title: 'L' })
  await lib.saveSlides(l.id, [{ index: 0, text: 'Hash tables', image: PNG }, { index: 1, text: 'Collisions', image: null }])
  await lib.saveNote(l.id, note('n1', 1, 'Use a prime table size'))
  await lib.saveNote(l.id, note('n1', 1, 'Use a prime table size m')) // same id -> replaced, not duplicated
  await lib.saveNote(l.id, note('n2', 0, 'Load factor above 0.75 means resize'))
  await lib.unsaveNote(l.id, 'n2')
  await lib.appendTranscript(l.id, [{ id: 'c-1', slideIndex: 0, tStart: 0, tEnd: 5, text: 'welcome to hashing' }])
  await lib.appendTranscript(l.id, [{ id: 'c-1', slideIndex: 0, tStart: 0, tEnd: 5, text: 'welcome to hashing' }, { id: 'c-2', slideIndex: 1, tStart: 5, tEnd: 10, text: 'chaining uses linked lists' }])
  const s = await lib.setSummary(l.id, 'Hashing, collisions and resizing.')
  assert.equal(s.noteCount, 1)
  assert.equal(s.slideCount, 2)
  assert.equal(s.hasSummary, true)
  const full = await lib.getLecture(l.id)
  assert.match(full.slides[0].image, /^data:image\/png;base64,/)
  assert.equal(full.slides[1].image, null)
  assert.deepEqual(full.notes.map((n) => n.text), ['Use a prime table size m'])
  assert.ok(full.notes[0].savedAt)
  assert.deepEqual(full.transcript.map((c) => c.id), ['c-1', 'c-2'])
  assert.equal(full.summary, 'Hashing, collisions and resizing.')
  structuredClone(full) // IPC-safe
})

test('search is scoped to ONE lecture; searchAll queries each; deleting/rebuilding one never touches another', async () => {
  const lib = await createLibrary({ dir: tmp(), embed: fakeEmbed })
  const m = await lib.createModule({ name: 'M' })
  const a = await lib.createLecture(m.id, { title: 'A' })
  const b = await lib.createLecture(m.id, { title: 'B' })
  await lib.saveNote(a.id, note('a1', 2, 'open addressing probes for a free slot'))
  await lib.saveNote(a.id, note('a2', 3, 'resize when the load factor gets high'))
  await lib.saveNote(b.id, note('b1', 1, 'binary trees have left and right children'))

  const hitsA = await lib.search(a.id, 'probes free slot', 3)
  assert.equal(hitsA[0].refId, 'a1')
  assert.equal(hitsA[0].slideIndex, 2)
  assert.ok(hitsA.every((h) => h.lectureId === a.id))
  assert.equal((await lib.search(b.id, 'probes free slot', 3)).filter((h) => h.refId === 'a1').length, 0)

  const all = await lib.searchAll('binary trees children', 2)
  assert.equal(all[0].refId, 'b1')
  assert.equal(all[0].lectureId, b.id)

  await lib.rebuildIndex(a.id)
  assert.equal((await lib.search(b.id, 'binary trees', 1))[0].refId, 'b1')
  await lib.deleteLecture(a.id)
  assert.equal((await lib.listLectures(m.id)).length, 1)
  assert.equal((await lib.getLecture(b.id)).notes.length, 1)
  await assert.rejects(lib.getLecture(a.id), /not found/)
})

test('search works without an embedder (keyword fallback) and survives a failing embedder', async () => {
  const lib = await createLibrary({ dir: tmp(), embed: async () => { throw new Error('model not loaded') } })
  const m = await lib.createModule({ name: 'M' })
  const l = await lib.createLecture(m.id, { title: 'L' })
  await lib.saveNote(l.id, note('n1', 0, 'Separate chaining keeps a list per bucket'))
  const hits = await lib.search(l.id, 'chaining bucket')
  assert.equal(hits[0].refId, 'n1')
})

test('startSession records slides + transcript + generated notes (H-2) from the bus; endSession marks attended', async () => {
  const bus = new EventEmitter()
  const changes = []
  bus.on('library:changed', (c) => changes.push(c))
  const lib = await createLibrary({ dir: tmp(), embed: fakeEmbed, bus })
  const m = await lib.createModule({ name: 'M' })
  const l = await lib.createLecture(m.id, { title: 'Live' })
  await lib.startSession(l.id)
  assert.equal(lib.activeLecture(), l.id)
  assert.equal((await lib.getLecture(l.id)).state, 'live')
  bus.emit('slides:loaded', [{ index: 0, text: 'Intro' }])
  bus.emit('transcript:chunk', { id: 'c-1', slideIndex: 0, tStart: 0, tEnd: 4, text: 'hello class' })
  bus.emit('note:added', { ...note('n9', 0, 'auto-saved now'), sourceChunkIds: ['c-1'] })
  await lib.endSession()
  const full = await lib.getLecture(l.id)
  assert.equal(full.state, 'attended')
  assert.equal(full.slides.length, 1)
  assert.equal(full.transcript.length, 1)
  assert.equal(full.notes.length, 1)
  assert.deepEqual(full.notes[0].sourceChunkIds, ['c-1'])
  assert.equal(full.notes[0].important, false)
  assert.equal(lib.activeLecture(), null)
  assert.ok(changes.some((c) => c.what === 'lecture' && c.lectureId === l.id))
})

test('share -> import a lecture between two libraries; imported notes tagged shared and re-embedded locally', async () => {
  const alice = await createLibrary({ dir: tmp(), embed: fakeEmbed, bootstrap })
  const m = await alice.createModule({ name: 'COMP26120' })
  const l = await alice.createLecture(m.id, { title: 'Week 3 · Hash Tables' })
  await alice.saveSlides(l.id, [{ index: 0, text: 'Hash tables' }])
  await alice.saveNote(l.id, note('n1', 0, 'prime table sizes spread keys'))
  await alice.setSummary(l.id, 'Hashing basics')
  const { link } = await alice.shareLecture(l.id, { sharedBy: 'Alice' })
  assert.match(link, /^lecscribe:\/\/week\//)

  const bob = await createLibrary({ dir: tmp(), embed: fakeEmbed, bootstrap })
  const bm = await bob.createModule({ name: 'COMP26120' })
  const missed = await bob.createLecture(bm.id, { title: 'Week 3 · Hash Tables', state: 'missed' })
  const got = await bob.importLecture(missed.id, link, { timeoutMs: 15000 })
  assert.equal(got.state, 'imported')
  assert.equal(got.sharedBy, 'Alice')
  assert.equal(got.notes.length, 1)
  assert.equal(got.notes[0].shared, true)
  assert.equal(got.summary, 'Hashing basics')
  assert.equal(got.slides[0].text, 'Hash tables')
  assert.equal((await bob.search(missed.id, 'prime table sizes'))[0].refId, 'n1')
  await alice.close()
  await bob.close()
})

test('with aryan search helpers: transcript indexed as passages, hybrid ranking, store rebuilt when embedder changes', async () => {
  const { searchEmbedder, transcriptPassages, hybridScore } = await import('../ai/search.js')
  const dir = tmp()
  // 1) a store made by the plain embedder...
  const plain = await createLibrary({ dir, embed: fakeEmbed })
  const m = await plain.createModule({ name: 'M' })
  const l = await plain.createLecture(m.id, { title: 'L' })
  await plain.saveNote(l.id, note('n1', 1, 'open addressing probes for a free slot'))
  // 2) ...opened with the helpers: first search rebuilds it with embedDocs
  const se = searchEmbedder(fakeEmbed)
  let docCalls = 0
  const lib = await createLibrary({ dir, embed: fakeEmbed, embedQuery: se.query, embedDocs: (t) => { docCalls++; return se.docs(t) }, passages: transcriptPassages, score: hybridScore })
  const chunks = [
    { id: 'c-1', slideIndex: 0, tStart: 0, tEnd: 5, text: 'welcome to hash tables' },
    { id: 'c-2', slideIndex: 0, tStart: 5, tEnd: 10, text: 'a hash function maps keys to buckets' },
    { id: 'c-3', slideIndex: 1, tStart: 10, tEnd: 15, text: 'collisions happen when two keys share a bucket' }
  ]
  for (const c of chunks) await lib.appendTranscript(l.id, [c])
  const hits = await lib.search(l.id, 'probes free slot', 5)
  assert.equal(hits[0].refId, 'n1')
  const tx = await lib.search(l.id, 'hash function buckets', 5)
  const passage = tx.find((h) => h.kind === 'transcript')
  assert.ok(passage, 'transcript passage is searchable')
  assert.deepEqual(passage.chunkIds, ['c-1', 'c-2'], 'chunks of the same slide merged into one passage')
  assert.equal(passage.slideIndex, 0)
  const { readFileSync } = await import('node:fs')
  await lib.flush()
  const store = JSON.parse(readFileSync(join(dir, 'lectures', l.id, 'vectors.json'), 'utf8'))
  assert.equal(store.embedder, 'docs-v1')
  assert.equal(store.items.filter((it) => it.kind === 'transcript').length, 2)
  assert.ok(docCalls > 0)
})

test('personal notes: CRUD per slide, persist, searchable as kind personal, never exported/shared, never note:added', async () => {
  const dir = tmp()
  const bus = new EventEmitter()
  const noteAdded = []
  bus.on('note:added', (n) => noteAdded.push(n))
  const lib = await createLibrary({ dir, embed: fakeEmbed, bus, bootstrap })
  const m = await lib.createModule({ name: 'M' })
  const l = await lib.createLecture(m.id, { title: 'L' })
  await lib.saveNote(l.id, note('n1', 0, 'shared AI sticky about hashing'))

  const a = await lib.addPersonalNote(l.id, { slideIndex: 2, text: 'ask about tombstones in the exam review' })
  const b = await lib.addPersonalNote(l.id, { slideIndex: 2, text: '' }) // empty draft, not indexed
  await lib.addPersonalNote(l.id, { slideIndex: 3, text: 'redo the resize example' })
  assert.equal(a.kind, 'personal')
  assert.deepEqual((await lib.listPersonalNotes(l.id, 2)).map((n) => n.id), [a.id, b.id])
  assert.equal((await lib.listPersonalNotes(l.id)).length, 3)

  const u = await lib.updatePersonalNote(l.id, b.id, { text: 'linear probing\nis cache friendly' })
  assert.equal(u.text, 'linear probing\nis cache friendly')
  await lib.deletePersonalNote(l.id, a.id)
  assert.deepEqual((await lib.listPersonalNotes(l.id, 2)).map((n) => n.id), [b.id])

  // persistence across instances
  const lib2 = await createLibrary({ dir, embed: fakeEmbed })
  assert.equal((await lib2.listPersonalNotes(l.id)).length, 2)
  assert.equal((await lib2.getLecture(l.id)).personalNotes.length, 2)
  assert.equal((await lib2.listLectures(m.id))[0].personalCount, 2)

  // searchable, kind personal; deleted note gone from the index
  const hits = await lib.search(l.id, 'linear probing cache friendly', 3)
  assert.equal(hits[0].kind, 'personal')
  assert.equal(hits[0].refId, b.id)
  assert.equal(hits[0].slideIndex, 2)
  assert.ok(!(await lib.search(l.id, 'tombstones exam review', 5)).some((h) => h.refId === a.id))
  await lib.rebuildIndex(l.id)
  assert.equal((await lib.search(l.id, 'resize example', 1))[0].kind, 'personal')

  // never leaves the device
  const bundle = await lib.exportLecture(l.id)
  assert.deepEqual(bundle.notes.map((n) => n.id), ['n1'])
  assert.ok(!JSON.stringify(bundle).includes('cache friendly'))
  assert.equal(bundle.personalNotes, undefined)
  const { link } = await lib.shareLecture(l.id)
  const other = await createLibrary({ dir: tmp(), embed: fakeEmbed, bootstrap })
  const om = await other.createModule({ name: 'M' })
  const missed = await other.createLecture(om.id, { title: 'L', state: 'missed' })
  const got = await other.importLecture(missed.id, link, { timeoutMs: 15000 })
  assert.equal(got.notes.length, 1)
  assert.equal(got.personalNotes.length, 0)
  assert.equal(noteAdded.length, 0, 'personal notes must never be emitted as note:added')
  await lib.close(); await other.close()
})

test('H-2: star notes (setNoteImportant), re-save keeps the star, listImportant groups by lecture in lecture order', async () => {
  const dir = tmp()
  const bus = new EventEmitter()
  const lib = await createLibrary({ dir, embed: fakeEmbed, bus })
  const m = await lib.createModule({ name: 'COMP26120' })
  const other = await lib.createModule({ name: 'Other' })
  const w4 = await lib.createLecture(m.id, { title: 'Week 4', date: '2026-11-10' })
  const w3 = await lib.createLecture(m.id, { title: 'Week 3', date: '2026-11-03' })
  const o1 = await lib.createLecture(other.id, { title: 'Elsewhere' })

  await lib.startSession(w3.id)
  bus.emit('note:added', { ...note('a', 2, 'linear probing is cache friendly'), sourceChunkIds: ['c-7'] })
  bus.emit('note:added', { ...note('b', 0, 'python dict uses open addressing'), kind: 'lecturer' })
  await lib.endSession()
  assert.equal((await lib.getLecture(w3.id)).notes.length, 2)

  const starred = await lib.setNoteImportant(w3.id, 'a', true)
  assert.equal(starred.important, true)
  await lib.saveNote(w3.id, note('a', 2, 'linear probing is cache friendly (edited)')) // re-save keeps the star
  assert.equal((await lib.getLecture(w3.id)).notes.find((n) => n.id === 'a').important, true)
  // star a note that was never saved (e.g. clicked while not recording): saved + starred in one go
  await lib.setNoteImportant(w4.id, 'z', true, note('z', 1, 'trees: AVL rotations'))
  await lib.setNoteImportant(o1.id, 'x', true, note('x', 0, 'other module'))
  await assert.rejects(lib.setNoteImportant(w4.id, 'missing', true), /not found/)

  const list = await lib.listImportant(m.id)
  assert.deepEqual(list.map((g) => g.lectureTitle), ['Week 3', 'Week 4']) // lecture order, other module excluded
  assert.deepEqual(list[0].notes.map((n) => n.id), ['a'])
  assert.equal(list[0].notes[0].slideIndex, 2)
  assert.deepEqual(list[0].notes[0].sourceChunkIds, ['c-7'])

  await lib.setNoteImportant(w3.id, 'a', false)
  assert.deepEqual((await lib.listImportant(m.id)).map((g) => g.lectureTitle), ['Week 4'])
  // persisted + searchable
  const lib2 = await createLibrary({ dir, embed: fakeEmbed })
  assert.equal((await lib2.listImportant(m.id))[0].notes[0].id, 'z')
  assert.equal((await lib2.search(w4.id, 'AVL rotations', 1))[0].refId, 'z')
})

test('B-017: vector store is cached + flushed debounced (no rewrite per chunk), compact v2 on disk, v1 files still read', async () => {
  const { readFileSync, writeFileSync, statSync } = await import('node:fs')
  const dir = tmp()
  const lib = await createLibrary({ dir, embed: fakeEmbed })
  const m = await lib.createModule({ name: 'M' })
  const l = await lib.createLecture(m.id, { title: 'Long lecture' })
  const file = join(dir, 'lectures', l.id, 'vectors.json')
  const before = readFileSync(file, 'utf8')
  for (let i = 0; i < 150; i++) await lib.appendTranscript(l.id, [{ id: `c-${i}`, slideIndex: i % 5, tStart: i * 5, tEnd: i * 5 + 5, text: `chunk number ${i} about hashing and probing` }])
  assert.equal(readFileSync(file, 'utf8'), before, 'not rewritten on every chunk')
  assert.ok((await lib.search(l.id, 'chunk number 149', 1))[0].refId) // served from memory
  await lib.flush()
  const text = readFileSync(file, 'utf8')
  const disk = JSON.parse(text)
  assert.equal(disk.v, 2)
  assert.equal(disk.items.length, 150)
  assert.equal(typeof disk.items[0].vec, 'string') // base64 Float32, not a JSON number array
  assert.ok(!text.includes('\n  '), 'no pretty-printing')
  assert.ok(statSync(file).size < 150 * 2000, `compact: ${statSync(file).size} bytes`)

  // a v1 file (vector: number[]) written by an older build is still searchable
  const old = await lib.createLecture(m.id, { title: 'Old format' })
  const oldFile = join(dir, 'lectures', old.id, 'vectors.json')
  await lib.flush()
  const v = await fakeEmbed('legacy note about tombstones')
  writeFileSync(oldFile, JSON.stringify({ dim: v.length, embedder: 'plain-v1', items: [{ id: 'note-x', kind: 'note', refId: 'x', slideIndex: 1, text: 'legacy note about tombstones', vector: v }] }, null, 2))
  const fresh = await createLibrary({ dir: join(dir, '.', ''), embed: fakeEmbed }) // same dir, other spelling
  const { dropStore } = await import('./vecstore.js')
  dropStore(oldFile) // simulate a new process that has not cached it yet
  assert.equal((await fresh.search(old.id, 'tombstones', 1))[0].refId, 'x')
  await lib.close()
})
