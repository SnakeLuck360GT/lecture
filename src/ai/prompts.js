// Prompt builders for the local LLM. Kept short: small models + speed. Owner: aryan.

export function stickyPrompt ({ slideText, transcript, max = 3, already = [] }) {
  return [
    {
      role: 'system',
      content: 'You write short margin notes for a student during a lecture. ' +
        'Only include points the lecturer SAID that are NOT already written on the slide: ' +
        'explanations, examples, hints, warnings, exam tips. Each note at most 25 words. ' +
        'Reply with ONLY a JSON array of strings. Reply [] if nothing new was said. /no_think'
    },
    {
      role: 'user',
      content: `SLIDE TEXT:\n${clip(slideText, 1200) || '(no text)'}\n\n` +
        (already.length ? `NOTES ALREADY WRITTEN (do not repeat):\n- ${already.join('\n- ')}\n\n` : '') +
        `WHAT THE LECTURER SAID:\n${clip(transcript, 2500)}\n\n` +
        `Write up to ${max} new notes as a JSON array of strings.`
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
