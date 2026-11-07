# Stage 3 contract: slide embeddings + auto slide tracking (+ OCR, shared embed()) (owner: aryan, `src/ai/`)
Status: DRAFT v1 (13:40). Runtime and facade: see stage-2.md.

## Functions
```js
// src/ai/embed.js
embed(text: string)    -> Promise<number[]>
embed(texts: string[]) -> Promise<number[][]>
cosine(a, b)           -> number
// src/ai/ocr.js
ocr(image /* path | data URL | Buffer */) -> Promise<string>
// src/ai/tracker.js
createTracker({ bus, threshold = 0.55, margin = 0.04, lookahead = 2, manualHoldMs = 10000 }) -> { current(), dispose() }
```
- `embed()` is the one shared embedding function. S5 (week store) and S8 (import re-embed) call `ai.embed()`. For search, use `cosine` or QVAC `createVectorIndex({ dim })` (S5's choice).

## Tracking behaviour
- On `slides:loaded`: embeds every `slide.text` (in memory only, dropped on the next load).
- On each `transcript:chunk`: embeds a rolling window (the last 2 chunks) and scores slides `current .. current + lookahead`, with a small bonus for `current + 1` (spec: "bias towards the next slide").
- Advances only if the best candidate is not the current slide AND its score is at least `threshold` AND it beats the current slide by at least `margin`. Never moves backwards automatically.
- **Manual wins:** any `slide:changed { source: 'manual' }` sets the current slide and pauses auto-advance for `manualHoldMs`.

## Events
- consumes: `slides:loaded` Slide[], `transcript:chunk`, `slide:changed`
- emits: `slide:changed { index, source: 'auto', confidence }` (extra field `confidence`, 0-1)
- emits: `tracker:scores { chunkId, scores: { [slideIndex]: number } }` (debug; optional to show)

## OCR (S1 step) @filip
In the PDF loader, if a slide's extracted text is shorter than ~20 chars, call `await ai.ocr(slide.image)` and use the result as `slide.text` BEFORE emitting `slides:loaded`.

## Models / env
| purpose | default | env |
|---|---|---|
| embeddings | `EMBEDDINGGEMMA_300M_Q4_0` (fallback `GTE_LARGE_FP16`) | `LECSCRIBE_EMBED_MODEL` |
| OCR | `OCR_LATIN` (`modelType: MODEL_TYPES.ggmlOcr`), loaded lazily on the first `ocr()` | - |

## Run
`node src/ai/scripts/track-demo.js fixtures/slides.json fixtures/lecture.wav` prints chunk -> slide decisions.
