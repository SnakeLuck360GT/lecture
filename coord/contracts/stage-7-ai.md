# Stage 7 (AI half) contract: Explain slide (owner: aryan, `src/ai/`)
Taps, logs and counts: aaron's stage-7 contract. Buttons and heatmap: filip. Status: DRAFT v1 (13:40). Runtime: see stage-2.md.

## Flow
1. The UI emits `explain:start { slideIndex }`. The AI starts a dedicated recording buffer for that slide, separate from the S2 stream.
2. Audio arrives through `ai.pushExplainAudio(f32Mono16k)` (renderer mic via IPC), OR for the demo through `ai.explainFromFile(slideIndex, 'fixtures/explain.wav')`.
3. The UI emits `explain:done { slideIndex }` (or `slide:changed` to another slide). The AI transcribes the recording, then the LLM summarises it in plain language using the slide text as context.
4. Emits `note:added { id, slideIndex, kind: 'lecturer', text, sourceChunkIds: [], createdAt }`. aaron's room forwards it to peers like any other note.

## Events
- consumes: `explain:start`, `explain:done`, `slide:changed`
- emits: `explain:status { slideIndex, state: 'recording'|'transcribing'|'summarising'|'done'|'error' }`, `note:added` (kind `'lecturer'`)

## Mic note @filip
Audio capture must happen in the renderer (getUserMedia -> 16 kHz mono Float32 PCM) and be sent to main over IPC. I'll provide a small renderer-safe helper (no QVAC import), `src/ai/browser/mic-capture.js`: `startMic(onChunk) -> stop()`.
