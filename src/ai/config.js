// AI configuration: model choices and tuning knobs (owner: aryan, S2/S3/S4/S7).
// Every value can be overridden with an env var so we can swap models on the demo host.

const env = (typeof process !== 'undefined' && process.env) || {}

export const config = {
  mock: env.LECSCRIBE_AI_MOCK === '1',
  models: {
    stt: env.LECSCRIBE_STT_MODEL || 'WHISPER_LARGE_V3_TURBO', // finals (B-008: WER 8.1%, RTF 0.48 on the M5)
    sttPartial: env.LECSCRIBE_STT_PARTIAL_MODEL || 'WHISPER_EN_BASE_Q8_0', // live partials (RTF 0.04)
    vad: env.LECSCRIBE_VAD_MODEL || '', // e.g. VAD_SILERO_5_1_2 (optional)
    embed: env.LECSCRIBE_EMBED_MODEL || 'EMBEDDINGGEMMA_300M_Q4_0',
    embedFallback: 'GTE_LARGE_FP16',
    llm: env.LECSCRIBE_LLM_MODEL || 'QWEN3_1_7B_INST_Q4',
    ocr: env.LECSCRIBE_OCR_MODEL || 'OCR_LATIN'
  },
  stt: {
    chunkSec: Number(env.LECSCRIBE_CHUNK_SEC || 6),
    liveMinSec: Number(env.LECSCRIBE_LIVE_MIN_SEC || 2),
    liveMaxSec: Number(env.LECSCRIBE_LIVE_MAX_SEC || 5),
    liveSilenceMs: Number(env.LECSCRIBE_LIVE_SILENCE_MS || 350),
    livePartialMs: Number(env.LECSCRIBE_LIVE_PARTIAL_MS || 500),
    language: env.LECSCRIBE_STT_LANG || 'en'
  },
  tracker: {
    threshold: Number(env.LECSCRIBE_TRACK_THRESHOLD || 0.35),
    mockThreshold: 0.2, // bag-of-words mock scores run lower than real embeddings
    margin: Number(env.LECSCRIBE_TRACK_MARGIN || 0.05),
    strongMargin: Number(env.LECSCRIBE_TRACK_STRONG || 0.12),
    lookahead: 2,
    nextBonus: 0.03,
    windowChunks: 2,
    manualHoldMs: 10000
  },
  agents: {
    minWords: Number(env.LECSCRIBE_MIN_WORDS || 40), // H-4: never summarise a slide on less context than this
    minLectureWords: 80, // H-4: floor for summariseLecture
    minNewChars: 180, // ~12 s of speech: first sticky shows up while the slide is still up
    minIntervalMs: 12000,
    maxNotes: 3, // filters keep precision; the prompt asks for 'up to 3' only grounded facts
    onSlideOverlap: 0.6, // H-5: drop a note if >= 60% of its content words are on the slide (plus per-line paraphrase check)
    minGrounding: 0.45 // keep a note only if >= 45% of its NEW words were actually said
  }
}
