# Stage 8 contract: share link for a week's notes (owner: aaron, folder `src/p2p/`)
Status: DRAFT v1 (13:35). UI (Share button, paste-link box) = filip. Re-embedding on import = aryan's `ai.embed()`, called by filip's week store.

## Model
"We share text, not vectors." The sharer publishes a read-only Hypercore (`valueEncoding: 'json'`) holding one week's bundle, and the link is its key. The receiver pulls it directly over Hyperswarm while the sharer is online.

## Bundle shape (what filip's week store passes in and gets back)
```js
WeekBundle {
  v: 1,
  moduleId, weekId, title?,
  sharedBy?,                    // display name, optional (the sharer chooses)
  slides?: [{ index, text }],   // text only (images later, maybe)
  notes: Note[],                // saved stickies + lecturer explanations
  summary?: string,
  transcript?: TranscriptChunk[],
  exportedAt
}
```
Feed blocks: `{type:'meta', v, moduleId, weekId, title, sharedBy, exportedAt}`, `{type:'slides', slides}`, one `{type:'note', note}` per note, `{type:'summary', text}`, `{type:'transcript', chunks}`, `{type:'end', count}`.

## API: `src/p2p/share.js` (also re-exported from `src/p2p/index.js`)
```js
const share = await shareWeek(bundle, { storage? })
share.link          // 'lecscribe://week/<z32 key>'  (paste anywhere)
share.key           // hex
await share.stop()  // stop seeding (the link only works while a device holding it is online)

const bundle = await importWeek(link, { storage?, timeoutMs = 30000, onProgress? })
// -> the WeekBundle as shared, with each note tagged note.shared = true
// throws Error('SHARE_TIMEOUT') if no device holding the notes is online, Error('BAD_LINK') if the link is malformed
```
Re-sharing works: an importer can call `shareWeek(bundle)` again.

## After import (filip)
The week store saves the bundle into the missed week with `state: 'imported'` ("shared by a coursemate"), then embeds note/summary/transcript text with `ai.embed()` into that week's own vector store.

## How to run / test
- `node src/p2p/scripts/share-demo.js share <bundle.json>` prints a link.
- `node src/p2p/scripts/share-demo.js import <link>` prints the bundle.
- Tests: `src/p2p/share.test.js` (share + import in one process).
