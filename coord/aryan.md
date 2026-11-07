# aryan (CODER), Stage(s): S2, S3, S4, S7 (AI half), OCR, embed()
## Status (updated 13:22)
- Doing: S2 STT standalone script (installing Node, then @qvac/sdk; testing WHISPER_TINY)
- Done: setup, contracts stage-2/3/4/7-ai v1 published
- Next: S3 embeddings + tracker, then S4 agents
- Blocked on: human (gh auth login, needed for PRs only)
## Messages (newest first)
- [13:26] @david: ack #2. src/ai is cross-platform (node:path/os/fs only, no shell). Mock mode via LECSCRIBE_AI_MOCK=1; real models need a macOS check by david.
- [13:22] @all: AI contracts published: coord/contracts/stage-2.md (runtime + facade `startAI({bus})`), stage-3.md (tracker, embed(), ocr), stage-4.md (agents to note:added), stage-7-ai.md (Explain). AI runs in Node/Electron MAIN process. Mock mode: LECSCRIBE_AI_MOCK=1.
- [13:22] @filip: I need (1) the bus to be EventEmitter-like in main, with renderer events bridged over IPC; (2) the S1 PDF loader to call `ai.ocr(image)` for slides with text under 20 chars; (3) mic capture in the renderer (I'll ship the helper). Please confirm, or tell me your stack.
- [13:22] @david: please make fixtures/lecture.wav 16 kHz mono WAV. A fixtures/slides.json (Slide[] with text) would let me test tracking without the PDF loader. Optional: fixtures/explain.wav for the S7 demo.
- [13:19] @david: ack #1, ack PLAN, stages S2, S3, S4, S7 (AI half), OCR, embed(). Contracts ETA 13:19+15min.
- [13:14] @all: aryan setup done at 13:14.
## Provides / Needs   (verified SDK/API notes)
- QVAC: `@qvac/sdk@0.23.0` (npm). Node: spawns its own Bare worker; first `loadModel()` can fail with RPC_INIT_TIMEOUT, so re-run or set `QVAC_RPC_INIT_TIMEOUT_MS`. Docs dump: https://docs.qvac.tether.io/llms-full.txt (2 MB, very useful).
- Verified exports: `loadModel({modelSrc, modelType?, modelConfig?, onProgress})` -> modelId; `unloadModel({modelId})`; `transcribe({modelId, audioChunk: path|buffer, prompt?, metadata?})` -> string, or segments {text,startMs,endMs} when metadata:true; `embed({modelId, text: string|string[]})` -> {embedding}; `completion({modelId, history, stream})` -> run with `.events` / `.final`; `ocr({modelId, image})` -> {blocks: Promise<{text,bbox,confidence}[]>}; `createVectorIndex({dim})` -> index.add({ids,vectors}) / index.search({query,k}); `close()`.
- Model constants seen in the docs: WHISPER_TINY, WHISPER_EN_TINY_Q8_0, WHISPER_BASE_Q8_0, VAD_SILERO_5_1_2, GTE_LARGE_FP16, EMBEDDINGGEMMA_300M_Q4_0, QWEN3_600M_INST_Q4, QWEN3_1_7B_INST_Q4, LLAMA_3_2_1B_INST_Q4_0, OCR_LATIN (+ MODEL_TYPES.ggmlOcr), PARAKEET_* (macOS CoreML variants).
- SDK also ships hyperswarm/hyperdrive/corestore as deps (FYI @aaron, possible version alignment).
## Decisions
- [13:22] AI runs in the Node/Electron main process with a single facade, `startAI({bus})`. Mock mode is available for the UI and tests.
- [13:22] Demo STT = transcribe the recorded clip with timestamps, then emit chunks paced in real time with playback (robust; no live-mic dependency).
- [13:22] Small models by default (whisper tiny, embeddinggemma 300M, qwen3 0.6B), overridable with env vars.
## Demo notes
