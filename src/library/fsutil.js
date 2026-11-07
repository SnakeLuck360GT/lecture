// Small fs helpers for the library (owner: aaron). Atomic JSON writes, cross-platform paths.
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomBytes } from 'node:crypto'

export async function readJson (path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return fallback
    throw err
  }
}

export async function readText (path, fallback = '') {
  try { return await readFile(path, 'utf8') } catch (err) { if (err.code === 'ENOENT') return fallback; throw err }
}

/** Write to a temp file next to the target, then rename, so a crash never leaves half a file. */
export async function writeAtomic (path, data) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(tmp, data)
  await rename(tmp, path)
}

export const writeJson = (path, value) => writeAtomic(path, JSON.stringify(value, null, 2))

export const removeDir = (path) => rm(path, { recursive: true, force: true })

export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`

/** Per-key serial queues: jobs for the same key run one at a time, different keys run in parallel. */
export function keyedQueue () {
  const tails = new Map()
  return (key, fn) => {
    const prev = tails.get(key) || Promise.resolve()
    const p = prev.then(fn)
    const tail = p.catch(() => {})
    tails.set(key, tail)
    tail.then(() => { if (tails.get(key) === tail) tails.delete(key) })
    return p
  }
}
