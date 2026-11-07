// S8 share link: export/import one week's notes as text over Pears. Owner: aaron. Contract: coord/contracts/stage-8.md
import Corestore from 'corestore'
import { defaultStorage, parseKey, weekLink, makeSwarm, joinTopic } from './util.js'

/** Seed a week's bundle. Returns { key, link, stop() }. The link works while this device stays online. */
export async function shareWeek (bundle, { storage, bootstrap } = {}) {
  if (!bundle || typeof bundle !== 'object') throw new Error('shareWeek: bundle is required')
  const store = new Corestore(storage || defaultStorage('share'))
  const core = store.get({ name: 'week-share', valueEncoding: 'json' })
  await core.ready()
  if (core.length === 0) {
    const notes = Array.isArray(bundle.notes) ? bundle.notes : []
    const blocks = [{
      type: 'meta',
      v: 1,
      moduleId: bundle.moduleId ?? null,
      weekId: bundle.weekId ?? null,
      title: bundle.title ?? '',
      sharedBy: bundle.sharedBy ?? null,
      exportedAt: bundle.exportedAt ?? Date.now()
    }]
    if (Array.isArray(bundle.slides)) blocks.push({ type: 'slides', slides: bundle.slides.map((s) => ({ index: s.index, text: s.text || '' })) })
    for (const note of notes) blocks.push({ type: 'note', note })
    if (bundle.summary) blocks.push({ type: 'summary', text: String(bundle.summary) })
    if (Array.isArray(bundle.transcript)) blocks.push({ type: 'transcript', chunks: bundle.transcript })
    blocks.push({ type: 'end', count: notes.length })
    await core.append(blocks)
  }
  const swarm = makeSwarm(store, { bootstrap })
  const topic = joinTopic(swarm, core.discoveryKey, { server: true, client: false })
  // Wait until the link is announced on the DHT, so it works the moment we hand it out.
  await topic.flushed.catch(() => {})
  let stopped = false
  return {
    key: core.key.toString('hex'),
    link: weekLink(core.key),
    async stop () {
      if (stopped) return
      stopped = true
      await swarm.destroy().catch(() => {})
      await store.close().catch(() => {})
    }
  }
}

/** Pull a shared week directly from a device holding it. Throws Error('BAD_LINK') / Error('SHARE_TIMEOUT'). */
export async function importWeek (link, { storage, bootstrap, timeoutMs = 30000, onProgress } = {}) {
  const key = parseKey(link) // throws BAD_LINK
  const store = new Corestore(storage || defaultStorage('import'))
  const core = store.get({ key, valueEncoding: 'json' })
  await core.ready()
  const swarm = makeSwarm(store, { bootstrap })
  const topic = joinTopic(swarm, core.discoveryKey, { server: false, client: true })

  const deadline = Date.now() + timeoutMs
  const bundle = { v: 1, moduleId: null, weekId: null, title: '', sharedBy: null, slides: [], notes: [], summary: '', transcript: [], exportedAt: null }
  try {
    for (let i = 0; ; i++) {
      const left = deadline - Date.now()
      if (left <= 0) throw timeoutError()
      let block
      try {
        block = await core.get(i, { timeout: left })
      } catch (err) {
        throw /timeout/i.test(String(err?.code || err?.message)) ? timeoutError() : err
      }
      if (!block) throw timeoutError()
      if (block.type === 'meta') Object.assign(bundle, { v: block.v, moduleId: block.moduleId, weekId: block.weekId, title: block.title, sharedBy: block.sharedBy, exportedAt: block.exportedAt })
      else if (block.type === 'slides') bundle.slides = block.slides || []
      else if (block.type === 'note') bundle.notes.push({ ...block.note, shared: true })
      else if (block.type === 'summary') bundle.summary = block.text || ''
      else if (block.type === 'transcript') bundle.transcript = block.chunks || []
      if (onProgress) onProgress({ blocks: i + 1, notes: bundle.notes.length })
      if (block.type === 'end') break
    }
    return bundle
  } finally {
    topic.stop()
    await swarm.destroy().catch(() => {})
    await store.close().catch(() => {})
  }
}

function timeoutError () {
  const err = new Error('SHARE_TIMEOUT')
  err.code = 'SHARE_TIMEOUT'
  return err
}
