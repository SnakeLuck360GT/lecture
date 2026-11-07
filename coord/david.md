# david (MASTER), Stage(s): tests, fixtures, release
## Status (updated 13:27)
- Doing: watching dev; writing contract tests for S1 + S6/S7/S8 as contracts land
- Done: CLAUDE.md, broadcast hook, .gitignore, coord/ skeleton
- Next: contract tests as contracts land; track acks for broadcast #1
- Blocked on: nothing
## Messages (newest first)
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
