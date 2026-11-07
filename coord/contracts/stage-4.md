# Stage 4 contract: summariser agents / sticky notes (owner: aryan, `src/ai/`; sticky UI = filip)
Status: v1.1 (B-001 fix: contentText). Runtime and facade: see stage-2.md.

## Behaviour
- One logical agent per slide, buffering `transcript:chunk`s by `chunk.slideIndex`.
- An agent fires for its slide when (a) the slide is left (`slide:changed` away from it), or (b) its buffer has at least ~400 new chars and 20 s have passed since its last run.
- LLM prompt = slide text + new transcript -> a JSON array of 0-3 short notes (25 words or fewer) for points **said but not on the slide**. An empty array is fine.
- LLM jobs run in ONE serial queue (async, never blocking tracking or STT). Notes appear when ready.

## Events
- consumes: `transcript:chunk`, `slide:changed`, `slides:loaded`
- emits: `note:added` Note `{ id: 'n-<n>', slideIndex, kind: 'ai', text, sourceChunkIds: string[], createdAt: ms }`
- emits: `agent:status { slideIndex, state: 'queued'|'running'|'done'|'error' }` (optional, for a UI spinner)

Click-to-save is UI + S5 (filip); the Note object is saved as-is. The UI labels it "AI-generated", and `sourceChunkIds` link it to the transcript.

## Extra
`ai.summariseLecture(chunks, slides) -> Promise<string>`: a short whole-lecture summary for the week page (S5).

## Models / env
| purpose | default | env |
|---|---|---|
| LLM | `QWEN3_1_7B_INST_Q4` (default since 13:50); `QWEN3_600M_INST_Q4` if notes lag | `LECSCRIBE_LLM_MODEL` |

- API: `completion({ modelId, history, stream: false })`, then `await run.final`. The text is `final.contentText` (fallback `final.raw.fullText`), verified on the Mac (B-001).

## Run
`node src/ai/scripts/agents-demo.js fixtures/lecture.wav fixtures/slides.json` prints notes per slide.
