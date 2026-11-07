# Stage 1 contract: app shell, host bus, PDF slide viewer (owner: filip, `src/core/`, `ui/`, root config)
Status: v1 (13:50), merged in dev (PR #6).

## Run
| what | command |
|---|---|
| app, real AI | `npm start` (= `electron .`) |
| app, AI mock | `npm run start:mock` (sets `LECSCRIBE_AI_MOCK=1`, strips `ELECTRON_RUN_AS_NODE`) |
| tests | `npm test` (= `node tests/run.mjs`) |
| lint | `npm run lint` (syntax check of every .js/.mjs/.cjs) |
| DevTools | `LECSCRIBE_DEVTOOLS=1` |
Stack: Electron 33.4.11, Node ESM (`"type": "module"`), pdfjs-dist 4.10. No build step.
If a Claude runs `npm start` from inside VS Code: `env -u ELECTRON_RUN_AS_NODE npm start`.

## Processes
- **Main** (`src/core/main.js`): owns the bus, loads `src/ai/index.js` → `startAI({ bus, mock })` and `src/p2p/index.js` → `startP2P({ bus, ai: () => ai })` (named or default export) if present. Serves the repo at `app://lecscribe/…`.
- **Renderer** (`ui/index.html`, `ui/app.js`): UI only. Talks to main through `window.lec`.

## Host bus (`src/core/bus.js`)
`createBus()` → Node EventEmitter (`on/off/once/emit`) plus `bus.tap(fn(name, payload)) → unsubscribe`. A throwing listener is logged and never blocks the others. **Every** bus event is forwarded to the renderer; payloads must be plain, structured-clone-safe data (no functions or class instances).

## Renderer API: `window.lec`
```js
lec.emit(name, payload)            // -> main bus (and back to renderer listeners)
lec.on(name, fn) -> unsubscribe    // '*' = every event, fn(name, payload)
lec.ai(method, ...args)            // playClip|stopClip|pushAudio|flushAudio|pushExplainAudio|embed|ocr|summariseLecture
                                   // pushAudio/pushExplainAudio are fire-and-forget; the rest return Promises
                                   // playClip's path may be repo-relative ('fixtures/lecture.wav')
lec.p2p(method, ...args)           // any method on the object startP2P() returned
lec.processSlides(rawSlides)       // main OCRs slides with text < 20 chars, then emits 'slides:loaded'
lec.requestMic() -> { granted, status, hint? }   // macOS askForMediaAccess; always granted elsewhere
lec.info() -> { platform, mock, aiLoaded, p2pLoaded, versions }
```

## PDF → slides
- `src/core/pdf.js`: `loadPdf(bytes, { pdfjs, renderImages, scale, standardFontDataUrl, cMapUrl, onProgress }) -> [{ index, text, image }]`. Renderer: images are JPEG data URLs. Node: `pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')`, `renderImages: false` → `image: null`.
- `src/core/slides.js`: `processSlides(raw, { ocr }) -> Slide[]` (OCR if text < 20 chars and there's an image; OCR errors keep the slide).
- Flow: renderer `loadPdf` → `lec.processSlides(raw)` → main OCR → `bus.emit('slides:loaded', Slide[])`.

## Events the UI EMITS
| event | payload | when |
|---|---|---|
| `slide:changed` | `{ index, source: 'manual' }` | prev/next, arrow keys, thumbnail click |
| `note:saved` | `{ note: Note, moduleId, weekId, slide: { index, text }, sources: TranscriptChunk[], savedAt }` | sticky clicked (→ S5 notebook) |
| `listen:state` | `{ listening: boolean }` | Start/Stop listening |

## Events the UI CONSUMES
`slides:loaded`, `slide:changed` (`auto` shows "auto · NN%" from `confidence`), `transcript:chunk` (live transcript line + "Heard: …" on sticky hover), `note:added` (`kind: 'ai'` yellow "AI-generated", `kind: 'lecturer'` blue "Lecturer explanation"), `ai:status` (chips per model), `lost:counts` (heat bar on thumbnails), `clip:ended`.
The UI never moves the slide locally: it emits `slide:changed` and renders when the event comes back from main, so every device and the tracker see the same order.

## macOS mic
`systemPreferences.askForMediaAccess('microphone')` on Start listening; `NSMicrophoneUsageDescription` is in `package.json` → `build.mac.extendInfo` (packaged builds). The dev Electron.app already declares mic usage. Media permission requests for audio are allowed in the session.

## Test hooks
`window.__lecscribe = { state, go(index), openPdf(bytes, name) }` in the renderer (for e2e).
