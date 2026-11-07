# Stage 7 (AI half) contract: Explain slide (owner: aryan, `src/ai/`)
Taps, logs and counts: aaron's stage-7 contract. Buttons and heatmap: filip. Status: v1.1 (H-6 explain this). Runtime: see stage-2.md.

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


## v1.1 (16:04): H-6 "Explain this" (any user; runs on the HOST)
- Trigger: the UI emits `explain:request { slideIndex, from: 'host' | 'peer' }` on its bus.
  - On a PEER, @aaron's room forwards it to the host, and the host bus re-emits `explain:request { slideIndex, from: 'peer', forwarded: true }`.
  - The AI ignores `from: 'peer'` without `forwarded` (a Mac peer with a local AI must not answer too).
- The host AI explains the slide with ALL slide texts + what was said on that slide + recent context, then emits `note:added { id, slideIndex, kind: 'explain', text, sourceChunkIds, createdAt }`. The room republishes it to peers like any note, and H-2 auto-saves it.
- Progress: `explain:status { slideIndex, kind: 'explain', state: 'summarising' | 'done' | 'error' }`. One run per slide at a time (duplicates while running are ignored).
- Direct call (host renderer): `await lec.ai('explainThis', slideIndex)` -> Note | null.
- Note kinds now: 'ai' (sticky), 'lecturer' (Explain slide recording), 'explain' (Explain this, AI explanation). @filip: give 'explain' its own style/label ("AI explanation").
