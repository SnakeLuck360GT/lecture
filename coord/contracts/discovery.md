# Discovery contract: 6-digit join code + Nearby sessions (owner: aryan, `src/discovery/`, `ui/components/nearby-sessions.js`)
Status: v1 (15:20). Spec: PLAN.md "HUMAN FEATURE (15:12)". Integrators: @aaron (room-panel shows the code; join-room accepts a code), @filip (mounts nearby-sessions in the Library sidebar, adds `lec.discovery` to main/preload).

## Runtime
Node / Electron MAIN process. Uses only `node:dgram`, `node:os`, `node:crypto` + `hyperswarm` (already a dependency, `new Hyperswarm({ bootstrap? })`, `swarm.join(topic32, { server, client })`, `swarm.on('connection', (socket, info))`, verified in node_modules/hyperswarm/README.md). Cross-platform.

## API: `src/discovery/index.js`
```js
import { startDiscovery } from './src/discovery/index.js'
const disc = await startDiscovery({ bus, hostName?, port = 47474, bootstrap? /* tests */ })

await disc.advertise({ title, link }) -> { code }     // host: code = '482913' (6 digits; display as '482 913')
await disc.stopAdvertising()
disc.listNearby() -> [{ code, title, link, hostName, lastSeen }]   // sessions seen on the LAN in the last ~5 s
await disc.resolveCode(code, { timeoutMs = 8000 }) -> link          // LAN first, then DHT; throws err.code = 'CODE_NOT_FOUND' | 'BAD_CODE'
await disc.close()
```
- `code` input: digits only after stripping spaces/dashes (`'482 913'`, `'482-913'` ok). Anything else -> `BAD_CODE`.
- `advertise` again (new session) replaces the previous advert and returns a NEW code.

## Bus events (emitted on the main bus, so they reach the renderer)
- `discovery:nearby` `[{ code, title, link, hostName, lastSeen }]`, whenever the list changes (added / expired / title changed)
- `discovery:advertising` `{ code, title, link } | null`

## Renderer (@filip: small additions to main/preload)
`window.lec.discovery(method, ...args)` for `advertise | stopAdvertising | listNearby | resolveCode` (same pattern as `lec.ai` / `lec.p2p`). main: `const disc = await (await import('../src/discovery/index.js')).startDiscovery({ bus })` inside try/catch, `disc.close()` on quit.

## Mechanism
1. **LAN beacon** (hotspot, same Wi-Fi; no internet needed): host sends `{"v":1,"app":"lecscribe","code","title","link","hostName"}` (JSON, < 1 KB) every 1 s via UDP to multicast group `239.255.42.99:47474` AND to each IPv4 interface's subnet broadcast address. Every instance binds `0.0.0.0:47474` (`reuseAddr`) and joins the multicast group, so several instances on one machine all hear it. An entry expires 5 s after it was last seen. Own adverts are ignored.
2. **DHT fallback** (different networks): host joins Hyperswarm topic `sha256('lecscribe-code-v1:' + code)` as server and, on each connection, writes the same JSON and ends. `resolveCode` checks the LAN list first (instant), then waits up to ~1.5 s for a beacon, then joins the topic as client and reads the JSON.
3. Collisions: on `advertise`, if the new code is already on the LAN list, re-roll.

## Component: `ui/components/nearby-sessions.js`
`mountNearbySessions(el, { lec, onJoin(link, session) }) -> { destroy() }`
- A "Nearby sessions" list (title, host name, code as `482 913`, a pulsing live dot). It updates from `discovery:nearby` (via `lec.on`) and does an initial `lec.discovery('listNearby')`.
- Empty state: "No live sessions nearby. Ask the lecturer for the 6-digit code."
- Click a row -> `onJoin(link, session)`; filip/aaron wire it to the existing join flow.
- Styles self-injected, prefixed `.lec-nearby`, using filip's CSS tokens.

## Tests
`src/discovery/discovery.test.js`: beacon encode/decode + validation, expiry, code normalisation, 2 instances on one machine (advertise -> listNearby -> resolveCode via LAN), DHT resolve via `hyperdht/testnet`.

## Security note
A code is only a short pointer to the link, and the link is already shareable, so this adds no new exposure. Beacons carry title + link + host name only.
