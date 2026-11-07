# PROTOCOL (summary of CLAUDE.md; CLAUDE.md wins if they differ)

## ROLE CHANGE 15:51 (HUMAN DECISION, david): ORCHESTRATOR = @aryan, TESTING = @david
- **aryan (orchestrator/master, plus his AI area):** owns PLAN.md, PROTOCOL.md, BROADCAST.md and stage/task assignments and priorities; may broadcast; coordinates the team and talks to the humans for coordination; runs the dev→main release (PR, `--merge`, tag `demo-v1`) ONLY when a human says ship AND david has signed off on the suite + smoke checklist.
- **david (tester):** owns tests/, fixtures/, the test runner, TESTPLAN.md (incl. the demo smoke checklist) and BUGS.md (logging with repro + suggested owner, verifying fixes, dev health). Runs everything on the Mac demo host. david no longer assigns work: bugs get a suggested owner, and @aryan confirms or reassigns.
- CLAUDE.md is unchanged (frozen after setup); this section overrides its role list.


**Team:** david = TESTER/MASTER · aaron, filip, aryan = CODERS. Repo: SnakeLuck360GT/lecture.

**Authority:** humans > master (david) > each coder's own plan.

**Branches:** `<name>` --PR--> `dev` --PR (human says ship AND master signs off)--> `main`.
- Never push directly to dev or main (the only exception is `coord/` on main, written through COMMS). Never force-push. Never touch another member's branch. Never edit CLAUDE.md or `.claude/`.
- Merge PRs with `gh pr merge --merge` (no squash or rebase, don't delete branches). Then post `@all merged <x> into dev, pull it`.
- Before each PR: `git fetch origin && git merge origin/dev`, then build, lint and `tests` must pass (or the failures are already in BUGS.md).

**COMMS** = `../<folder>-comms`, a worktree of main. Read and write `coord/` only there.
- Read: `git -C <COMMS> pull --rebase -q origin main`, then read every coord file.
- Write: pull first, edit ONLY your own `<name>.md` or the files your role owns, then `git add coord && git commit -m "coord(<name>): ..." && git push origin main`.
- Check: at the start of each task, before and after each PR, when a subagent finishes, before asking a human, and at least every ~10 minutes.
- Message format: `- [HH:MM] @target: text`. Reply with `re @x HH:MM`.

**Files:** SPEC, PLAN, BUGS, TESTPLAN, PROTOCOL and BROADCAST belong to david. `<name>.md` belongs to its member. `contracts/stage-<N>.md` belongs to that stage's coder.

**BROADCAST:** a hook blocks every tool call while `BROADCAST.md` id > `.claude/broadcast_ack`. On receipt: stop your subagents, `echo <id> > .claude/broadcast_ack`, post `ack #<id>`, then follow it. Subagents never ack. They return `HALTED by broadcast #<id>`. Idle coders run a background watcher that fetches every 20s and exits when BROADCAST, BUGS or PLAN changes.

**Coders:** stay inside your stage's area (small, announced additive edits to shared files are OK). Publish `contracts/stage-<N>.md` within ~15 minutes of PLAN. Build against stubs for stages that aren't ready. Never invent SDK names. Assigned bugs come before features (P0 > P1 > P2): post `ack B-xxx, ETA HH:MM`, then `@david fixed B-xxx in dev` when done. Only david closes bugs.

**Commits:** small and often, pushed straight away. `s<N>: ...` (coders), `test: ...` (master), `wip:` prefix for work in progress. Never more than ~20 minutes uncommitted. No secrets (use `.env` and `.env.example`) and no model weights.

**Humans:** only for credentials, accounts, GitHub permissions, demo-changing product decisions, anything destructive, physical tasks, or (master) stuck P0s. Use the `🚨 NEED HUMAN (<name>):` format.

**Priorities:** a working demo > completeness > pretty code. Follow the spec's build order. Mock rather than stall. dev must always run.
