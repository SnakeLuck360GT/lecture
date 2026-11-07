// Shared test helpers (owner: david). No external deps.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'

export const ROOT = fileURLToPath(new URL('..', import.meta.url))
export const fx = (...p) => join(ROOT, 'fixtures', ...p)
export const src = (...p) => join(ROOT, 'src', ...p)
export const REAL = process.env.LECSCRIBE_REAL === '1'

export const script = () => JSON.parse(readFileSync(fx('lecture.script.json'), 'utf8'))
export const slidesFixture = () => JSON.parse(readFileSync(fx('slides.json'), 'utf8'))

/** Import a module from the repo if it exists, else null (→ test is pending). */
export async function maybeImport (absPath) {
  if (!existsSync(absPath)) return null
  return import(pathToFileURL(absPath).href)
}
/** Skip reason when a stage's code isn't merged yet. */
export const pending = (absPath, stage) => existsSync(absPath) ? false : `PENDING: ${stage} not merged yet (${absPath.slice(ROOT.length)})`

/** Event bus matching PLAN.md: EventEmitter-like {on, off, emit}; records every event. */
export function recordingBus () {
  const bus = new EventEmitter()
  bus.setMaxListeners(100)
  bus.log = []
  const emit = bus.emit.bind(bus)
  bus.emit = (name, payload) => { bus.log.push({ name, payload, t: Date.now() }); return emit(name, payload) }
  bus.events = (name) => bus.log.filter((e) => e.name === name).map((e) => e.payload)
  return bus
}

/** Resolve when `pred()` is true, polling; reject after ms. */
export function waitFor (pred, ms = 10000, every = 50) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      let v; try { v = pred() } catch (e) { return reject(e) }
      if (v) return resolve(v)
      if (Date.now() - t0 > ms) return reject(new Error(`waitFor timed out after ${ms}ms`))
      setTimeout(tick, every)
    }
    tick()
  })
}

// Shape checkers from PLAN.md + contracts. Return a list of problems (empty = OK).
export function checkChunk (c) {
  const p = []
  if (typeof c?.id !== 'string' || !/^c-\d+$/.test(c.id)) p.push(`id ${JSON.stringify(c?.id)} !~ c-<n>`)
  if (!Number.isInteger(c?.slideIndex) || c.slideIndex < 0) p.push('slideIndex not a non-negative int')
  if (typeof c?.tStart !== 'number' || typeof c?.tEnd !== 'number' || c.tStart > c.tEnd) p.push('tStart/tEnd bad')
  if (typeof c?.text !== 'string') p.push('text not a string')
  return p
}
export function checkNote (n, kind) {
  const p = []
  if (typeof n?.id !== 'string' || !n.id) p.push('id missing')
  if (!Number.isInteger(n?.slideIndex) || n.slideIndex < 0) p.push('slideIndex bad')
  if (!['ai', 'lecturer'].includes(n?.kind)) p.push(`kind ${n?.kind}`)
  if (kind && n?.kind !== kind) p.push(`expected kind ${kind}, got ${n?.kind}`)
  if (typeof n?.text !== 'string' || !n.text.trim()) p.push('text empty')
  if (!Array.isArray(n?.sourceChunkIds)) p.push('sourceChunkIds not array')
  if (typeof n?.createdAt !== 'number') p.push('createdAt not a number (ms)')
  return p
}
