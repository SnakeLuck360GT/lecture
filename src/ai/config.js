// AI configuration: model choices and tuning knobs (owner: aryan, S2/S3/S4/S7).
// Every value can be overridden with an env var so we can swap models on the demo host.

const env = (typeof process !== 'undefined' && process.env) || {}

export const config = {
  mock: env.LECSCRIBE_AI_MOCK === '1',
  models: {
    stt: env.LECSCRIBE_STT_MODEL || 'WHISPER_TINY',
    vad: env.LECSCRIBE_VAD_MODEL || '', // e.g. VAD_SILERO_5_1_2 (optional)
    embed: env.LECSCRIBE_EMBED_MODEL || 'EMBEDDINGGEMMA_300M_Q4_0',
    embedFallback: 'GTE_LARGE_FP16',
    llm: env.LECSCRIBE_LLM_MODEL || 'QWEN3_600M_INST_Q4',
    ocr: env.LECSCRIBE_OCR_MODEL || 'OCR_LATIN'
  },
  stt: {
    chunkSec: Number(env.LECSCRIBE_CHUNK_SEC || 6),
    liveMinSec: Number(env.LECSCRIBE_LIVE_MIN_SEC || 2),
    liveMaxSec: Number(env.LECSCRIBE_LIVE_MAX_SEC || 6),
    liveSilenceMs: Number(env.LECSCRIBE_LIVE_SILENCE_MS || 450),
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
    minNewChars: 400,
    minIntervalMs: 20000,
    maxNotes: 3
  }
}
