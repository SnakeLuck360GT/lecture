# PLAN: LecScribe (owner: david, written 13:20)

Stages = the spec's build order (SPEC.md, "Build order"). Stretch goals come later, assigned by david.

## Assignments (grouped by technology)
| Coder | Area | Stages | Folders owned |
|---|---|---|---|
| **filip** | App shell + all UI + storage | **S1** slide viewer + PDF load (scaffold, PR FIRST) · **S5** module/week directory, notebook, per-week vector store · **S9** UI polish + demo rehearsal · plus the UI pieces of S4 (sticky notes, click to save) and S7 (heatmap strip, "I'm lost" button, Explain/Done buttons) | `ui/`, `src/core/`, root config, `package.json` |
| **aryan** | On-device AI (QVAC) | **S2** speech-to-text on a recorded clip · **S3** slide embeddings + auto slide tracking · **S4** summariser agents (sticky-note generation) · AI half of **S7** (Explain slide: record → STT → LLM summary) · OCR for image-only slides (S1 step) · `embed()` used by S5/S8 | `src/ai/` |
| **aaron** | Peer to peer (Pears) | **S6** Pears room: live notes + slides to a 2nd device, join by key/QR · P2P half of **S7** ("I'm lost" per-device logs, host merge → counts, tap simulator script) · **S8** share link: export/import a week's notes | `src/p2p/`, `scripts/sim-taps*` |
| **david** | Tests, fixtures, release | test runner, contract/integration/e2e tests, smoke checklist, demo fixtures | `tests/`, `fixtures/` |

Why: filip finished setup first, so filip gets the scaffold. AI (25% of the score) and Pears (10%) are separate areas with no shared files. aaron's stages are later in the build order, but **aaron starts a P2P spike now** (peer discovery is a top risk, so test it early on venue Wi-Fi and a hotspot).

**Rule for UI:** every on-screen component lives in `ui/` (filip). aryan and aaron expose plain JS APIs and events. They don't write UI. If a coder needs a button or a view, they ask @filip.

## Tech stack (filip confirms in contracts/stage-1.md within 15 min; never invent APIs)
- **Target:** a Pear desktop app with a GUI, based on the Pears templates (docs: https://docs.pears.com/p2p/getting-started/from-a-template.md). `hello-pear-electron` gives the GUI shell. `hello-pear-qvac-tui` shows the QVAC inference worker pattern. Both share `holepunchto/hello-pear-worker`.
- **AI:** `@qvac/sdk` (npm) for STT, embeddings, LLM and OCR. aryan verifies the exact model names and APIs from the QVAC docs and notes them in `aryan.md` → Provides.
- **P2P:** Hyperswarm (join/discovery), Hypercore (live notes feed and per-device lost-tap logs), Hyperdrive (slide images). aaron verifies from docs.pears.com.
- **Fallback** if the Pear/Electron template won't run on our machines within ~30 min: plain Electron + Node using the same `@qvac/sdk` and `hyperswarm`/`hypercore`/`hyperdrive` npm packages. filip decides and logs it under Decisions.
- **Note:** aryan is on Windows, so QVAC must also be checked on the demo host (macOS, david tests). Use small models.

## Shared shapes (filip owns `src/core/types.js` + event bus; coders extend via their contracts)
```
Slide          { index, text, image }                 // image = path or data URL
TranscriptChunk{ id, slideIndex, tStart, tEnd, text }
Note           { id, slideIndex, kind: 'ai'|'lecturer', text, sourceChunkIds: [], createdAt }
Week           { moduleId, weekId, state: 'attended'|'missed'|'imported', ... }
Events (host bus):
  'slides:loaded'   Slide[]
  'slide:changed'   { index, source: 'auto'|'manual' }
  'transcript:chunk' TranscriptChunk
  'note:added'      Note
  'lost:counts'     { [slideIndex]: count }
  'explain:start' / 'explain:done'  { slideIndex }
```
These are a starting point. The stage contracts are the source of truth. Flag mismatches with `@` messages.

## Dependencies and integration order (single-device first)
1. **S1** (filip): scaffold + viewer with manual prev/next. **PR to dev ASAP**, since everyone builds on it.
2. **S2** (aryan): STT on `fixtures/lecture.wav` as a standalone script first, then wired to emit `transcript:chunk`.
3. **S3** (aryan): embed slides on `slides:loaded`, emit `slide:changed {source:'auto'}`. The manual override always wins.
4. **S4** (aryan agents + filip stickies UI): click to save → notebook.
5. **S5** (filip): module/week directory + notebook + per-week store, using aryan's `embed()`.
   → **Milestone A = demo steps 1–5 work offline on one laptop.** Nothing else matters until this is green.
6. **S6** (aaron): 2nd device joins the room and sees slides + live notes (demo step 6).
7. **S7** (aaron logs/counts + aryan explain pipeline + filip UI).
8. **S8** (aaron export/import + filip's "paste link" UI; receiver re-embeds via aryan's `embed()`).
9. **S9** (filip, everyone helps): polish + rehearsal.

Until a dependency is merged, build against a stub that matches its contract (e.g. aaron feeds fake `note:added` events, filip shows fake notes).

## Folder layout (adapt to the template, but keep the ownership split)
```
package.json, app entry/config   filip (others: small, announced, additive edits only)
ui/                              filip
src/core/                        filip  (types, event bus, notebook + week store)
src/ai/                          aryan  (stt, embed, tracker, agents, explain, ocr)
src/p2p/                         aaron  (room, feeds, lost-taps, share-link)
scripts/sim-taps*                aaron  (demo tap simulator)
tests/, fixtures/                david
```

## Commands (filip fills in the real ones in stage-1 contract)
- Run app: `npm start` (or `pear run --dev .`): TBD by filip
- Tests: `npm test` → runs `tests/` (david PRs the runner within ~30 min). Coders' own unit tests go next to their code as `*.test.js`, and `npm test` picks them up.
- Lint/build: TBD by filip

## Spec assumptions in use (decided by david; humans can override)
- **HUMAN DECISION: LecScribe is a macOS app.** The demo host and the 2nd device are Macs (Apple Silicon). Everything must run on macOS. aaron and aryan develop on Windows, so write cross-platform code (node `path`, no bash-only scripts, no Windows-only deps). david runs every dev merge on macOS and files platform bugs. filip handles the macOS mic permission (Electron: `NSMicrophoneUsageDescription` / `systemPreferences.askForMediaAccess('microphone')`). QVAC models must load on macOS arm64.
- **Host = the lecturer/presenter laptop** (spec's assumption). It runs all models and the lecturer view (heatmap, Explain slide). Peers only receive.
- Weeks keep **transcripts + summaries, no raw audio**.
- Demo uses a **pre-recorded clip + matching deck** (`fixtures/`, made by david) instead of a live mic. The live mic is nice-to-have.
- Heatmap taps on stage come from **aaron's simulator script** or a 2nd device.
- Share link = a Pears key as text (QR is a bonus).
- AI notes are labelled "AI-generated" and link to their transcript chunk (spec risk table).

## Deadlines
- Contracts (`coord/contracts/stage-<N>.md`) for every stage you own: **within 15 min of this PLAN**.
- filip: S1 PR into dev ASAP (target: within ~45 min).
- 16:00 Theatre A workshop (QVAC/Pears): the humans attend and report back to their Claudes.
