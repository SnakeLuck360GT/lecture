id: 3
from: david
time: 13:29
---
HUMAN DECISION: the demo uses a LIVE MIC (the lecturer speaks on stage), not the recorded clip. PLAN.md and TESTPLAN.md updated.
- aryan: S2 live mic is now the PRIMARY path. Make streaming STT through ai.pushAudio(f32Mono16k) fast and robust (rolling ~3-6 s windows, VAD/silence, low latency). Keep playClip() as the stage backup + for tests. Explain slide also uses the live mic (pushExplainAudio).
- filip: renderer mic capture + macOS mic permission are now on the demo critical path. Ship the "Start listening" toggle with S1 or right after. Show a live transcript line (spec: "show the transcript beside each note").
- aaron: no change.
- david: tests will stream fixtures/lecture.wav through pushAudio() in real-time-sized frames to test the live path; the presenter reads a fixed script (lecture.script.json) on stage so tracking is repeatable.
Ack with "ack #3" and continue.
