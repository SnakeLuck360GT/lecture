# BUGS
## dev health: 🟢 GREEN  (16:08, commit edd29df, 105/105 on the Mac; UI smoke ok)
## Open
### H-3 [P0] Random crashes in long live sessions; model efficiency (human 15:53)
- Owners: @aryan (AI leaks + worker watchdog, PR #56 merged), @filip (renderer DOM caps + crash handlers), @david (soak).
- Repro / evidence: `node tests/soak/soak.mjs 30 <out>` on the Mac (real models, AI + P2P host + peer + library session, lecture.wav looped live). 'Before' run (pre-#56) in progress since 15:56: no crash yet; temp files grow ~120/min (~11 MB/min): $TMPDIR lecscribe*/qvac* reached 4580 files / 251 MB from today's runs. QVAC workers ~3.7–4.2 GB RSS.
- Expected: 30 min with flat RSS, no temp growth, 0 crashes; a worker crash auto-recovers.
- Status: 'BEFORE' soak (16:27, pre-#56/#57, stopped at 25 min): 0 crashes, 0 unhandled; AI workers flat ~3.7 GB, node 114→284 MB; temp files +~150/min (6712 files / 409 MB) [fixed by #56?]; notes stalled for ~8 min; NEW B-016 (embed collisions) + B-017 (vectors.json O(n²)). NOTE: the Mac SLEPT on battery 16:10–16:19 (pmset DarkWake), so that gap is not an app freeze. Demo: plug in + caffeinate. 'AFTER' soak now running on dev with #56 + #57 (caffeinated).
### H-1 [P1] Slides/notes cropped and hard to read: per-page view, fit without cropping, zoom/pan, notes wrap (human 15:53)
- Owner: @filip. Verify: Mac, real PDF + a portrait/odd-aspect PDF, zoom in/out/fit, long sticky text not clipped.
- Status: OPEN (16:02)
### H-4 [P1] Summaries / notes with too little context (human via aaron 15:55)
- Owner: @aryan. Expected: notes agent runs only after ≥ ~40 words on a slide; summariseLecture needs ≥ ~80 words, else a clear "not enough lecture yet" message.
- Status: OPEN (16:02)
### H-5 [P1] Generated notes must never repeat the slide (human via aaron 15:58)
- Owner: @aryan. Expected: 0 on-slide/paraphrase notes in the fixture run (no note beats a repeat). Verify with live-demo + the live mic.
- Status: FIX CLAIMED (PR #61). Real-model verify after the soak (the Mac GPU is busy until ~16:27).
### H-6 [P1] NEW: "Explain this" for any user (peer too), answered by the HOST AI (aryan 16:01)
- Owners: @aryan (host AI answers explain:request → note:added kind 'explain'), @aaron (forward peer requests over the room), @filip (button host + peer, 'explain' style). Contract stage-7-ai v1.1.
- Verify: host click and peer click (Windows on the hotspot) → an 'explain' note on that slide on both devices, auto-saved (H-2).
- Status: ENGINE MERGED (PR #61: ai.explainThis + explain:request on host). Peer forwarding (@aaron, now OFFLINE) + button (@filip) pending.
### B-004 [P1] No microphone picker: demo needs the iPhone mic (Continuity) on the Mac
- Stage / owner: s1 (UI) / @aryan (reassigned from filip at , component ui/components/mic-picker.js)
- HUMAN REQUEST (david): the presenter will speak into an iPhone used as the Mac's microphone (macOS Continuity "iPhone Microphone"). The app must let us choose the input device.
- Repro: start the app, Start listening → always uses the default input; there's no way to pick another mic.
- Expected: a mic dropdown next to "Start listening" (aryan's `src/ai/browser/mic-capture.js` already has `listMics()` and `startMic(onChunk, { deviceId, onLevel })`). Remember the choice (localStorage). Show a small live input-level meter (onLevel) so we can see the mic is hot. Re-list on `navigator.mediaDevices.ondevicechange` (the iPhone appears/disappears). If the chosen device vanishes mid-session, fall back to default and show a toast.
- Status: FIX CLAIMED: picker mounted (PR #15). Needs the human's iPhone test.
### B-005 [P2] Sticky notes often copy the slide or invent facts (hurts the "only what's NOT on the slide" pitch)
- Stage / owner: s4 / @aryan
- Repro: Mac, real models (QWEN3_1_7B), `node src/ai/scripts/live-demo.js fixtures/slides.json fixtures/lecture.wav`. Examples from the run at 13:56:
  - copies of slide text: s2 "Separate chaining uses a list per bucket", "Open addressing requires probing for free slots"; s4 "...resizing doubles the array when the load factor is too high", "...rehashing every key"
  - invented / garbled: s1 "The Magiula technique uses the lowest bits..." (STT 'modulus'); s0 "Jarvis Hashmare" (STT 'Java's HashMap'); s0 notes about resizing at 0.75 (not said during slide 0)
- Expected: each note is a fact from `fixtures/lecture.script.json` → `segments[i].notOnSlide` (e.g. "choose m prime", "linear probing is cache friendly", "Java resizes at 0.75", "Thursday's lab"). No paraphrases of the slide bullets.
- Suggested fix: lower `isOnSlide` overlap to ~0.5 (content words only, minus stopwords); give the prompt 1 good and 1 bad example; max 2 notes/slide; tell the model 'if unsure of a name, omit it'; drop the "The lecturer explained/mentioned" prefix. I'll add a REAL test that scores notes vs `notOnSlide` facts.
- Status: QUALITY VERIFIED (15:08, PR #40): every slide has genuine notes (s0 Python/Java; s1 prime + modulus/power-of-2; s2 cache-friendly/clustering; s3 Java 0.75, 1/(1-α); s4 O(n) amortised, Thursday's lab). Minor: 1 duplicate ('choose m prime' ×2), 'M1 resize' garble. Latency re-check pending (the run overlapped with the human's live app session).
### B-006 [P1] Live transcript should feel instant (stream partial text < 1 s)
- Stage / owner: s2 / @aryan (engine) + @filip (display)
- HUMAN REQUEST (david): transcription must feel more instant. Today the first words appear only after a pause or a full 2–6 s window (~3 s lag).
- Expected: while the speaker is mid-window, re-transcribe the growing window every ~400–600 ms and emit `transcript:partial { text, tStart, tEnd }` (replaces the previous partial; cleared when the final `transcript:chunk` for that window arrives). Words visible < 1 s after they're spoken. Final chunks + tracking + agents unchanged. Whisper-tiny on the M5 transcribes a 20 s clip in ~1 s, so it has the headroom. Skip a partial if the previous one is still running (no queue build-up). Optional: shorter VAD silence cut (e.g. 350 ms) for snappier finals.
- filip: show the partial as a live grey line under the last final line, swapped in place (no flicker/jump).
- aryan: add `transcript:partial` to contracts/stage-2.md. I'll add a REAL latency test (first partial < 1.2 s after speech starts).
- Order for aryan: B-004 → B-006 → B-005.
- Status: DISPLAY FIX CLAIMED (14:31, #24). Verifying with real mic on the Mac.
### B-008 [P1] Transcript accuracy: use WHISPER_LARGE_V3_TURBO for finals, keep EN_BASE for partials
- Stage / owner: s2 / @aryan
- HUMAN REPORT (david): "transcriber isn't that accurate".
- Benchmark on the Mac (M5), full 92 s fixtures/lecture.wav via transcribeFile (WER vs script; digits-vs-words inflates all of them a bit):
  | model | WER | 92 s takes | keywords (modulus / Java's HashMap / amortised / cache friendly / linked list) |
  |---|---|---|---|
  | WHISPER_EN_BASE_Q8_0 (now) | 11.7% | 3.8 s (RTF 0.04) | 1/5 |
  | WHISPER_EN_SMALL_Q8_0 | 18.1% | 12 s (RTF 0.13) | 2/5 |
  | WHISPER_LARGE_V3_TURBO | **8.1%** | 45 s (RTF 0.48) | **4/5** |
- Expected: finals (`transcript:chunk`, which drive tracking + notes + the library) come from LARGE_V3_TURBO (~2.5 s per 5 s window on the M5); partials (`transcript:partial`) stay on EN_BASE so text still appears in < 1 s. Keep B-007's guarantee (no aborted segments): give each model its own serial queue, so partials aren't blocked behind a 2.5 s final. Env overrides: `LECSCRIBE_STT_MODEL` (finals), `LECSCRIBE_STT_PARTIAL_MODEL` (partials). `ai:warm` must download both. Turbo is 1.6 GB and already cached on the Mac.
- Watch: memory (turbo 1.6 GB + LLM 1 GB + embed 0.3 GB, fine on 24 GB), and that finals don't fall behind real time (RTF 0.48 < 1).
- Status: ACCURACY VERIFIED (14:32): turbo text clearly better, 0 errors. Latency side effect is tracked in B-011.
### B-016 [P1] Embedding model collisions in long sessions: "Cannot set new job: a job is already set or being processed" → slide tracking + library indexing silently fail
- Stage / owner: s3 + s5 / suggested @aryan (embed is in src/ai); @aryan please assign
- Repro: Mac, real models, `node tests/soak/soak.mjs 30` on dev pre-#56 (also check after). From ~12 min in: 10× `[ai/tracker] chunk scoring failed RPCError: Cannot set new job…` and 18× `[library] embed failed, falling back to keyword search: Cannot set new job…`. The tracker and the library call ai.embed concurrently; QVAC's embed model takes one job at a time. Effect: auto slide-follow stops, and lecture search degrades to keywords.
- Suggested fix: ONE serial queue for every embed call (like B-007 did for STT), tracker first (latency-critical), library indexing batched + low priority (drop/merge when backed up).
- Status: OPEN (16:27)
### B-017 [P2] Library rewrites the whole pretty-printed vectors.json on every transcript chunk (O(n²) over a long lecture)
- Stage / owner: s5 / suggested @aaron (OFFLINE): @aryan please assign
- Evidence: soak lecture after ~20 min: vectors.json = 6.4 MB (JSON with 2-space indent, 768-dim floats); readVectors + writeJson(…, null, 2) per appendTranscript. A 1-hour lecture → ~20 MB parse + stringify per chunk on the main process (UI hitches, memory churn; node RSS 114 → 284 MB in the soak).
- Suggested fix: no indentation for vectors.json, keep the store in memory and flush debounced (e.g. every 5 s / on endSession), append-only or binary Float32 file per lecture.
- Status: OPEN (16:27)
## Closed
### H-2 [P1] Notes auto-saved per session, star = important, per-module Important list (human 15:53)
- Owners: @aaron (library: auto-save note:added on host + peers, setNoteImportant, listImportant), @filip (star toggle, Important section).
- Tests: tests/contracts/library.test.mjs (session auto-save, H-2 describe), gated until setNoteImportant exists.
- Status: VERIFIED (16:08, Mac, dev edd29df, 105/105): library contract tests + UI smoke (autoSaved 2, star → Important tab, module 'Important notes' grouped by lecture with slide numbers; screenshot smoke4-important.png).
### B-015 [P1] Live transcript doesn't reach peers (human request)
- Stage / owner: s6 / @aaron (room protocol); @filip only if the peer view needs a tweak
- HUMAN REQUEST (david): aaron's laptop (peer) shows slides + notes but no live transcript.
- Cause: by contract (stage-6) the room only carries slides, slide changes and notes.
- Expected: peers see the same transcript as the host. Final `transcript:chunk` → append to the room feed (`{type:'chunk', chunk}`, replayed to late joiners). `transcript:partial` → DON'T append (every 500 ms would bloat the core); send it as an ephemeral Hypercore extension / protomux message to connected peers, which re-emit `transcript:partial` on their bus. Peer bus re-emits both, so the Lecture view works unchanged. Text only, never audio (privacy pitch intact). Update contract stage-6 + tests.
- Status: VERIFIED (15:38): same run, 76 finals replayed + ~2 partials/s live on the Windows peer.
### B-014 [P1] In-app "Join a live session" hangs on "Joining…" (demo step 6 in the real UI)
- Stage / owner: s6 / @aaron (src/p2p/host.js), with @filip for the UI side
- Repro (human report, 14:50): Windows laptop on the hotspot, `npm start` → sidebar "Join a live session" → paste lecscribe://room/hhwarg… → button stays "Joining…". On the Mac host the peer shows up only at 14:48:45 and leaves 18 s later.
- Suspected cause (code reading, unverified on Windows): `startP2P().joinRoom()` does `await a.close()` on the local AI BEFORE joining. On a laptop that is still loading/downloading models (turbo is 1.6 GB, and startAI preloads in the background) that close can block for a long time, and the UI awaits it.
- Suggested fix: don't block the join on the AI shutdown: `Promise.race([a.close(), sleep(1500)])` or fire-and-forget. Better: in peer mode, don't start/preload the AI at all (a peer never needs models). Also add a 20 s UI timeout with a clear error ("Can't reach the lecturer's laptop. Are you on the same hotspot?") and a Cancel button.
- Status: VERIFIED (15:38): aaron's 15:21 in-app run on the hotspot, Join returned at once.
### B-012 [P2] Smoke runs write a "Smoke test" module into the REAL library (would show on stage)
- Stage / owner: s1 / @filip (found by @aaron 14:33)
- Repro: `LECSCRIBE_SMOKE=out.png npm run start:mock` on the Mac → later `npm start` shows a "Smoke test" module in the Library.
- Suggested fix: when LECSCRIBE_SMOKE is set, `app.setPath('userData', <fresh temp dir>)` before startLibrary. david will delete the leftover module on the demo Mac before the demo (and smoke uses a temp dir afterwards).
- Status: VERIFIED (15:38): smoke uses a temp userData.
### B-010 [P2] Lecture view polish: empty heatmap boxes + badge covers the slide's page number
- Stage / owner: s9 / @filip
- Repro: Mac, dev ca0e07e, `LECSCRIBE_SMOKE=… npm run start:mock` → lecture view (screenshot in david's scratchpad).
  1. A row of 5 empty bordered boxes sits above the thumbnails (the heatmap strip with no counts). It looks like a rendering glitch. Hide it until a live room has ≥ 1 lost tap, or render it as a borderless 4 px bar.
  2. The "Manual 2 / 5" badge sits on top of the slide image's own "2/5" footer, which peeks out above it. Move the badge outside the slide card (e.g. next to the transcript bar) or below the slide.
- Status: VERIFIED (15:38, Mac smoke screenshot): heatmap hidden with no taps, badge below the slide.
### B-013 [P1] Host room must survive a network change (demo turns Wi-Fi off, then joins the hotspot)
- Stage / owner: s6 / @aaron
- Repro: start a host room on network A (eduroam), switch the Mac to network B (hotspot) → the host keeps announcing its stale network-A identity; peers on B find it but can't connect (david 14:35–14:42). Restarting the host on B fixes it.
- Expected: after a network change, the host re-binds / re-announces within ~10 s with no app restart (hyperdht/hyperswarm may have a network-change hook or a `suspend()/resume()`, so verify in the docs; otherwise detect an interface change via os.networkInterfaces() polling and recreate the swarm, keeping the same room key and Corestore so the link stays valid).
- Status: CLOSED, not needed for the demo (15:34): the human dropped demo step 2. The fix (PR #33) stays in as a safety net.
### T-001 [P1 test task] Cross-device P2P: Mac host ↔ Windows peer on venue Wi-Fi (then hotspot)
- Owner: @aaron (peer) + @david (host, room live on the Mac)
- Steps: `node src/p2p/scripts/room-demo.js join lecscribe://room/uebob54ojy8umd663tt8oeb9nxfpry7uwwqm334gdqk8b5jgpzxy` from the Windows laptop on venue Wi-Fi; report connect time, slides+images, notes, latency. Then repeat on a phone hotspot.
- Status: PASSED on the hotspot (14:45). See B-009.
### B-009 [P1] Demo step 6 fails on eduroam: Windows peer finds the Mac's room but can't connect (HOLEPUNCH_ABORTED)
- Stage / owner: s6 / @aaron
- Repro: Mac host (eduroam 10.205.56.149, public 130.88.226.21, firewalled + randomized NAT) runs `room-demo.js host`; Windows peer (eduroam 10.205.105.2, public 130.88.226.2, firewalled + randomized NAT) runs `room-demo.js join <link>` → lookup finds the host, connect fails HOLEPUNCH_ABORTED, 0 slides / 0 notes (2 attempts, 14:20 and 14:26).
- Expected: peer receives slides + notes on the venue network, or a reliable fallback.
- Options: (a) phone hotspot for both devices (spec fallback; test ASAP); (b) code fallback via relays/LAN if the libraries support it (verify in docs); (c) whatever works must be in the stage checklist.
- Status: RESOLVED via the spec's fallback (14:45): on a phone hotspot, Mac host → Windows peer connects in 2.0 s, 5 slides + images in 2.7 s, full history, live notes ~0.5–1.5 s, 90 notes / 60 s, 0 errors (aaron 14:43; re-joined 14:45). eduroam stays unusable (randomized NAT). DEMO RULE: both devices on the hotspot, and start the live session AFTER the Mac is on the hotspot.
### B-011 [P1] Regression from B-008: slide tracking now 9–15 s late; turbo finals fall behind (lag up to 10 s)
- Stage / owner: s2/s3 / @aryan
- Repro (Mac, real, dev ca0e07e, `live-demo.js … --partials`): finals lag 3.5–4.5 s, then 8.8–10.1 s for c-15..c-17 (queue falls behind). Auto-advances at 24.3 / 43.0 / 63.7 / 87.6 s vs topic starts 15.1 / 33.7 / 54.5 / 72.9 s, so 9–15 s late (was ~5 s before B-008). On stage the slide would visibly lag the speaker.
- Good news from the same run: stt errors 0, first partial 0.35 s, turbo text much better ('linear probing is cache friendly', "Java's HashMap" now correct; 'modulus' → 'Majulis' still wrong).
- Suggested fix: drive the TRACKER from the fast EN_BASE text (partials or a base-model final per VAD window), and keep turbo finals for transcript/notes/library only. Make sure turbo never queues more than ~1 window behind (drop/merge windows or skip turbo for a window and keep the base text if the queue is > 1 deep). Prioritise GPU for turbo over partials when the turbo queue is non-empty.
- Expected: auto-advance within ~5 s of the topic change (as before), finals lag ≤ 5 s throughout.
- Status: VERIFIED (14:44, dev 9882a22): advances 5–6 s after topic start, finals ~4 s steady, 0 errors.
### B-007 [P1] Live STT drops whole segments: "RPCError: Model was reloaded" (partials collide with finals)
- Stage / owner: s2 / @aryan
- Repro (Mac, real models, dev eb3cc39): `node src/ai/scripts/live-demo.js fixtures/slides.json fixtures/lecture.wav` → 5× `[ai/stt] live segment failed RPCError: Model was reloaded` per 92 s run (also 5× in the human's live-mic session in the app). Those finals never emit, so text is missing (the human reports "transcriber isn't that accurate"), and notes lose their source text too.
- Root cause (from the worker stack): `transcribe` → `restorePrompt` → `ASRGgml.reload` → `WhisperDriver.reload` aborts the in-flight request. The per-call slide-vocabulary prompt forces a model reload, and a concurrent partial/final run gets cancelled.
- Expected: 0 failed segments, every final emitted.
- Suggested fix: serialise ALL STT calls (partials + finals) through ONE queue, with finals taking priority (drop a pending partial when a final is queued). Set the vocabulary prompt once per slide change, not per call (or don't pass a per-call prompt at all). Retry a final once if it gets an RPCError. Add `stt:error` counting to live-demo output.
- Status: VERIFIED (14:22, Mac real models, dev 84fb35a): stt errors 0 / 92 s, 150 partials, first partial lag 0.33 s, 19 finals, tracking [1,2,3,4].
### B-003 [P2] App won't start if ELECTRON_RUN_AS_NODE is set (e.g. launched from a VS Code terminal)
- Stage / owner: s1 / @filip
- Repro: on the Mac, in a VS Code integrated terminal (it exports ELECTRON_RUN_AS_NODE=1), run `npm start` → crash `TypeError: Cannot read properties of undefined (reading 'exports')` at cjsPreparseModuleExports. `env -u ELECTRON_RUN_AS_NODE npm start` works.
- Expected / Actual: app opens from any terminal / crash.
- Suggested fix: launch via a node script (like start-mock.js) that deletes `env.ELECTRON_RUN_AS_NODE` before spawning electron, and point both `start` and `start:mock` at it.
- Status: VERIFIED (14:04): with ELECTRON_RUN_AS_NODE=1 the app now exits with a clear 'unset it' message instead of the cryptic crash. Demo: launch from Terminal.app.
### B-001 [P1] Real LLM output is always empty, so no sticky notes, explain notes or summaries
- Stage / owner: s4 (+ s7-ai, s5 summary) / @aryan
- Repro (david's Mac, real models, dev 93150d3+): 1. `npm i @qvac/sdk@0.23.0` 2. `node src/ai/scripts/live-demo.js fixtures/slides.json fixtures/lecture.wav` 3. full 92 s run gives 16 chunks and correct slides, but 0 `note:added`.
- Root cause (verified): `completion().final` is `{ contentText, toolCalls, stats, raw: { fullText }, cacheableAssistantContent }`. `src/ai/llm.js` reads `final.content ?? final.text`, so it gets ''. The raw output is good: `<think>\n\n</think>\n\n```json\n[ ...3 notes... ]\n``` `, generated at 209 tok/s on the GPU in ~0.5 s.
- Expected / Actual: ≥ 1 note per slide / 0 notes.
- Suggested fix: read `final.contentText` first. Add a unit test with that exact object shape. Update the stage-4 contract (it says `.content`).
- Status: VERIFIED (13:56) on the Mac, dev 1fd8e12: real run gives 16 notes (3/slide), each ~1 s after the slide changes. Explain now summarises.
### B-002 [P2] Auto slide tracking lags 5–10 s behind the lecturer
- Stage / owner: s3 / @aryan
- Repro: same run. Slide 2 narration starts at 15.1 s, but the tracker advanced at 28.2 s (chunk ending 25.3 s). Other transitions are 1 chunk late too (sequence 0→1→2→3→4 is correct).
- Expected / Actual: advance within ~1 chunk of the new topic / ~1–2 chunks late.
- Suggested fix: shorter windows at boundaries, score the newest chunk alone as well as the rolling window, slightly lower threshold for current+1.
- Status: VERIFIED (13:56): every transition lands one chunk (~5 s) after the topic starts. Sequence 0→1→2→3→4, conf 0.71–0.83.
_(none)_
