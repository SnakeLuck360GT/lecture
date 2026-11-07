// Contract tests for PERSONAL NOTES (human feature 15:08, owner aaron; spec in coord/PLAN.md "HUMAN FEATURE").
// Personal notes are local to each device: never on the bus, never in the room, never in exports/shares, but searchable.
// PENDING until the library exposes addPersonalNote.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { src, pending, maybeImport, recordingBus } from './../helpers.mjs'

const LIB = src('library', 'index.js')
const tmp = () => mkdtempSync(join(tmpdir(), 'lecscribe-pn-'))
const DIM = 64
function vec (t) {
  const v = new Array(DIM).fill(0)
  for (const w of String(t).toLowerCase().match(/[a-z0-9]{3,}/g) || []) { let h = 2166136261; for (const c of w) h = Math.imul(h ^ c.charCodeAt(0), 16777619); v[(h >>> 0) % DIM] += 1 }
  const n = Math.hypot(...v) || 1; return v.map((x) => x / n)
}
const embed = async (x) => (Array.isArray(x) ? x.map(vec) : vec(x))

let skip = pending(LIB, 'library (aaron)')
if (!skip) {
  const lib = await (await maybeImport(LIB)).createLibrary({ dir: tmp(), embed })
  if (typeof lib.addPersonalNote !== 'function') skip = 'PENDING: library.addPersonalNote not merged yet (personal notes, aaron)'
}

async function setup () {
  const { createLibrary } = await maybeImport(LIB)
  const bus = recordingBus(); const dir = tmp()
  const lib = await createLibrary({ dir, embed, bus })
  const m = await lib.createModule({ name: 'Algorithms' })
  const L = await lib.createLecture(m.id, { title: 'Week 3 · Hash Tables' })
  return { lib, bus, dir, m, L, createLibrary }
}

describe('Personal notes: local to each device', { skip }, () => {
  test('add / list (by slide) / update / delete; persists across library instances', async () => {
    const { lib, dir, L, createLibrary } = await setup()
    const a = await lib.addPersonalNote(L.id, { slideIndex: 2, text: 'ask about double hashing\nin the lab' })
    const b = await lib.addPersonalNote(L.id, { slideIndex: 3, text: 'alpha = how full the car park is' })
    assert.equal(typeof a.id, 'string'); assert.equal(a.slideIndex, 2); assert.equal(a.text, 'ask about double hashing\nin the lab')
    assert.deepEqual((await lib.listPersonalNotes(L.id, 2)).map((n) => n.id), [a.id])
    assert.equal((await lib.listPersonalNotes(L.id)).length, 2)
    await lib.updatePersonalNote(L.id, a.id, { text: 'ask about double hashing' })
    const lib2 = await createLibrary({ dir, embed })
    assert.equal((await lib2.listPersonalNotes(L.id, 2))[0].text, 'ask about double hashing')
    await lib2.deletePersonalNote(L.id, b.id)
    assert.deepEqual((await lib2.listPersonalNotes(L.id)).map((n) => n.id), [a.id])
  })

  test('NEVER emitted as note:added on the bus (the host room republishes note:added)', async () => {
    const { lib, bus, L } = await setup()
    await lib.addPersonalNote(L.id, { slideIndex: 0, text: 'private thought' })
    assert.ok(!bus.events('note:added').some((n) => String(n?.text).includes('private thought')), 'personal note leaked onto the bus')
  })

  test('EXCLUDED from exportLecture (share links) and from the shared notes list', async () => {
    const { lib, L } = await setup()
    await lib.saveNote(L.id, { id: 'n-1', slideIndex: 1, kind: 'ai', text: 'Choose m prime', sourceChunkIds: [], createdAt: 1 })
    await lib.addPersonalNote(L.id, { slideIndex: 1, text: 'my secret mnemonic zebra' })
    const bundle = await lib.exportLecture(L.id)
    assert.ok(!JSON.stringify(bundle).includes('zebra'), 'personal note leaked into exportLecture')
    assert.deepEqual(bundle.notes.map((n) => n.id), ['n-1'])
  })

  test('searchable in that lecture only (own vector store), and via searchAll', async () => {
    const { lib, m, L } = await setup()
    const other = await lib.createLecture(m.id, { title: 'Week 4' })
    await lib.addPersonalNote(L.id, { slideIndex: 4, text: 'quokka platypus wombat' })
    const hits = await lib.search(L.id, 'quokka platypus wombat', 3)
    assert.ok(hits.some((h) => h.kind === 'personal' && h.slideIndex === 4), JSON.stringify(hits))
    assert.ok(!(await lib.search(other.id, 'quokka platypus wombat', 5)).some((h) => h.kind === 'personal'))
    assert.ok((await lib.searchAll('quokka platypus wombat', 3)).some((h) => h.kind === 'personal' && h.lectureId === L.id))
  })

  test('deleting a personal note removes it from search', async () => {
    const { lib, L } = await setup()
    const n = await lib.addPersonalNote(L.id, { slideIndex: 0, text: 'aardvark kumquat' })
    await lib.deletePersonalNote(L.id, n.id)
    assert.ok(!(await lib.search(L.id, 'aardvark kumquat', 5)).some((h) => h.kind === 'personal'))
  })
})
