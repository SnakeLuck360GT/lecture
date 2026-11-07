# Stage 6 contract: Pears room (live slides + notes to peers) (owner: aaron, folder `src/p2p/`)
Status: v1.1 (13:54): added the app-shell adapter startP2P + createRoom({ history }). Source of truth for S6. S7 (lost taps) and S8 (share link) reuse the same module. v1.2 (15:06): transcript to peers (B-015); refreshNetwork() (PR #33).

## Runtime
- Plain ESM JS, runs in **Node / the Electron main process** (same place as `startAI`). Cross-platform: node `path`/`os` only, no shell scripts.
- npm deps (filip: add them to package.json, or I add them in my first PR and announce it): `hyperswarm@^4.17`, `corestore@^7.16`, `hypercore@^11.40`, `hyperdrive@^13.3`, `b4a`, `hypercore-id-encoding`. Verified from the installed READMEs (13:30). NB `@qvac/sdk` also bundles hyperswarm/corestore, so we may need to align versions.
- Storage: one Corestore per instance under `storage` (default `<os.tmpdir()>/lecscribe-p2p/<random>`), so two instances run fine on one machine.

## Facade: `src/p2p/index.js`
```js
import { createRoom, joinRoom } from './src/p2p/index.js'

// HOST (lecturer laptop, runs the models)
const room = await createRoom({ bus, storage?, title?, moduleId?, weekId? })
room.key        // 64-char hex string (Hypercore key of the room feed)
room.link       // 'lecscribe://room/<z32 key>'  -> show as text + QR (filip renders the QR from this string)
room.peers      // number of connected peers
await room.close()

// PEER (coursemate device, no models)
const peer = await joinRoom({ bus, key /* hex | z32 | lecscribe:// link */, storage? })
peer.lost(slideIndex, on?)   // S7, see stage-7-p2p.md
await peer.close()
```
`bus` = EventEmitter-like `{ on, off, emit }` (filip's main-process bus).

## App-shell adapter (what the renderer actually calls)
src/core/main.js auto-loads `startP2P({ bus, ai })` from src/p2p/index.js. Renderer: `await window.lec.p2p(method, ...args)` (all results are plain data):
| method | who | returns |
|---|---|---|
| `createRoom({ title?, moduleId?, weekId? })` | host | `{ role:host, key, link, peers }` (idempotent; publishes slides/notes already seen) |
| `joinRoom(linkOrKey)` | peer | `{ role:peer, key, connected }`. Stops local AI. Then slides:loaded / slide:changed / note:added arrive on the normal bus |
| `leaveRoom()` | both | `{ role:null }` |
| `info()` | both | current role/key/link/peers |
| `lost(slideIndex, on=true)` | peer | lostState `{ [slide]: true }` |
| `lostState()` / `lostCounts()` | peer / host | objects |
| `simulateLost(slideIndex, n)` | host | counts (offline stage fallback) |
| `shareWeek(bundle)` / `stopShare(key)` / `importWeek(link)` | any | `{ key, link }` / - / WeekBundle (stage-8.md) |

## HOST: events consumed (re-published to peers automatically)
| bus event | payload | what goes into the room |
|---|---|---|
| `slides:loaded` | `Slide[]` | slide text + image. `image` may be a file path, a Buffer or a `data:` URL; it is written to the room's Hyperdrive at `/slides/<index>.<ext>` |
| `slide:changed` | `{ index, source }` | current slide |
| `note:added` | `Note` (kind `'ai'` or `'lecturer'`) | the note |
| `transcript:chunk` | `TranscriptChunk` | the final transcript line (B-015, v1.2), replayed to late joiners |
| `transcript:partial` | `{ text, tStart, tEnd, slideIndex }` | NOT stored: sent live to connected peers over the `lecscribe/partial-v1` extension |

Late joiners get the full history (all slides, every note, current slide), because it's an append-only Hypercore.

## HOST: events emitted
```
'p2p:status'  { role: 'host', state: 'starting'|'open'|'error', key, link, error? }
'p2p:peers'   { count }
'lost:counts' { [slideIndex]: count }   // S7, see stage-7-p2p.md
```

## PEER: events emitted on the peer's own bus (the same shapes as the host bus, so the same viewer UI works)
```
'p2p:status'    { role: 'peer', state: 'connecting'|'connected'|'error', key, error? }
'slides:loaded' Slide[]   // image = data: URL read from the Hyperdrive
'slide:changed' { index, source: 'remote' }
'note:added'    Note      // same Note shape; save-to-notebook works exactly as on the host
'transcript:chunk'   TranscriptChunk            // v1.2 (B-015)
'transcript:partial' { text, tStart, tEnd, slideIndex }  // v1.2, live only (text, never audio)
'room:ended'    {}
```

## Wire format (internal, FYI for tests)
Room feed = Hypercore, `valueEncoding: 'json'`, one message per block:
```
{ type: 'room', v: 1, title, moduleId, weekId, driveKey, createdAt }   // block 0
{ type: 'slides', slides: [{ index, text, imagePath }] }
{ type: 'slide',  index, source, t }
{ type: 'note',   note: Note }
{ type: 'chunk',  chunk: TranscriptChunk }   // v1.2
{ type: 'lost',   counts }        // S7 counts republished (optional for peers)
{ type: 'end' }
```
Discovery: Hyperswarm topic = room feed `discoveryKey`. The host joins as server+client and each peer joins as client. Every connection runs `store.replicate(socket)`.

## UI needs (@filip)
- Host: a "Share room" control showing `room.link` as text + QR, plus the peer count from `p2p:peers`.
- Launch screen: "Join a room" paste box. It calls `joinRoom({ bus, key })` and opens the normal slide viewer in read-only/peer mode (no AI, no mic).

## How to run / test
- `node src/p2p/scripts/room-demo.js host` prints a key and appends fake slides + notes.
- `node src/p2p/scripts/room-demo.js join <key>` prints what arrives.
- Tests: `src/p2p/*.test.js` (host + peer in one process, same machine), picked up by `npm test`.
