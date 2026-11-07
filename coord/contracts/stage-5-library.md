# Stage 5 contract: library data layer (owner: aaron, folder `src/library/`)
Status: DRAFT v1 (14:05). Replaces the old "week store" wording. UI = filip (Library screen + Lecture view). Embeddings = aryan's `ai.embed()`.

## Model
```
Module   { id, name, code?, createdAt, lectureCount }
Lecture  { id, moduleId, title, date?, state: 'live'|'attended'|'missed'|'imported', createdAt, updatedAt,
           slideCount, noteCount, hasSummary, sharedBy? }               // what lists show
LectureFull = Lecture + { slides: Slide[], notes: Note[], transcript: TranscriptChunk[], summary: string }
SearchHit { score, kind: 'note'|'transcript'|'summary'|'slide', text, slideIndex, refId, lectureId }
```
- Slide images are stored as files and come back as `data:` URLs from `getLecture`.
- Saved notes keep the Note shape (`id, slideIndex, kind, text, sourceChunkIds, createdAt`), plus `savedAt` and `shared?`.

## Persistence (plain JSON, cross-platform paths)
```
<dir>/                         dir = app.getPath('userData')/library   (tests: a temp dir)
  modules.json                 [Module]
  lectures/<lectureId>/
    lecture.json  slides.json  notes.json  transcript.json  summary.txt
    slides/<index>.<ext>       slide images
    vectors.json               THIS lecture's vector store { dim, items: [{ id, kind, refId, slideIndex, text, vector }] }
```
Each lecture is its own folder, so deleting, rebuilding or sharing one lecture never touches another. Writes are atomic (tmp + rename) and serialised per lecture.

## API: `src/library/index.js`
```js
import { createLibrary, startLibrary } from './src/library/index.js'
const lib = await createLibrary({ dir, embed /* async (string|string[]) -> number[]|number[][] , optional */, bus /* optional */ })
```
All methods are async and return plain data (IPC-safe).
| method | returns / notes |
|---|---|
| `listModules()` | `Module[]` (sorted by name) |
| `createModule({ name, code? })` | `Module` |
| `renameModule(id, { name?, code? })` | `Module` |
| `deleteModule(id)` | `true` (deletes its lectures too) |
| `listLectures(moduleId)` | `Lecture[]` (newest first by date/createdAt) |
| `createLecture(moduleId, { title, date?, state? = 'attended' })` | `Lecture` (use `state:'missed'` for a lecture you didn't attend) |
| `updateLecture(id, { title?, date?, state? })` | `Lecture` |
| `getLecture(id)` | `LectureFull` |
| `deleteLecture(id)` | `true` |
| `saveSlides(id, Slide[])` | `Lecture`. Indexes slide text |
| `saveNote(id, Note)` / `unsaveNote(id, noteId)` | `Lecture`. Indexes / un-indexes the note |
| `appendTranscript(id, TranscriptChunk[])` | `Lecture`. Indexes each chunk (deduped by chunk id) |
| `setSummary(id, text)` | `Lecture`. Indexes it |
| `search(id, query, k = 5)` | `SearchHit[]`, cosine over THAT lecture's store only. Falls back to keyword match if no `embed` |
| `searchAll(query, k = 5)` | `SearchHit[]` across lectures (queries each store in turn; stretch "Ask across lectures") |
| `rebuildIndex(id)` | `{ items }` re-embeds that lecture only |
| `exportLecture(id)` | `WeekBundle` (stage-8.md shape: moduleId, weekId = lectureId, title, slides text, notes, summary, transcript) |
| `shareLecture(id)` | `{ key, link }` (`lecscribe://week/...`; seeds while the app is open) |
| `stopSharing(id)` | `true` |
| `importLecture(id, link)` | `LectureFull`. Pulls via S8 `importWeek`, stores notes/summary/transcript/slide text, `state:'imported'`, `sharedBy`, then re-embeds locally |

### Live-session capture (saves filip wiring work)
| method | notes |
|---|---|
| `startSession(id)` | sets the lecture `state:'live'` and records bus events into it: `slides:loaded` -> saveSlides, `transcript:chunk` -> appendTranscript. Notes are NOT auto-saved (the student clicks to save). |
| `endSession()` | stops recording; `state:'attended'` |
| `activeLecture()` | `id \| null` |

### Events (on the main bus, if given)
`'library:changed' { what: 'modules'|'lectures'|'lecture', moduleId?, lectureId? }`: the UI re-fetches.

## Exposure to the renderer (small, announced edit to filip's main/preload, done by aaron in his PR)
`startLibrary({ bus, ai, dir })` adapter, auto-loaded by `src/core/main.js` like startP2P, with `dir = app.getPath('userData')/library`.
Renderer: `await window.lec.library(method, ...args)` -> IPC `library:call`.

## Tests
`src/library/library.test.js` (temp dirs, fake deterministic embed): CRUD, persistence across instances, per-lecture isolation (delete or rebuild one, the other is intact), search scoped to one lecture, export -> share -> import round trip (local DHT testnet).
