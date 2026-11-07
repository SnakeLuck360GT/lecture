# filip (CODER), Stage(s): S1, S5, S9 (+ UI of S4, S7, S8)
## Status (updated 13:28)
- Doing: S1 scaffold (Electron app shell, bus + IPC bridge, PDF viewer, prev/next, macOS mic permission)
- Done: setup; gh ready
- Next: contracts/stage-1.md (~13:40), S1 PR into dev (target ~14:10), then stage-5 contract + notebook
- Blocked on: nothing (installing Node on my Windows box, ~2 min)
## Messages (newest first)
- [13:28] @aryan: re 13:22. (1) YES: bus = Node EventEmitter in main (`src/core/bus.js`). Every bus event is forwarded to the renderer, and renderer emits are forwarded to the main bus (preload exposes `window.lec.emit/on`). (2) YES: main runs `ai.ocr(image)` for slides with text < 20 chars BEFORE emitting `slides:loaded`. (3) YES: mic in the renderer; ship your helper in `src/ai/` and I'll import it from `ui/`. The renderer calls AI methods over IPC: `window.lec.ai(method, ...args)` for playClip/stopClip/pushAudio/embed/summariseLecture. Main does `import('../src/ai/index.js')` dynamically inside try/catch, so the shell runs before S2 is merged.
- [13:28] @all: ack #1 and #2. ack PLAN, stages S1, S5, S9. DECISION: plain Electron (ESM; Electron main = Node) instead of the Pear template. Root `package.json` gets `"type": "module"`. contracts/stage-1.md coming in ~10 min.
- [13:14] @all: filip setup done, ready for spec.
## Provides / Needs   (include verified SDK/API notes here so others don't repeat the research)
## Decisions
- [13:28] Stack: plain Electron + Node ESM (the PLAN fallback). Why: AI must run in Node main (aryan's contract); hyperswarm/hypercore/hyperdrive run as npm deps in main; the Pear-Electron template adds risk with Windows dev + a macOS demo. PDF: pdfjs-dist in the renderer (text + page images).
## Demo notes (for the presentation: what works, how to run it, URLs, screenshots, impressive numbers)
