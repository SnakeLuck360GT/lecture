# BUGS
## dev health: 🟢 GREEN  (14:11, commit fd91079, 66/66 on the Mac)
## Open
### B-004 [P1] No microphone picker: demo needs the iPhone mic (Continuity) on the Mac
- Stage / owner: s1 (UI) / @aryan (reassigned from filip at , component ui/components/mic-picker.js)
- HUMAN REQUEST (david): the presenter will speak into an iPhone used as the Mac's microphone (macOS Continuity "iPhone Microphone"). The app must let us choose the input device.
- Repro: start the app, Start listening → always uses the default input; there's no way to pick another mic.
- Expected: a mic dropdown next to "Start listening" (aryan's `src/ai/browser/mic-capture.js` already has `listMics()` and `startMic(onChunk, { deviceId, onLevel })`). Remember the choice (localStorage). Show a small live input-level meter (onLevel) so we can see the mic is hot. Re-list on `navigator.mediaDevices.ondevicechange` (the iPhone appears/disappears). If the chosen device vanishes mid-session, fall back to default and show a toast.
- Status: FIX CLAIMED (14:01, component ui/components/mic-picker.js merged). Waiting for filip to mount it; I'll verify with the iPhone mic.
### B-005 [P2] Sticky notes often copy the slide or invent facts (hurts the "only what's NOT on the slide" pitch)
- Stage / owner: s4 / @aryan
- Repro: Mac, real models (QWEN3_1_7B), `node src/ai/scripts/live-demo.js fixtures/slides.json fixtures/lecture.wav`. Examples from the run at 13:56:
  - copies of slide text: s2 "Separate chaining uses a list per bucket", "Open addressing requires probing for free slots"; s4 "...resizing doubles the array when the load factor is too high", "...rehashing every key"
  - invented / garbled: s1 "The Magiula technique uses the lowest bits..." (STT 'modulus'); s0 "Jarvis Hashmare" (STT 'Java's HashMap'); s0 notes about resizing at 0.75 (not said during slide 0)
- Expected: each note is a fact from `fixtures/lecture.script.json` → `segments[i].notOnSlide` (e.g. "choose m prime", "linear probing is cache friendly", "Java resizes at 0.75", "Thursday's lab"). No paraphrases of the slide bullets.
- Suggested fix: lower `isOnSlide` overlap to ~0.5 (content words only, minus stopwords); give the prompt 1 good and 1 bad example; max 2 notes/slide; tell the model 'if unsure of a name, omit it'; drop the "The lecturer explained/mentioned" prefix. I'll add a REAL test that scores notes vs `notOnSlide` facts.
- Status: REOPENED after the fix claim (14:07): 6 notes, s2 has 0, s4 is a paraphrase of a slide bullet. Recall fixes queued after B-006.
### B-006 [P1] Live transcript should feel instant (stream partial text < 1 s)
- Stage / owner: s2 / @aryan (engine) + @filip (display)
- HUMAN REQUEST (david): transcription must feel more instant. Today the first words appear only after a pause or a full 2–6 s window (~3 s lag).
- Expected: while the speaker is mid-window, re-transcribe the growing window every ~400–600 ms and emit `transcript:partial { text, tStart, tEnd }` (replaces the previous partial; cleared when the final `transcript:chunk` for that window arrives). Words visible < 1 s after they're spoken. Final chunks + tracking + agents unchanged. Whisper-tiny on the M5 transcribes a 20 s clip in ~1 s, so it has the headroom. Skip a partial if the previous one is still running (no queue build-up). Optional: shorter VAD silence cut (e.g. 350 ms) for snappier finals.
- filip: show the partial as a live grey line under the last final line, swapped in place (no flicker/jump).
- aryan: add `transcript:partial` to contracts/stage-2.md. I'll add a REAL latency test (first partial < 1.2 s after speech starts).
- Order for aryan: B-004 → B-006 → B-005.
- Status: ENGINE VERIFIED (14:11, Mac real models, dev fd91079): partials every ~0.5 s trail speech by ~0.2–0.5 s (e.g. at 4.5 s wall: text up to audio 4.29 s), 152 partials / 92 s, finals lag 0.3 s, tracking unchanged. REMAINING: @filip shows the grey live line in the UI.
### B-007 [P1] Live STT drops whole segments: "RPCError: Model was reloaded" (partials collide with finals)
- Stage / owner: s2 / @aryan
- Repro (Mac, real models, dev eb3cc39): `node src/ai/scripts/live-demo.js fixtures/slides.json fixtures/lecture.wav` → 5× `[ai/stt] live segment failed RPCError: Model was reloaded` per 92 s run (also 5× in the human's live-mic session in the app). Those finals never emit, so text is missing (the human reports "transcriber isn't that accurate"), and notes lose their source text too.
- Root cause (from the worker stack): `transcribe` → `restorePrompt` → `ASRGgml.reload` → `WhisperDriver.reload` aborts the in-flight request. The per-call slide-vocabulary prompt forces a model reload, and a concurrent partial/final run gets cancelled.
- Expected: 0 failed segments, every final emitted.
- Suggested fix: serialise ALL STT calls (partials + finals) through ONE queue, with finals taking priority (drop a pending partial when a final is queued). Set the vocabulary prompt once per slide change, not per call (or don't pass a per-call prompt at all). Retry a final once if it gets an RPCError. Add `stt:error` counting to live-demo output.
- Status: OPEN (14:13)
## Closed
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
