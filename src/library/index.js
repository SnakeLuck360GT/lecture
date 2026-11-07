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
  return createLibrary({
    dir: dir || join(homedir(), '.lecscribe', 'library'),
    bus,
    embed: async (texts) => {
      const a = getAi()
      if (!a || typeof a.embed !== 'function') throw new Error('AI embed not available')
      return a.embed(texts)
    }
  })
}
export default startLibrary
