// Prompt builders for the local LLM. Kept short: small models + speed. Owner: aryan.

export function stickyPrompt ({ slideText, transcript, max = 2, already = [], maxChars = 8000 }) {
  return [
    {
      role: 'system',
      content: 'You write margin notes for a student during a lecture. A note records something the lecturer SAID ' +
        'that is NOT written on the slide: a tip, example, reason, number, warning, exam hint or announcement. ' +
        'Rules: never restate or paraphrase a slide line; use only facts from the transcript; the transcript comes from ' +
        'speech recognition, so if a name or word looks garbled, leave it out; each note is one plain sentence, at most 20 words, ' +
        'with no "The lecturer said" prefix. Reply with ONLY a JSON array of strings, or [] if nothing new was said. /no_think'
    },
    {
      role: 'user',
      content: 'SLIDE TEXT:\nBinary search\nRequires a sorted array\nO(log n) comparisons\n\n' +
        'WHAT THE LECTURER SAID:\nSo binary search needs the array sorted. A classic bug is computing the middle as low plus high over two, ' +
        'which can overflow, so use low plus high minus low over two. That one shows up in interviews a lot.\n\nWrite up to 2 new notes as a JSON array of strings.'
    },
    {
      role: 'assistant',
      content: '["Compute mid as low + (high - low) / 2; (low + high) / 2 can overflow", "The overflow bug is a common interview question"]'
    },
    {
      role: 'user',
      content: `SLIDE TEXT:\n${clip(slideText, 1200) || '(no text)'}\n\n` +
        (already.length ? `NOTES ALREADY WRITTEN (do not repeat):\n- ${already.join('\n- ')}\n\n` : '') +
        `WHAT THE LECTURER SAID:\n${clipEnds(transcript, maxChars)}\n\n` + // only THIS slide's transcript
        `Write up to ${max} new notes as a JSON array of strings. Do NOT restate the slide text.`
    }
  ]
}

export function explainPrompt ({ slideText, transcript }) {
  return [
    {
      role: 'system',
      content: 'Students said they were lost on a slide, so the lecturer explained it again. ' +
        'Summarise the lecturer\'s explanation in plain language for a student, in 2-4 short sentences. ' +
        'Use the slide text only as context; keep the lecturer\'s own examples. Reply with the summary only. /no_think'
    },
    {
      role: 'user',
      content: `SLIDE TEXT:\n${clip(slideText, 1200) || '(no text)'}\n\nLECTURER'S EXPLANATION:\n${clip(transcript, 3000)}`
    }
  ]
}

/** H-6 "Explain this": explain one slide to a student using the whole deck + what was said. */
export function explainThisPrompt ({ slideIndex, slideText, outline, said, recent }) {
  return [
    {
      role: 'system',
      content: 'A student asked for a clear explanation of the current lecture slide, because the lecturer had no time. ' +
        'Explain it in plain language in 3-5 short sentences: what it means, why it matters, and one small concrete example. ' +
        'Use the other slides for context and anything the lecturer said; do not invent facts beyond standard textbook knowledge. ' +
        'Do not just repeat the slide bullets. Reply with the explanation only. /no_think'
    },
    {
      role: 'user',
      content: `ALL SLIDES (outline):\n${clip(outline, 1800)}\n\n` +
        `CURRENT SLIDE ${slideIndex + 1}:\n${clip(slideText, 900) || '(no text)'}\n\n` +
        (said ? `WHAT THE LECTURER SAID ON THIS SLIDE:\n${clip(said, 1500)}\n\n` : '') +
        (recent ? `RECENT LECTURE CONTEXT:\n${clip(recent, 800)}\n\n` : '') +
        'Explain the current slide.'
    }
  ]
}

export function lecturePrompt ({ outline, transcript }) {
  return [
    {
      role: 'system',
      content: 'Summarise a lecture for a student\'s notebook in 4-6 bullet points. Plain language. /no_think'
    },
    {
      role: 'user',
      content: `SLIDE TITLES:\n${clip(outline, 1500)}\n\nTRANSCRIPT:\n${clip(transcript, 5000)}`
    }
  ]
}

function clip (s, n) {
  s = String(s || '').trim()
  return s.length > n ? s.slice(0, n) + '…' : s
}

/** Like clip, but keeps the START and the END (the newest speech must never be cut off). */
export function clipEnds (s, n) {
  s = String(s || '').trim()
  if (s.length <= n) return s
  const head = Math.floor(n * 0.3)
  return s.slice(0, head) + ' … ' + s.slice(s.length - (n - head))
}
