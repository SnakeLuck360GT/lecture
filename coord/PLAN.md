# PLAN: LecScribe (owner: david, written 13:20)

## FEATURE FREEZE 16:33 (aryan): fixes only. Exceptions: H-1, the H-6 button + style, B-018 (filip). Rehearsal running on the Mac (david), peer = aaron on the hotspot.
- **H-7 [P1] approved 16:49 as a freeze exception (demo-critical): fullscreen PRESENT mode.** Owner **@aaron** (reassigned: filip is silent since 16:07 and holds H-1 + the H-6 button). Build it as a self-contained component `ui/components/present-mode.js`: `mountPresentMode({ lec, getSlides, getIndex })` -> { open(), close(), destroy() }. F key or a Present button opens a fullscreen overlay (document.requestFullscreen) showing the current slide image letterboxed (contain, no crop); arrows / PageUp / PageDown / Space / a clicker emit `slide:changed { source: 'manual' }` via lec.emit and follow the bus `slide:changed`; Esc exits; listening keeps running (same renderer, nothing stopped); T toggles a transcript strip (transcript:partial + transcript:chunk), N toggles a notes overlay for the current slide (note:added). Styles prefixed `.lec-present`, filip's tokens. Mounting = ONE import + one call in ui/app.js (announce it; coordinate with @filip if he is back). Self-smoke in the app, then PR.

- **REASSIGNED 16:55 (filip silent since 16:07):** the H-6 "Explain this" button + 'AI explanation' style and B-018 -> **@aaron**. H-1 stays with @filip until 17:05; after that it moves to aaron too, unless filip posts progress.

## AFTER DEMO (parked ideas, not now)
- (empty)

## HUMAN BUGS 15:53 (from the humans via aryan, orchestrator). Priority order: H-3 > H-2 > H-1. Each owner: ack in your coord file with an ETA.
- **H-3 [P0] App crashes randomly, especially in long live sessions; handle the models more efficiently.**
  - **@aryan (AI, main process):** memory/disk leaks in src/ai (temp WAVs per STT call are never deleted; partials write one every 0.5 s), bounded buffers, a QVAC worker crash watchdog (WorkerCrashedError / RPC errors -> re-init + reload models, not a dead AI), lazy OCR unload, and log memory every 60 s (`[ai] mem rss=...`).
  - **@filip (renderer):** cap the DOM: the transcript list keeps at most ~200 lines (older ones are already saved), the sticky list is virtualised or capped per slide, and no listener leaks on view switches (lec.on unsubscribes). Add `process.on('uncaughtException'/'unhandledRejection')` logging in main (log, never exit) and `app.on('render-process-gone' / 'child-process-gone')` -> log the reason + reload the window.
  - **@david:** a soak test on the Mac: a 30-min live session (loop fixtures/lecture.wav through pushAudio, or the app with the clip) while logging RSS every minute; report crash logs (main stderr, `~/Library/Logs/DiagnosticReports`) and the RSS curve before/after the fixes.
- **H-2 [P1] Generated notes: linked + AUTO-SAVED per session, shown instantly, persistent; mark IMPORTANT; per-module list of important notes.**
  - **@aaron (src/library):** auto-save every `note:added` (kind ai + lecturer) into the live lecture as soon as it arrives, on the HOST and on PEERS (peers save into the local lecture that onJoined created); keep `sourceChunkIds` + `slideIndex` (the "linked" part: note -> slide + transcript). API: `setNoteImportant(lectureId, noteId, bool)`, `listImportant(moduleId) -> [{ lectureId, lectureTitle, date, notes: [...] }]` grouped by lecture, in lecture order. Persisted, survives restart, searchable. Update stage-5-library.md; david adds contract tests.
  - **@filip (UI):** notes show instantly in the lecture view (no click needed to keep them; the old "click to save" becomes a star = mark important); a star toggle on every sticky; the module page gets an "Important" section listing the starred notes grouped by lecture (click -> opens that lecture at that slide).
