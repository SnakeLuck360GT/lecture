// Library facade (S5 data layer). Owner: aaron. Contract: coord/contracts/stage-5-library.md
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createLibrary } from './library.js'

export { createLibrary } from './library.js'
export { cosine, rank } from './vectors.js'

/**
 * App-shell adapter: src/core/main.js calls startLibrary({ bus, ai: () => ai, dir }) and routes
 * window.lec.library(method, ...args) to the returned object.
 * dir: app.getPath('userData')/library (fallback ~/.lecscribe/library).
 */
export async function startLibrary ({ bus, ai = () => null, dir } = {}) {
  const getAi = typeof ai === 'function' ? ai : () => ai
  const has = (m) => typeof getAi()?.[m] === 'function'
  const need = (m) => { const a = getAi(); if (!a || typeof a[m] !== 'function') throw new Error(`AI ${m} not available`); return a[m].bind(a) }
  return createLibrary({
    dir: dir || join(homedir(), '.lecscribe', 'library'),
    bus,
    embed: async (texts) => need('embed')(texts),
    // aryan's search helpers (src/ai/search.js), used when the AI facade has them
    embedQuery: has('embedQuery') ? (q) => need('embedQuery')(q) : undefined,
    embedDocs: has('embedDocs') ? (texts) => need('embedDocs')(texts) : undefined,
    passages: has('transcriptPassages') ? (chunks) => getAi().transcriptPassages(chunks) : undefined,
    score: has('hybridScore') ? (o) => getAi().hybridScore(o) : undefined
  })
}
export default startLibrary
