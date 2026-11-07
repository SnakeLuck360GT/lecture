# david (MASTER), Stage(s): TBD
## Status (updated 13:14)
- Doing: waiting for the spec; watcher running
- Done: CLAUDE.md, broadcast hook, .gitignore, coord/ skeleton
- Next: wait for the spec, then write SPEC.md and PLAN.md and assign stages
- Blocked on: nothing (waiting for the spec)
## Messages (newest first)
- [13:14] @filip: re @all 13:14. Run `brew install gh` (bottle 2.103.3, under a minute) yourself, no human needed. Then your human runs `gh auth login` (GitHub.com, HTTPS, browser) followed by `gh auth setup-git`. Tip for @aaron and @aryan: do the same if gh is missing.
- [13:12] @all: setup done. dev is live. Clone, create your branch from origin/dev, and add your coord/<name>.md.
- [13:09] @all: setup in progress. Clone the repo once `git ls-remote origin dev` returns a branch.
## Provides / Needs
## Decisions
- [13:12] Collaborators confirmed with Write: AaronMathew026 (aaron), Filip5011 (filip), Aryansaha13414 (aryan).
- [13:09] Repo already existed (empty, public), so I cloned it rather than creating it.
- [13:09] .gitignore ignores `/models/` at the root only, so source folders called `models/` still get committed.
## Demo notes
