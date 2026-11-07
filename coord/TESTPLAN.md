# TESTPLAN: LecScribe (owner: david)

Runner: `npm test` (node's built-in `node --test`, no extra deps) → `tests/**/*.test.js` + coders' `src/**/*.test.js`. Tests for code that isn't merged yet are marked `todo`/skipped (pending).
Fixtures (david, `fixtures/`, fixed, same every run):
- `fixtures/deck.pdf`: 5-slide demo deck ("Week 3: Hash Tables"); slide 4 is image-only (tests OCR)
- `fixtures/lecture.wav`: ~90 s narration (16 kHz mono) that follows slides 1→5 in order and says things that are NOT on the slides (sticky-note bait)
- `fixtures/lecture.script.json`: what is said, with expected slide index per segment and the "not on slide" facts (ground truth for tracking + notes tests)

## Per-stage coverage
| Stage | Owner | Contract tests | Integration | E2E | Status |
|---|---|---|---|---|---|
| S1 slide viewer + PDF load | filip | loadPdf(deck.pdf) → 5 Slides with text + image; prev/next bounds | slides:loaded event fires | demo step 1 | pending contract |
| S2 STT | aryan | transcribe(lecture.wav) → chunks with text; rough WER check vs script | chunks emitted as `transcript:chunk` while clip plays | demo step 3 | pending contract |
| S3 tracking | aryan | given script segments → predicted slide == expected for ≥ 80%; never jumps backwards without manual input; manual override wins | `slide:changed {source:'auto'}` sequence 0→4 | demo step 3 | pending contract |
| S4 agents + stickies | aryan / filip | notes only for facts not in slide text; each note has slideIndex + sourceChunkIds; labelled AI | `note:added` → sticky renders → click saves | demo step 4 | pending contract |
| S5 directory + week store | filip | save note → listed under module/week; week stores independent (delete one, other intact); search scoped to week | notebook survives app restart | demo step 5 | pending contract |
| S6 Pears room | aaron | join by key; peer receives slides + notes in order | 2 instances on one machine | 2 devices, venue Wi-Fi + hotspot (demo step 6) | pending contract |
| S7 lost taps + explain | aaron / aryan / filip | per-device logs merge to correct counts, no names; explain → lecturer note pinned to slide | sim-taps script lights heatmap | rehearsal | pending contract |
| S8 share link | aaron | export week → key; import into missed week → notes tagged shared + re-embedded locally | 2 instances | 2 devices | pending contract |
| S9 polish | filip | n/a | n/a | full smoke | n/a |
| Offline | all | n/a | no outbound network calls during session (models already downloaded) | demo step 2 | pending |

## Demo smoke checklist (= the exact on-stage click-path; re-run before every release)
Setup: host Mac (david's) has mic permission granted, models pre-downloaded (`npm run ai:warm`), BOTH laptops already on the phone hotspot, and the app (re)started AFTER joining the hotspot, the app runs from main, `fixtures/deck.pdf` + `fixtures/lecture.wav` are ready, and a 2nd device has the app installed. Have the backup screen recording ready.

| # | Time | Action | Expected result | Last run |
|---|---|---|---|---|
| 1 | 0:00 | Launch app, open module "COMP26120" → Week 3, load `deck.pdf` | Slide 1 visible with thumbnails; all 5 slides loaded in < 10 s | n/a |
| 2 | 0:20 | Turn host Wi-Fi OFF | App keeps working; no error banners | n/a |
| 3 | 0:40 | Click Start listening; presenter reads the script for slides 1→5 into the LIVE MIC (backup: play `lecture.wav`) | Transcript appears within ~5 s; slide auto-advances 1→2→…→5 roughly in time with the narration; manual prev/next still works | n/a |
| 4 | 1:30 | Watch the margin | ≥ 1 sticky per slide for things said but not written; labelled AI; click one → "saved" state | n/a |
| 5 | 2:00 | Open notebook → COMP26120 → Week 3 | Saved sticky listed under the right module/week, with its slide | n/a |
| 6 | 2:20 | (In-app PASS 15:22: Windows peer got slides+history+transcript+partials+notes+I'm lost.) Mac + Windows peer laptop on the PHONE HOTSPOT (NOT eduroam). Host clicks Live session → Share live session; the peer pastes the link / scans the QR in 'Join a live session' | Peer shows the current slide + notes within ~3 s; new notes arrive within ~1.5 s | 14:45: PASS via room-demo scripts (2.0 s connect, 2.7 s slides). In-app run pending |
| 7 | 2:45 | (Optional) run `sim-taps`, then click Explain slide | Heatmap darkens on the tapped slide; lecturer note pinned | n/a |

Known on-stage risks: peer discovery on campus Wi-Fi (fallback: phone hotspot), LLM latency (notes may lag 5–20 s, so pause narration if needed).
