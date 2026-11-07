# BUGS
## dev health: 🟢 GREEN  (13:33, commit 93150d3, 27/27 tests passing; P2P + real-model pending)
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
## Closed
_(none)_
