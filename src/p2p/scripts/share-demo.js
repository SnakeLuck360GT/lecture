#!/usr/bin/env node
// S8 manual test (owner: aaron). Public DHT.
//   node src/p2p/scripts/share-demo.js share [bundle.json]   -> prints a lecscribe://week/... link and stays online
//   node src/p2p/scripts/share-demo.js import <link>         -> prints the imported bundle
import { readFileSync } from 'node:fs'
import { shareWeek, importWeek } from '../index.js'

const [mode, arg] = process.argv.slice(2)
const SAMPLE = {
  v: 1,
  moduleId: 'COMP26120',
  weekId: 'w3',
  title: 'Week 3: Hash Tables',
  sharedBy: 'a coursemate',
  slides: [{ index: 0, text: 'Hash Tables' }, { index: 1, text: 'Hash functions' }],
  notes: [
    { id: 'n1', slideIndex: 1, kind: 'ai', text: 'Pick a prime table size m so k mod m spreads keys', sourceChunkIds: ['c-3'], createdAt: Date.now() },
    { id: 'n2', slideIndex: 1, kind: 'lecturer', text: 'Lecturer explanation: think of buckets as pigeonholes', sourceChunkIds: [], createdAt: Date.now() }
  ],
  summary: 'Hash functions map keys to buckets; collisions are handled by chaining or probing.',
  transcript: [],
  exportedAt: Date.now()
}

if (mode === 'share') {
  const bundle = arg ? JSON.parse(readFileSync(arg, 'utf8')) : SAMPLE
  const share = await shareWeek(bundle)
  console.log('\nSHARE LINK:', share.link, '\n(sharing', bundle.notes?.length || 0, 'notes; Ctrl+C to stop)')
  process.on('SIGINT', async () => { await share.stop(); process.exit(0) })
} else if (mode === 'import' && arg) {
  const t0 = Date.now()
  const bundle = await importWeek(arg, { onProgress: (p) => process.stdout.write(`\r  ${p.blocks} blocks, ${p.notes} notes`) })
  console.log(`\nimported in ${((Date.now() - t0) / 1000).toFixed(1)} s:\n`, JSON.stringify(bundle, null, 2))
  process.exit(0)
} else {
  console.error('usage: share-demo.js share [bundle.json] | share-demo.js import <link>')
  process.exit(2)
}
