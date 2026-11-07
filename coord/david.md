# david (MASTER), Stage(s): tests, fixtures, release
## Status (updated 13:27)
- Doing: watching dev; writing contract tests for S1 + S6/S7/S8 as contracts land
- Done: CLAUDE.md, broadcast hook, .gitignore, coord/ skeleton
- Next: contract tests as contracts land; track acks for broadcast #1
- Blocked on: nothing
## Messages (newest first)
- [13:51] @filip: ASSIGNED B-004 [P1] mic picker + level meter (human wants to use the iPhone mic via Continuity for the demo). Do this before the notebook (S5). Details in BUGS.md.
- [13:48] @filip: REVIEWED PR #6 on the Mac with dev merged in: npm install OK, 45/45 tests, `npm start` (mock) opens the window and logs `[main] AI started (mock mode)`. ✅ Merge it yourself now (`gh pr merge 6 --merge`) and post @all. Then ASSIGNED B-003 [P2] (app crashes when ELECTRON_RUN_AS_NODE is set; small fix in BUGS.md). Ack #4 please.
- [13:48] @aryan: REAL suite on the Mac (dev c207594): everything passes except the S4 notes test (B-001, as expected). Real tracking accuracy 13/16, auto sequence [1,2,3,4], live path 16 chunks. Explain-from-file passes even with empty LLM output. Check whether that's a fallback to the raw transcript.
- [13:45] @aaron: CANCELLED the shell re-task. filip's PR #6 has the shell. Please don't build one. @filip: thanks for #6. I'm testing it on the Mac now. Please ack #4 in filip.md, and commit + push every ~20 min.
- [13:40] @aryan: ASSIGNED B-001 [P1] real LLM output always empty (`final.contentText`, not `.content`), so 0 notes on the real run. Fix before your next feature. Details in BUGS.md.
- [13:40] @aryan: ASSIGNED B-002 [P2] tracking lags ~1 chunk at each slide change. After B-001.
- [13:40] @aryan: re 13:32. REAL-MODEL RESULTS on the Mac (M5, macOS 26.6): all 3 models load in 2.8 s from cache (first download ~740 MB). Live STT lag is a steady 2.8–3.0 s per chunk. Whisper-tiny transcript is good (a few slips: 'link list', 'cash friendly', 'more tized'). Tracking 0→1→2→3→4 is correct, with confidence 0.70–0.84. LLM qwen3-0.6b runs on GPU at 209 tok/s with 44 ms to first token. No ai:status errors.
- [13:33] @filip: HUMAN REQUEST (from david): switch your git identity from the uni email to your personal GitHub email. Your commits currently show as `v06813fm <filip.mazur-cierniak@manchester.student.ac.uk>`, which isn't linked to Filip5011. In BOTH your project folder and COMMS run: `git config user.name "Filip"` and `git config user.email "<your personal email on the Filip5011 account>"` (`gh api user/emails --jq '.[].email'` lists the emails on your account; the noreply `<id>+Filip5011@users.noreply.github.com` also works). Use `--global` if that machine is yours. Don't rewrite old commits. Confirm in your coord file.
- [13:33] @all: merged aryan's src/ai (PR #3) and I re-ran on the Mac: dev 🟢 27/27 (P2P + real-model pending). New test: live-mic streaming through pushAudio() in 250 ms frames. @aryan: please add flushAudio() to contracts/stage-2.md (it's in index.js, not in the contract).
- [13:30] @filip: PRIORITY. aryan's src/ai is done (24/24 contract tests pass on the Mac) and aaron's src/p2p is close. Both are blocked on your scaffold. Please PR a MINIMAL skeleton into dev within ~15 min, BEFORE the PDF viewer: root package.json (type: module, electron dep, scripts start + test = node tests/run.mjs), an Electron main that opens a blank window, src/core/bus.js (EventEmitter) and an empty ui/index.html. Viewer, IPC and mic come in follow-up PRs. Also please ack #3 (live mic). When idle, run the background watcher (CLAUDE.md section 5) so you don't miss broadcasts.
- [13:27] @all: merged [test] fixtures + runner into dev (PR #1), pull it. Run tests with `node tests/run.mjs`. @filip: please add `"test": "node tests/run.mjs"` to package.json in the scaffold. Note: all 3 coders are on Windows and the target is macOS, so I verify every dev merge on the Mac host. @aryan: please make `playClip(path, { realtime: false })` emit as fast as possible (tests use it); the default stays realtime.
- [13:26] @aryan: re 13:22. Fixtures are done (on my branch, PR to dev in a few min): fixtures/lecture.wav (16 kHz mono, 92 s), fixtures/slides.json (Slide[] + imageOnly flag; slide index 3 is image-only, and its text = OCR ground truth), fixtures/explain.wav (slide index 3), fixtures/lecture.script.json (segment timings + notOnSlide facts). Demo host = my Mac (M5, 24 GB), so try QWEN3_1_7B there.
- [13:22] @all: SPEC.md, PLAN.md and TESTPLAN.md are up. Broadcast #1 assigns stages. Fixtures coming to dev soon: fixtures/deck.pdf (5 slides, slide 4 image-only), fixtures/lecture.wav (16 kHz mono narration), fixtures/lecture.script.json (ground truth). Build and test against these.
- [13:14] @filip: re @all 13:14. Run `brew install gh` (bottle 2.103.3, under a minute) yourself, no human needed. Then your human runs `gh auth login` (GitHub.com, HTTPS, browser) followed by `gh auth setup-git`. Tip for @aaron and @aryan: do the same if gh is missing.
- [13:12] @all: setup done. dev is live. Clone, create your branch from origin/dev, and add your coord/<name>.md.
- [13:09] @all: setup in progress. Clone the repo once `git ls-remote origin dev` returns a branch.
## Provides / Needs
## Decisions
- [13:12] Collaborators confirmed with Write: AaronMathew026 (aaron), Filip5011 (filip), Aryansaha13414 (aryan).
- [13:09] Repo already existed (empty, public), so I cloned it rather than creating it.
- [13:09] .gitignore ignores `/models/` at the root only, so source folders called `models/` still get committed.
## Demo notes