- **H-4 [P1] Summaries sometimes don't really summarise: too little context.** (human, relayed by aaron 15:55) **@aryan:** a minimum word count per slide before the notes agent runs (~40 words), very short slides are skipped (their text stays pending in case the lecturer comes back), and the same floor applies to summariseLecture (~80 words; otherwise a clear "not enough lecture yet" message).
- **H-5 [P1] Generated notes must not repeat what is already on the slide.** (human via aaron 15:58) **@aryan:** stricter on-slide filter. The ">= 1 note per slide" fallback may never keep an on-slide candidate (the human prefers no note over a repeat), and gets a lower overlap threshold. Re-check with live-mic transcripts.
- **H-6 [P1] NEW: "Explain this" for ANY user** (student/peer too), when the lecturer had no time. **Decision (aryan): it runs on the HOST** (peers have no models; Windows cannot run them). Flow: the UI emits `explain:request { slideIndex, from: 'host'|'peer' }`; on a peer, the room forwards it to the host (**reassigned to @aryan at 16:08 while aaron is offline; done in PR #63**) (host bus re-emits `explain:request`); the host AI (**@aryan**, `ai.explainThis(slideIndex)` + a bus listener) explains the slide using ALL slide texts + the transcript so far and emits `note:added { kind: 'explain', slideIndex, text, ... }`, which the room already republishes to peers and H-2 auto-saves. One request per slide at a time (duplicates while running are ignored); progress via `explain:status { slideIndex, state, kind: 'explain' }`. **@filip:** an "Explain this" button in the lecture view (host + peer, NOT host-only) that emits `explain:request`; a distinct style for kind 'explain' ("AI explanation", not the lecturer's blue). Contract: stage-7-ai.md v1.1 (aryan).
- **H-1 [P1] Notes/documents are sometimes cropped and hard to read. Show per page + allow zoom.**
  - **@filip (UI):** slides/documents render one page at a time, fit-to-view with no cropping (contain, keep the aspect ratio), plus zoom (+/-, Ctrl/Cmd+scroll/pinch, fit, 100%) with panning when zoomed; sticky notes wrap fully (no clipped text; expand on hover/click if long); the notes column scrolls instead of clipping.

## ROLE CHANGE 15:51 (HUMAN DECISION, david): ORCHESTRATOR = @aryan, TESTING = @david
- **aryan (orchestrator/master, plus his AI area):** owns PLAN.md, PROTOCOL.md, BROADCAST.md and stage/task assignments and priorities; may broadcast; coordinates the team and talks to the humans for coordination; runs the dev→main release (PR, `--merge`, tag `demo-v1`) ONLY when a human says ship AND david has signed off on the suite + smoke checklist.
- **david (tester):** owns tests/, fixtures/, the test runner, TESTPLAN.md (incl. the demo smoke checklist) and BUGS.md (logging with repro + suggested owner, verifying fixes, dev health). Runs everything on the Mac demo host. david no longer assigns work: bugs get a suggested owner, and @aryan confirms or reassigns.
- CLAUDE.md is unchanged (frozen after setup); this section overrides its role list.


Stages = the spec's build order (SPEC.md, "Build order"). Stretch goals come later, assigned by david.

## HUMAN FEATURE (15:12, david): 6-DIGIT JOIN CODE + NEARBY SESSIONS. Owner: @aryan (new folder `src/discovery/` + `ui/components/nearby-sessions.js`); @aaron integrates into his room-panel / join-room after personal notes.
- **Code:** when the host shares a live session it gets a random 6-digit code (e.g. `482 913`), shown big in the Live session popover (aaron's room-panel). The join box (aaron's join-room) accepts EITHER a 6-digit code OR a lecscribe:// link.
- **Nearby:** a "Nearby sessions" list in the Library sidebar shows live sessions on the same network (title + code + host name), and one click joins.
- **API** `src/discovery/index.js` (main process, exposed as `window.lec.discovery(method, ...args)` + bus events; small announced additions to main/preload):
  - `advertise({ title, link }) → { code }` (host), `stopAdvertising()`
  - `listNearby() → [{ code, title, link, hostName, lastSeen }]`; bus event `discovery:nearby` with the list whenever it changes
  - `resolveCode(code, { timeoutMs = 8000 }) → link`, or throw `CODE_NOT_FOUND`
- **Mechanism (verify APIs in node/hyperswarm docs; no invented APIs):** (1) LAN beacon: UDP broadcast on a fixed port every ~1 s with `{v:1, code, title, link, hostName}`; listeners build the nearby list (expire after ~5 s). Works on the hotspot with no DHT. (2) Cross-network fallback for resolveCode: host also joins a Hyperswarm topic = hash('lecscribe-code-v1:' + code) and, on connection, sends the link; the resolver joins that topic as a client and reads it. Try the LAN first, then the DHT.
- Codes: random 6 digits, re-roll if resolveCode finds a collision. Text only; the link is shareable anyway, so this adds no new exposure.
- Tests: unit (beacon encode/decode, expiry), 2 instances on one machine: advertise → listNearby sees it → resolveCode returns the link. david adds contract tests once the contract is posted.
- Contract: `coord/contracts/discovery.md` within ~10 min.

## HUMAN FEATURE (15:08, david): PERSONAL NOTES on slides, local to each device. Owner: @aaron (data + component); @filip mounts it.
- Any user (host or viewer) can type their own notes on the current slide in the notes column: add, edit, delete; multi-line; autosave.
- **Local only:** stored in that device's library under the lecture, kind `'personal'` (or a separate personal-notes file). NEVER emitted as `note:added` on the bus (the host room republishes note:added), NEVER put in the room feed, and EXCLUDED from `exportLecture` / `shareLecture` / imports.
- Indexed in that lecture's own vector store, so `search` / `searchAll` (Ask across lectures) find them; hit kind `'personal'`.
- Works in viewer (peer) mode too: a peer's personal notes go into the local lecture that onJoined created.
- API (library, via `window.lec.library`): `addPersonalNote(lectureId, { slideIndex, text }) → note`, `updatePersonalNote(lectureId, id, { text })`, `deletePersonalNote(lectureId, id)`, `listPersonalNotes(lectureId, slideIndex?)`. Update contract stage-5-library.md.
- Component `ui/components/personal-notes.js`: `mountPersonalNotes(el, { lec, lectureId, getSlideIndex, onChange })` → `{ setSlide(i), destroy() }`; styled 'My notes' (distinct from AI stickies and lecturer notes; uses filip's tokens). @filip mounts it at the top or bottom of the notes column for the current slide.
- Tests: CRUD, persistence, not in exportLecture, never on the bus, searchable. david adds contract tests.

## HUMAN UI REQUESTS (15:07, david), BEFORE "NEXT FOR FILIP #2"
1. **[P1] Viewer (peer) mode: slide-first, minimal.** People who joined a live session (not recording) see a cleaner, slide-focused view: slide as large as possible, thumbnails optional/collapsed, notes column narrower or toggleable, live transcript strip (aaron's B-015 brings it to peers), the "I'm lost" button. REMOVE every host-only control in peer mode: mic picker + level meter + Test, Start listening, Play clip, Open PDF, Demo deck, Explain slide, Share live session, Write summary. Keep: Leave session, Save note (click a sticky), search-this-lecture.
2. **[P1] "Back to live lecture" on Home.** While a live session is running (host listening/sharing OR joined as peer), the Library screen shows a clear, persistent "● Live: Week 3 · Hash Tables. Back to lecture" button/banner (e.g. top of the Library main area or the sidebar). One click returns to the lecture view without interrupting the session. Navigating to the Library must NOT stop listening or leave the room.
3. **[P2] Unique id per folder (HUMAN ANSWER 15:15: option (a), SHOW it):** every module displays a short unique ID, e.g. `#A3F9C2` = the uppercase random-hex tail of module.id (already unique), in the sidebar row (muted, small) and the module header, with click-to-copy. If a collision is ever possible, ask @aaron to add a `shortId` to the library.

## NEXT FOR FILIP #2 (15:05, david)
1. **[P2] Real macOS app packaging.** In dev the menu bar and dock say "Electron". Add electron-builder (devDependency) with `build.appId` (e.g. `uk.ac.manchester.lecscribe`), `productName: "LecScribe"`, `mac.target: dir` (an unsigned .app is fine), `mac.extendInfo.NSMicrophoneUsageDescription`, `files` excluding fixtures/tests/models. Script `"dist:mac": "electron-builder --mac --dir"`. You can't build a mac target on Windows, so I'll run it on the Mac and report. Also `app.setName('LecScribe')` + the About panel for dev mode. Models stay in ~/.qvac (never bundled).
2. **App icon: HUMAN ANSWER 15:15: FILIP DESIGNS IT.** Match the in-app pen mark (accent green rounded square, white pen), macOS-style squircle with a subtle depth/gradient, 1024 px PNG → `build/icon.png`; BrowserWindow icon + `app.dock.setIcon` in dev + electron-builder `mac.icon`. When it comes: 1024 px PNG → `build/icon.png` (electron-builder makes the .icns), BrowserWindow icon, `app.dock.setIcon` in dev.
3. **[S9] Rehearsal pass in mock mode** using TESTPLAN.md's smoke checklist. Make demo step 5 obvious: from the Library you can see the module → lecture → SAVED notes (a 'Saved' filter or section in the notes column if there isn't one yet). Fix anything rough you hit.

## NEXT FOR FILIP (14:47, david), in order. PR each one separately as soon as it works.
1. **[P1] Explain slide (spec stage 7, missing from the UI).** Host lecture view: an "Explain slide" button on the current slide → `emit('explain:start', { slideIndex })` and route the mic to `ai.pushExplainAudio` (separate from listening) → a "Recording explanation… Done" state → `emit('explain:done', { slideIndex })`. Auto-stop when the slide changes. Show `explain:status` (recording / transcribing / summarising). The resulting `note:added` with `kind: 'lecturer'` gets a distinct "Lecturer explanation" card style, pinned at the top of that slide's notes, savable like any sticky. Heatmap darkness should make the button obvious on lost slides. Demo fallback: a hidden key (e.g. Shift+E) calls `ai.explainFromFile(i, 'fixtures/explain.wav')`. Contract: coord/contracts/stage-7-ai.md (aryan).
2. **[P2] Lecture summary.** On "End session" call `ai.summariseLecture(transcript, slides)` → `library.setSummary(id, text)`. Show a Summary card at the top of the lecture view when not live, and the summary badge + note count in the Library lecture row (spec's week-state table).
3. **[stretch #1] Ask across lectures.** A search field on the Library screen → `library.searchAll(q)` → results grouped by lecture with slide number + snippet; clicking opens that lecture at that slide.

## RESUME 14:21 (david, human request): @filip RESUME NOW. Finish the Library screen + Lecture view from your WIP (72d6386), including the B-006 grey partial line and mounting aaron's P2P components. PR to dev as soon as it runs. Don't wait for perfect smoke; update the smoke flow in a follow-up PR.

## SPLIT 13:58 (david, human-approved): filip's UI load split into components
- **filip** = design system + layout + screens: Library screen, Lecture view, live-session layout. Owns `ui/index.html`, `ui/app.js`, `ui/styles.css`, `src/core/`. **Mounts** the components below into placeholders. Also B-003. Publish the design tokens (CSS variables: colours, radius, spacing, font) at the top of `ui/styles.css` ASAP, and the mount points (element ids) in contracts/stage-1.md, so components match the look.
- **aryan** = `ui/components/mic-picker.js` (B-004, P1, BEFORE B-005): `export function mountMicPicker(el, { onChange(deviceId), onLevel? }) -> { getDeviceId(), destroy() }`, a select of `listMics()` + a live level meter, remembers the choice in localStorage, re-lists on `devicechange`, falls back to default if the device disappears. Then B-005.
- **aaron** = `src/library/` (data layer, see above) + `ui/components/room-panel.js` (host Share-room: link text + QR + peer count), `ui/components/join-room.js` (paste box → peer viewer), `ui/components/lost-button.js` + `ui/components/heatmap.js` (counts strip over thumbnails), `ui/components/share-lecture.js` (Share / Paste-link import for a lecture). Each exports `mountX(el, deps) -> { destroy() }`. Vanilla JS + the shared CSS variables only. No global CSS outside a `.lec-<component>` prefix.
- Components talk only through `window.lec` (emit/on/p2p/library/ai). filip mounts them. Each owner tests their own component in the running app.

## HUMAN UI DIRECTION 13:57 (david): library + polished, minimalist product UI (supersedes S5 "week" wording)
**Model:** Module (a folder, e.g. "COMP26120 Algorithms") → Lecture items (e.g. "Week 3 · Hash Tables", date, state: live | attended | missed | imported) → inside a lecture: slides, saved notes (stickies + lecturer explanations), transcript, summary, and **that lecture's own vector store** (embeddings isolated per lecture, never shared across lectures). Sharing = a lecture's notes via aaron's S8 link; importing into a missed lecture re-embeds locally.

**Screens (filip):**
1. **Library** (app opens here): left sidebar lists modules + "New module". Main area shows the selected module's lectures as a clean list/cards (title, date, state badge, note count). "New lecture" → name it → load a PDF → opens the live session. Missed lectures are greyed with "Paste share link". Imported ones are tagged "Shared by a coursemate".
2. **Lecture view**: slides (large, with thumbnails strip) × notes column side by side; click a sticky to save; transcript drawer; Share button (link + QR); search box scoped to this lecture. The live session is this same view with the mic controls (incl. the B-004 mic picker + level meter) and the room/peer count.
3. Join-a-room entry stays (small, in the sidebar footer).
**Look:** minimalist, professional, "final product". Neutral palette with one accent, generous whitespace, system font (-apple-system / SF Pro), 8 px grid, subtle borders not heavy shadows, no emoji, consistent icon set (inline SVG), smooth but quick transitions, dark mode via prefers-color-scheme, proper empty states. Native macOS feel: hiddenInset title bar, draggable top region, vibrancy-style sidebar.

**Data layer (aaron, NEW: `src/library/`):** contract `coord/contracts/stage-5-library.md` within 15 min.
- persistence under Electron `app.getPath('userData')/library/` (JSON per module/lecture + one vector index file per lecture)
- API: `listModules() / createModule({name, code?}) / renameModule / deleteModule`, `listLectures(moduleId) / createLecture(moduleId, {title, date?}) / getLecture(id) / deleteLecture(id)`, `saveSlides(lectureId, Slide[])`, `saveNote(lectureId, Note)` / `unsaveNote`, `appendTranscript(lectureId, chunks)`, `setSummary`, `search(lectureId, query, k)` (embeds with `ai.embed`, cosine over THAT lecture only), `exportLecture(id) → WeekBundle`, `importLecture(id, link)` (uses S8 `importWeek`, tags shared, re-embeds locally)
- exposed to the renderer through main as `window.lec.library(method, ...args)` (small, announced addition to filip's main/preload; coordinate with @filip)
- unit tests in `src/library/*.test.js` (temp dirs). Delete/rebuild one lecture never touches another.
**aryan:** B-005 note quality first, then `search` quality (chunking transcript for the store) and the stretch "Ask across lectures" (queries each lecture store in turn).

## RE-TASK CANCELLED 13:45: filip opened PR #6 (S1 shell). @aaron: do NOT build a shell. Drop any shell work, and instead wire P2P into filip's shell after #6 merges (coordinate with @filip).

## Assignments (grouped by technology)
| Coder | Area | Stages | Folders owned |
|---|---|---|---|
| **filip** | App shell + all UI (storage moved to aaron at 13:57) | **S1** slide viewer + PDF load (scaffold, PR FIRST) · **S5** module/week directory, notebook, per-week vector store · **S9** UI polish + demo rehearsal · plus the UI pieces of S4 (sticky notes, click to save) and S7 (heatmap strip, "I'm lost" button, Explain/Done buttons) | `ui/`, `src/core/`, root config, `package.json` |
| **aryan** | On-device AI (QVAC) | **S2** speech-to-text on a recorded clip · **S3** slide embeddings + auto slide tracking · **S4** summariser agents (sticky-note generation) · AI half of **S7** (Explain slide: record → STT → LLM summary) · OCR for image-only slides (S1 step) · `embed()` used by S5/S8 | `src/ai/` |
| **aaron** | Peer to peer (Pears) + library data layer `src/library/` (from 13:57) | **S6** Pears room: live notes + slides to a 2nd device, join by key/QR · P2P half of **S7** ("I'm lost" per-device logs, host merge → counts, tap simulator script) · **S8** share link: export/import a week's notes | `src/p2p/`, `scripts/sim-taps*` |
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
- **HUMAN DECISION (15:34): DEMO STEP 2 (Wi-Fi off) IS DROPPED.** The Mac stays on the phone hotspot throughout; the on-device claim is made verbally + via the on-device badge.
- **HUMAN DECISION (15:26): NO WINDOWS HOSTING.** Windows = viewer only. On non-macOS, hide all host controls (Share live session, Start listening, mic picker, Play clip, Open PDF, Demo deck, Explain slide, Write summary); 'New lecture' on Windows only allows missed/imported lectures + joining. Owner: @filip.
- **HUMAN DECISION (14:19): there is only ONE Mac.** The 2nd device for demo step 6 = a teammate's **Windows laptop** running the app as a peer (peers only receive, no models). The host stays the Mac. Cross-platform P2P is a plus for the pitch.
- **HUMAN DECISION: demo host = david's Mac** (Apple M5, 24 GB RAM, macOS 26.6, arm64). That's also where the tester runs. Real-model and real-P2P tests run there (`LECSCRIBE_REAL=1 npm test`). 24 GB means `QWEN3_1_7B_INST_Q4` is worth trying for notes.
- **HUMAN DECISION: LecScribe is a macOS app.** The demo host and the 2nd device are Macs (Apple Silicon). Everything must run on macOS. aaron and aryan develop on Windows, so write cross-platform code (node `path`, no bash-only scripts, no Windows-only deps). david runs every dev merge on macOS and files platform bugs. filip handles the macOS mic permission (Electron: `NSMicrophoneUsageDescription` / `systemPreferences.askForMediaAccess('microphone')`). QVAC models must load on macOS arm64.
- **Host = the lecturer/presenter laptop** (spec's assumption). It runs all models and the lecturer view (heatmap, Explain slide). Peers only receive.
- Weeks keep **transcripts + summaries, no raw audio**.
- **HUMAN DECISION: the demo uses a LIVE MIC.** The presenter reads the fixed narration (`fixtures/lecture.script.json`) over `fixtures/deck.pdf`, so tracking and notes are repeatable. Streaming STT via `ai.pushAudio()` is the primary path. `playClip(fixtures/lecture.wav)` is the stage backup (and is used by tests).
- Heatmap taps on stage come from **aaron's simulator script** or a 2nd device.
- Share link = a Pears key as text (QR is a bonus).
- AI notes are labelled "AI-generated" and link to their transcript chunk (spec risk table).

## Deadlines
- Contracts (`coord/contracts/stage-<N>.md`) for every stage you own: **within 15 min of this PLAN**.
- filip: S1 PR into dev ASAP (target: within ~45 min).
- 16:00 Theatre A workshop (QVAC/Pears): the humans attend and report back to their Claudes.
