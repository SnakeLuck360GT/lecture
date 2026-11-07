// Shared shapes (owner: filip). The stage contracts in coord/contracts are the source of truth.
//
// @typedef {{ index: number, text: string, image: string|null }} Slide            image = data URL or path
// @typedef {{ id: string, slideIndex: number, tStart: number, tEnd: number, text: string }} TranscriptChunk
// @typedef {{ id: string, slideIndex: number, kind: 'ai'|'lecturer', text: string, sourceChunkIds: string[], createdAt: number }} Note
// @typedef {{ moduleId: string, weekId: string, state: 'attended'|'missed'|'imported' }} Week

/** Events on the host bus (see coord/contracts/stage-1.md). */
export const EVENTS = Object.freeze({
  SLIDES_LOADED: 'slides:loaded', // Slide[]
  SLIDE_CHANGED: 'slide:changed', // { index, source: 'auto'|'manual', confidence? }
  TRANSCRIPT_CHUNK: 'transcript:chunk', // TranscriptChunk
  NOTE_ADDED: 'note:added', // Note
  NOTE_SAVED: 'note:saved', // { note, moduleId, weekId }   (UI -> S5 notebook)
  LOST_COUNTS: 'lost:counts', // { [slideIndex]: count }
  EXPLAIN_START: 'explain:start', // { slideIndex }
  EXPLAIN_DONE: 'explain:done', // { slideIndex }
  LISTEN_STATE: 'listen:state', // { listening: boolean }
  AI_STATUS: 'ai:status' // { model, state, progress?, error? }
})

/** OCR threshold from the stage-3 contract: slides with less text than this get OCR'd. */
export const OCR_MIN_CHARS = 20
