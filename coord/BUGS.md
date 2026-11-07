# BUGS
## dev health: 🟢 GREEN  (13:48, commit c207594, 40/40 mock suite; REAL suite on Mac: all pass except S4 notes = B-001; tracking 13/16)
## Open
### B-001 [P1] Real LLM output is always empty, so no sticky notes, explain notes or summaries
- Stage / owner: s4 (+ s7-ai, s5 summary) / @aryan
- Repro (david's Mac, real models, dev 93150d3+): 1. `npm i @qvac/sdk@0.23.0` 2. `node src/ai/scripts/live-demo.js fixtures/slides.json fixtures/lecture.wav` 3. full 92 s run gives 16 chunks and correct slides, but 0 `note:added`.
- Root cause (verified): `completion().final` is `{ contentText, toolCalls, stats, raw: { fullText }, cacheableAssistantContent }`. `src/ai/llm.js` reads `final.content ?? final.text`, so it gets ''. The raw output is good: `<think>\n\n</think>\n\n```json\n[ ...3 notes... ]\n``` `, generated at 209 tok/s on the GPU in ~0.5 s.
- Expected / Actual: ≥ 1 note per slide / 0 notes.
- Suggested fix: read `final.contentText` first. Add a unit test with that exact object shape. Update the stage-4 contract (it says `.content`).
- Status: OPEN (13:40)
### B-002 [P2] Auto slide tracking lags 5–10 s behind the lecturer
- Stage / owner: s3 / @aryan
- Repro: same run. Slide 2 narration starts at 15.1 s, but the tracker advanced at 28.2 s (chunk ending 25.3 s). Other transitions are 1 chunk late too (sequence 0→1→2→3→4 is correct).
- Expected / Actual: advance within ~1 chunk of the new topic / ~1–2 chunks late.
- Suggested fix: shorter windows at boundaries, score the newest chunk alone as well as the rolling window, slightly lower threshold for current+1.
- Status: OPEN (13:40)
### B-003 [P2] App won't start if ELECTRON_RUN_AS_NODE is set (e.g. launched from a VS Code terminal)
- Stage / owner: s1 / @filip
- Repro: on the Mac, in a VS Code integrated terminal (it exports ELECTRON_RUN_AS_NODE=1), run `npm start` → crash `TypeError: Cannot read properties of undefined (reading 'exports')` at cjsPreparseModuleExports. `env -u ELECTRON_RUN_AS_NODE npm start` works.
- Expected / Actual: app opens from any terminal / crash.
- Suggested fix: launch via a node script (like start-mock.js) that deletes `env.ELECTRON_RUN_AS_NODE` before spawning electron, and point both `start` and `start:mock` at it.
- Status: OPEN (13:48)
### B-004 [P1] No microphone picker: demo needs the iPhone mic (Continuity) on the Mac
- Stage / owner: s1 (UI) / @filip
- HUMAN REQUEST (david): the presenter will speak into an iPhone used as the Mac's microphone (macOS Continuity "iPhone Microphone"). The app must let us choose the input device.
- Repro: start the app, Start listening → always uses the default input; there's no way to pick another mic.
- Expected: a mic dropdown next to "Start listening" (aryan's `src/ai/browser/mic-capture.js` already has `listMics()` and `startMic(onChunk, { deviceId, onLevel })`). Remember the choice (localStorage). Show a small live input-level meter (onLevel) so we can see the mic is hot. Re-list on `navigator.mediaDevices.ondevicechange` (the iPhone appears/disappears). If the chosen device vanishes mid-session, fall back to default and show a toast.
- Status: OPEN (13:51)
## Closed
_(none)_
