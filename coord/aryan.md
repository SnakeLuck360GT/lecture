# aryan (CODER), Stage(s): S2, S3, S4, S7 (AI half), OCR, embed()
## Status (updated 13:51)
- Doing: waiting for verification of B-001/B-002 + PR #8 on the Mac; next: note quality on real LLM, explain via live mic
- Done: PR #3 (src/ai), #7 (B-001, B-002, qvac dep), #8 (non-blocking startAI, ai:warm)
- Next: S3 embeddings + tracker, then S4 agents
- Blocked on: nothing (gh logged in). Real-model run needs the macOS host (david).
## Messages (newest first)
- [13:57] @david: ack #6. ack B-005, ETA 14:22. Plan: whisper prompt from slide vocabulary (fixes HashMap/modulus), grounding filter (a note must come from that slide's transcript), content-word on-slide filter at 0.5, few-shot prompt with max 2 notes, prefix stripping. After that, search quality for the per-lecture stores. @aaron: I'll give you a search helper for src/library.
- [13:51] @all: merged PR #8 into dev. startAI() no longer blocks on model downloads, so main gets `ai` immediately and calls wait for their model. New: `npm run ai:warm`.
- [13:51] @david: before the offline demo, run `npm run ai:warm` on the Mac with internet. It downloads and smoke-tests STT, embed, LLM and OCR (it OCRs slide-4.png). Paste me any failing step. Please also verify B-001/B-002 on PR #7.
- [13:49] @david: ack #5. re 13:48: yes. If the LLM returns empty, explain.js deliberately pins the raw transcript as the lecturer note (text || transcript), so that test passes even with B-001. With PR #7 it should now be a real summary. To assert it, check note.text !== note.transcript (the note carries a transcript field).
- [13:46] @david: fixed B-001 and B-002 in dev (PR #7), please verify on the Mac. B-001: finalText() reads contentText, then raw.fullText. B-002: newest-chunk scoring; the mock real-time lag is now ~5 s after topic start (one chunk). Also: root package.json has @qvac/sdk 0.23.0 now, and the default LLM is QWEN3_1_7B_INST_Q4. dev 42/42 on Windows.
- [13:46] @all: merged PR #7 into dev, pull it. It adds @qvac/sdk to root deps, so run npm install.
- [13:43] @david: ack #4. The B-001 + B-002 fix PR is coming in a few minutes.
- [13:41] @david: ack B-001, ETA 13:56. ack B-002, ETA right after B-001 (same PR).
- [13:34] @david: re 13:33, done. contracts/stage-2.md v1.1 adds flushAudio(), pushExplainAudio, explainFromFile, idle(), the live VAD params, slide:changed.chunkId and clip:ended.
- [13:32] @all: merged src/ai into dev (PR #3), pull it. node tests/run.mjs gives 26/26. Mock demos: node src/ai/scripts/live-demo.js --mock --fast
- [13:32] @david: please run the real models on the Mac: npm i @qvac/sdk@0.23.0, then node src/ai/scripts/live-demo.js (real time; downloads whisper-tiny, embeddinggemma-300m and qwen3-0.6b). Paste me the ai:status errors and the chunk lag. LECSCRIBE_LLM_MODEL=QWEN3_1_7B_INST_Q4 to try the bigger LLM.
- [13:32] @filip: renderer mic helper is ready: src/ai/browser/mic-capture.js startMic(f32 => window.lec.ai("pushAudio", f32)). Call ai.flushAudio() on Stop listening. Please add @qvac/sdk@0.23.0 to the root package.json deps.
- [13:29] @david: ack #3. Live mic is now primary: I am hardening pushAudio() (energy VAD, silence-cut windows of 2-6 s, low latency). playClip stays as the backup. re 13:27: realtime:false already emits as fast as transcription allows.
- [13:29] @filip: re 13:28, all good. pushAudio wants Float32Array 16 kHz mono frames of any size (100-500 ms is ideal). The mic helper goes in src/ai/browser/mic-capture.js.
- [13:28] @all: src/ai is on branch aryan: facade startAI({bus}), mock mode, tests via node --test src/ai/. It has its own src/ai/package.json {type:module} until the root package.json exists. I PR into dev after filip's S1 lands.
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
- AI is 100% on-device via QVAC: whisper-tiny STT, embeddinggemma-300m slide embeddings, qwen3-1.7b notes and explanations, OCR_LATIN for image-only slides.
- Before going offline: `npm run ai:warm` (downloads and caches all models).
- Live mic is the primary path; `playClip(fixtures/lecture.wav)` is the backup.
- Tracking: advances about one speech chunk (~5 s) after the topic changes. A manual prev/next always wins and pauses auto for 10 s.
- Mock without models: `npm run start:mock`, or `node src/ai/scripts/live-demo.js --mock --fast`.
- Impressive number (david, Mac M5): the LLM runs at ~209 tok/s on the GPU (0.6B), so a note takes about 0.5 s.
