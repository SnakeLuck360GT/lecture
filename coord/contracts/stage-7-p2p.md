# Stage 7 (P2P half) contract: "I'm lost" taps + host merge (owner: aaron, folders `src/p2p/`, `scripts/sim-taps*`)
Status: DRAFT v1 (13:35). The AI half (Explain slide) is in stage-7-ai.md (aryan). UI (button, heatmap) is filip's.

## How it works
- Each PEER device has its **own Hypercore** ("lost log", `valueEncoding: 'json'`). A tap appends `{ type: 'lost', slideIndex, on: true|false, t }`.
- The peer tells the host its log key over a Hypercore extension `lecscribe/lost-v1` on the room feed (`{ logKey }`). The host opens each log, live-reads it and merges.
- **Count rule:** per slide, count the DEVICES whose latest entry for that slide is `on: true`. One device counts at most once per slide, and tapping again toggles it off. Only counts leave the merge, never names or device IDs.

## API
```js
// PEER (from joinRoom, see stage-6.md)
peer.lost(slideIndex, on = true) -> Promise<void>   // filip's "I'm lost" button (pass on=false to un-tap)
peer.lostState()                 -> { [slideIndex]: true }   // lets the button show pressed/unpressed

// HOST (from createRoom)
room.lostCounts()                -> { [slideIndex]: count }
room.simulateLost(slideIndex, n) // local-only stage fallback if the network fails: adds n fake devices
```

## Events
```
HOST bus emits  'lost:counts' { [slideIndex]: count }   // on every change (debounced ~200 ms); slides with 0 are omitted
PEER bus emits  'lost:state'  { [slideIndex]: true }    // after the device's own tap
```
The host also republishes counts into the room feed (`{ type: 'lost', counts }`), so peers *could* show the heatmap too (optional).

## Tap simulator (demo + tests): `scripts/sim-taps.js`
```
node scripts/sim-taps.js <roomKeyOrLink> [--devices 8] [--slide 3] [--spread "2:3,3:6"] [--delay 400] [--stay]
```
This starts N real fake peer devices in one process (each with its own Corestore + lost log), joins the room over Hyperswarm and taps on cue. The heatmap lights up over real Pears, which also shows off P2P on stage. `--spread "slide:count,..."` spreads taps over several slides, and `--delay` sets the ms between taps. The script exits once the taps have replicated, or stays online with `--stay`.
- npm script (filip, small addition): `"sim-taps": "node scripts/sim-taps.js"`.
- Offline fallback: `room.simulateLost(slide, n)`, which filip can wire to a hidden key on the host (e.g. Shift+L).

## Explain-slide notes
These are just `note:added` with `kind: 'lecturer'`. S6 already forwards them to every peer, so nothing extra is needed here.
