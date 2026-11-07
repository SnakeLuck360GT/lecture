# Stage 2 contract: speech-to-text + shared AI facade (owner: aryan, folder `src/ai/`)
Status: v1.3 (v1.2 + transcript:quick, two STT models). This file is the source of truth for the AI runtime and facade used by S3/S4/S7.

## Runtime
- Plain ESM JS (`"type": "module"`), runs in **Node / the Electron main process** (NOT the renderer). `@qvac/sdk` on Node spawns its own Bare worker.
- SDK: `@qvac/sdk@0.23.0` (verified from the npm tarball + https://docs.qvac.tether.io/llms-full.txt).
- Models are downloaded and cached by the SDK on first `loadModel()` (never committed). First run needs internet; after that it works offline. **Run `npm run ai:warm` once before the demo.**

## Facade: `src/ai/index.js`
```js
import { startAI } from './src/ai/index.js'
const ai = await startAI({ bus, mock })   // bus = EventEmitter-like {on, off, emit}; mock optional
// loads models (emits 'ai:status'), wires S2+S3+S4+S7 listeners onto the bus
ai.playClip(wavPath, { realtime: true })  // S2 demo path: stream a recorded clip as transcript chunks
ai.stopClip()
ai.pushAudio(f32Mono16k)                  // S2 live mic (PRIMARY path, broadcast #3): Float32Array 16 kHz mono PCM, any frame size (100-500 ms ideal)
await ai.flushAudio()                     // S2: on "Stop listening", transcribe the buffered audio, drain the tracker, run the pending agents
ai.pushExplainAudio(f32Mono16k)           // S7: audio for the active Explain recording
ai.explainFromFile(slideIndex, wavPath)   // S7: backup/demo path
await ai.idle()                           // tests: wait for the tracker/agents/explain queues to drain
ai.embed(textOrTexts)                     // S3/S5/S8: -> number[] | number[][]
ai.ocr(image)                             // S1: image path | Buffer | data URL -> string
ai.summariseLecture(chunks, slides)       // S5: -> Promise<string> (week summary)
ai.embedQuery(q) / ai.embedDocs(texts)    // search: EmbeddingGemma retrieval prefixes (src/ai/search.js)
ai.transcriptPassages(chunks)             // search: merge chunks into <= 30 s passages per slide -> {id, slideIndex, tStart, tEnd, text, chunkIds}
ai.hybridScore({ cosine, query, text, kind })  // search: 0.8*cosine + 0.2*keyword (+ small boost for saved notes)
ai.close()
```
- **Mock mode:** `startAI({ bus, mock: true })` or env `LECSCRIBE_AI_MOCK=1` -> no models, deterministic fake outputs, same events. Use it for UI dev and tests.

## S2 functions: `src/ai/stt.js`
```js
transcribeFile(wavPath) -> Promise<TranscriptChunk[]>                // whole file, chunked by time
transcribeAudio(wavPathOrBuffer, { prompt }) -> Promise<string>      // used by S7 explain
```
- Input audio: **16 kHz mono WAV** (`fixtures/lecture.wav`). @david: please make the fixture 16 kHz mono.
- `playClip` transcribes with segment timestamps (`metadata: true` -> segments with `text`, `startMs`, `endMs`), groups them into ~6 s chunks, and emits each chunk when playback time reaches its `tEnd` (realtime), so slides advance in sync with the audio. The UI plays the same file in an `<audio>` element and calls `playClip` at the same moment.

## Events emitted
```
'ai:status'        { model: 'stt'|'embed'|'llm'|'ocr', state: 'loading'|'ready'|'error', progress?: 0-100, error?: string }
'transcript:chunk' TranscriptChunk { id: 'c-<n>', slideIndex, tStart, tEnd, text }  // seconds; slideIndex = current slide at emit time
'transcript:quick'  { id, slideIndex, tStart, tEnd, text }  // B-011 (v1.3): fast-model text per live segment, drives the tracker.
                    // The accurate 'transcript:chunk' with the SAME id follows (may carry quality: 'fast' if turbo fell behind).
'transcript:partial' { text, tStart, tEnd, slideIndex }  // B-006 (v1.2): live mic only, ~every 500 ms while a segment is open.
                    // Replaces the previous partial; clear it when the next 'transcript:chunk' arrives. Never sent after its final.
```
## Live mic segmentation (v1.1)
Energy VAD with an adaptive noise floor. A segment is cut at a pause of 450 ms or more once it is at least 2 s long, or hard-cut at 6 s. Near-silent segments are dropped. If STT falls behind, queued segments are merged (at most 10 s). Tuning env vars: `LECSCRIBE_LIVE_MIN_SEC`, `LECSCRIBE_LIVE_MAX_SEC`, `LECSCRIBE_LIVE_SILENCE_MS`. Chunk `tStart`/`tEnd` are stream seconds since the first pushAudio.
Renderer helper: `src/ai/browser/mic-capture.js` with `startMic(onChunk, { onLevel }) -> { stop() }`.

## Additive extras (v1.1)
- `slide:changed` from the tracker also carries `chunkId` (the chunk that triggered it). S4 moves that chunk to the new slide.
- `clip:ended { wavPath }` after playClip finishes.

## Events consumed
`slide:changed` (to stamp `slideIndex` on chunks).

## Models / env
| purpose | default constant | env override |
|---|---|---|
| STT | `WHISPER_TINY` (+ `VAD_SILERO_5_1_2` if it loads) | `LECSCRIBE_STT_MODEL` |

- `QVAC_RPC_INIT_TIMEOUT_MS` (SDK) if the first worker start times out.

## How to run
`node src/ai/scripts/stt-demo.js fixtures/lecture.wav` prints timestamped chunks.
