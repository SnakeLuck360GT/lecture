#!/usr/bin/env node
// P2P network diagnostic (owner: aaron). Answers "why can't the peer connect?":
//   1. can this machine reach the public DHT, and what NAT does it have?
//   2. is anyone announcing the given room/week link right now?
//   3. can we actually open a connection to them (hole punch)?
//   node src/p2p/scripts/net-check.js [lecscribe://room/... | week link | key]
import { createRequire } from 'node:module'
import { parseKey } from '../util.js'

const require = createRequire(import.meta.url)
const DHT = require('hyperdht')
const Hypercore = require('hypercore')

const arg = process.argv[2]
const dht = new DHT()
const t0 = Date.now()
const secs = () => ((Date.now() - t0) / 1000).toFixed(1) + ' s'

try {
  await dht.fullyBootstrapped()
  console.log(`[1] DHT bootstrapped in ${secs()}  host=${dht.host} port=${dht.port} firewalled=${dht.firewalled} randomized-NAT=${dht.randomized ?? 'n/a'}`)
  if (dht.firewalled && dht.randomized) console.log('    ! randomized NAT: hole punching to another firewalled peer usually FAILS here -> use a phone hotspot')

  if (arg) {
    const topic = Hypercore.discoveryKey(parseKey(arg))
    const peers = []
    for await (const res of dht.lookup(topic)) for (const p of res.peers || []) {
      const k = p.publicKey.toString('hex')
      if (!peers.some((x) => x.k === k)) peers.push({ k, publicKey: p.publicKey, relays: (p.relayAddresses || []).map((a) => `${a.host}:${a.port}`) })
    }
    console.log(`[2] lookup done in ${secs()}: ${peers.length} peer(s) announcing this link`)
    for (const p of peers) console.log(`    - ${p.k.slice(0, 16)}...  relays: ${p.relays.join(', ') || '-'}`)
    if (!peers.length) console.log('    ! nobody is announcing it: is the host running with this exact link, and online?')

    for (const p of peers) {
      const t = Date.now()
      const ok = await new Promise((resolve) => {
        const s = dht.connect(p.publicKey)
        const timer = setTimeout(() => { s.destroy(); resolve('timeout after 20 s') }, 20000)
        s.on('open', () => { clearTimeout(timer); s.destroy(); resolve(`OK in ${((Date.now() - t) / 1000).toFixed(1)} s`) })
        s.on('error', (e) => { clearTimeout(timer); resolve(`FAILED: ${e.code || e.message}`) })
      })
      console.log(`[3] connect to ${p.k.slice(0, 16)}...: ${ok}`)
    }
  }
} catch (err) {
  console.error('net-check failed:', err.message)
} finally {
  await dht.destroy()
}
