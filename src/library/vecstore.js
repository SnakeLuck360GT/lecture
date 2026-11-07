// Per-lecture vector stores kept in memory and flushed to disk debounced (B-017 / H-3). Owner: aaron.
//
// Before: every transcript chunk re-read and re-wrote the whole pretty-printed vectors.json (768 floats per
// item as JSON text), which is O(n²) over a lecture (6.4 MB after 20 min, RSS churn on the main process).
// Now: one in-memory store per lecture (shared by every library instance on the same dir in this process),
// written at most once per FLUSH_MS, on endSession/close, and synchronously on process exit.
// File format v2: compact JSON, vectors as base64 Float32 (~4x smaller than JSON numbers). v1 files
// (`vector: number[]`) are still read.
import { writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { readJson, writeAtomic } from './fsutil.js'

const FLUSH_MS = 1000
const entries = new Map() // file path -> { store, dirty, timer }

const toF32 = (v) => (v instanceof Float32Array ? v : Float32Array.from(v))
const encodeVec = (v) => Buffer.from(toF32(v).buffer, toF32(v).byteOffset, toF32(v).byteLength).toString('base64')
function decodeVec (b64) {
  const buf = Buffer.from(b64, 'base64')
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

function decode (raw) {
  const store = { v: 2, dim: raw?.dim ?? null, embedder: raw?.embedder, items: [] }
  for (const it of raw?.items || []) {
    const { vec, vector, ...rest } = it
    store.items.push({ ...rest, vector: vec ? decodeVec(vec) : Array.isArray(vector) ? Float32Array.from(vector) : null })
  }
  return store
}
function serialize (store) {
  return JSON.stringify({
    v: 2,
    dim: store.dim ?? null,
    embedder: store.embedder,
    items: store.items.map(({ vector, ...rest }) => ({ ...rest, vec: vector && vector.length ? encodeVec(vector) : null }))
  })
}

/** The lecture's store (cached). */
export async function loadStore (file) {
  file = resolve(file)
  const e = entries.get(file)
  if (e) return e.store
  const store = decode(await readJson(file, { items: [] }))
  entries.set(file, { store, dirty: false, timer: null })
  return store
}

/** Replace/mark the store as changed; written within FLUSH_MS (or now with { now: true }). */
export async function saveStore (file, store, { now = false } = {}) {
  file = resolve(file)
  let e = entries.get(file)
  if (!e) { e = { store, dirty: false, timer: null }; entries.set(file, e) }
  e.store = store
  e.dirty = true
  if (now) return flushFile(file)
  if (!e.timer) {
    e.timer = setTimeout(() => { flushFile(file).catch((err) => console.error('[library] vector flush failed', err?.message || err)) }, FLUSH_MS)
    if (e.timer.unref) e.timer.unref()
  }
}

export async function flushFile (file) {
  file = resolve(file)
  const e = entries.get(file)
  if (!e) return
  clearTimeout(e.timer)
  e.timer = null
  if (!e.dirty) return
  e.dirty = false
  await writeAtomic(file, serialize(e.store))
}

/** Flush every store under a library dir (endSession / close). */
export async function flushUnder (dir) {
  const d = resolve(dir)
  for (const file of [...entries.keys()]) if (file.startsWith(d)) await flushFile(file)
}

/** Forget a store without writing it (lecture deleted). */
export function dropStore (file) {
  file = resolve(file)
  const e = entries.get(file)
  if (e) clearTimeout(e.timer)
  entries.delete(file)
}

// Last chance on exit: write anything still pending, synchronously.
process.once('exit', () => {
  for (const [file, e] of entries) {
    if (!e.dirty) continue
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file + '.tmp', serialize(e.store))
      renameSync(file + '.tmp', file)
    } catch {}
  }
})

