#!/usr/bin/env node
// S7 demo tap simulator (owner: aaron). Starts N fake peer devices over real Pears (Hyperswarm), each with
// its own Corestore + "lost" log, joins the host's room and taps "I'm lost" on cue so the heatmap lights up.
//
//   node scripts/sim-taps.js <roomKeyOrLink> [--devices 8] [--slide 3] [--spread "2:3,3:6"] [--delay 400] [--stay]
//   npm run sim-taps -- <roomKeyOrLink> --slide 2 --devices 6
//
// --slide is the 0-based slide index (the same index as Slide.index / the bus events).
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import { joinRoom } from '../src/p2p/index.js'

function parseArgs (argv) {
  const out = { key: null, devices: 8, slide: null, spread: null, delay: 400, stay: false, timeout: 60000 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--devices') out.devices = parseInt(argv[++i], 10)
    else if (a === '--slide') out.slide = parseInt(argv[++i], 10)
    else if (a === '--spread') out.spread = argv[++i]
    else if (a === '--delay') out.delay = parseInt(argv[++i], 10)
    else if (a === '--timeout') out.timeout = parseInt(argv[++i], 10)
    else if (a === '--stay') out.stay = true
    else if (!a.startsWith('--') && !out.key) out.key = a
  }
  return out
}

/** -> list of slide indexes, one per tap. "2:3,3:6" = 3 taps on slide 2 and 6 on slide 3. */
export function planTaps ({ devices, slide, spread }) {
  if (spread) {
    const taps = []
    for (const part of spread.split(',')) {
      const [s, n] = part.split(':').map((x) => parseInt(x, 10))
      if (Number.isInteger(s) && Number.isInteger(n)) for (let i = 0; i < n; i++) taps.push(s)
    }
    return taps
  }
  return Array.from({ length: devices }, () => (Number.isInteger(slide) ? slide : 0))
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main () {
  const opts = parseArgs(process.argv.slice(2))
  if (!opts.key) {
    console.error('usage: node scripts/sim-taps.js <roomKeyOrLink> [--devices 8] [--slide 3] [--spread "2:3,3:6"] [--delay 400] [--stay]')
    process.exit(2)
  }
  const taps = planTaps(opts)
  // one device per tap, but a device never taps the same slide twice (that would not count twice anyway)
  const deviceCount = Math.max(...Object.values(taps.reduce((m, s) => ({ ...m, [s]: (m[s] || 0) + 1 }), {})), 1)
  console.log(`sim-taps: ${deviceCount} fake device(s), ${taps.length} tap(s) -> joining room...`)

  const devices = []
  const connected = []
  for (let i = 0; i < deviceCount; i++) {
    const bus = new EventEmitter()
    connected.push(new Promise((resolve) => bus.on('p2p:status', (s) => { if (s.state === 'connected') resolve() })))
    devices.push(await joinRoom({ bus, key: opts.key }))
  }
  const t = setTimeout(() => { console.error('sim-taps: could not reach the host (is it online? same key?)'); process.exit(1) }, opts.timeout)
  await Promise.all(connected)
  clearTimeout(t)
  console.log('sim-taps: all devices connected')

  const used = new Map() // slide -> next device index
  for (const slide of taps) {
    const d = used.get(slide) || 0
    used.set(slide, d + 1)
    await devices[d].lost(slide)
    console.log(`  device ${d + 1} tapped "I'm lost" on slide ${slide}`)
    await sleep(opts.delay)
  }

  if (opts.stay) {
    console.log('sim-taps: staying online (Ctrl+C to quit)')
    process.on('SIGINT', async () => { for (const d of devices) await d.close(); process.exit(0) })
    return
  }
  await sleep(3000) // let the host pull the last log entries
  for (const d of devices) await d.close()
  console.log('sim-taps: done')
  process.exit(0)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => { console.error('sim-taps failed:', err.message); process.exit(1) })
}
