# Stage 2 contract: speech-to-text + shared AI facade (owner: aryan, folder `src/ai/`)
Status: DRAFT v1 (13:40). This file is the source of truth for the AI runtime and facade used by S3/S4/S7.

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
ai.pushAudio(f32Mono16k)                  // S2 live mic (nice-to-have): Float32Array PCM from renderer
ai.embed(textOrTexts)                     // S3/S5/S8: -> number[] | number[][]
ai.ocr(image)                             // S1: image path | Buffer | data URL -> string
ai.summariseLecture(chunks, slides)       // S5: -> Promise<string> (week summary)
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
```
## Events consumed
`slide:changed` (to stamp `slideIndex` on chunks).

## Models / env
| purpose | default constant | env override |
|---|---|---|
| STT | `WHISPER_TINY` (+ `VAD_SILERO_5_1_2` if it loads) | `LECSCRIBE_STT_MODEL` |

- `QVAC_RPC_INIT_TIMEOUT_MS` (SDK) if the first worker start times out.

## How to run
`node src/ai/scripts/stt-demo.js fixtures/lecture.wav` prints timestamped chunks.
