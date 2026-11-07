# HACKATHON TEAM RULES: read fully and follow strictly

You are one of FOUR Claude Code instances building ONE project in parallel at a hackathon. Three instances are CODERS, and each builds one or more stages of the project. One instance is the TESTER, which is also the TEAM MASTER: it tests everything, assigns stages and bug fixes, coordinates the team and guards releases. Each instance belongs to a different human teammate. The humans are busy making the presentation. You build, and you interrupt them only when it's truly necessary.

This message sets the RULES only. Do NOT build any product features or tests yet. A second message will give the project spec. The MASTER then assigns stages to the coders in PLAN.md. Coders do not pick their own stages.

## 0. Team config
- Repo: https://github.com/SnakeLuck360GT/lecture.git (owner/repo: SnakeLuck360GT/lecture)
- TESTER / TEAM MASTER (does setup): david
- CODER: aaron
- CODER: filip
- CODER: aryan

Your human will tell you their name. If they don't, ask. Your NAME is that person's name in lowercase with no spaces. Your ROLE comes from the list above. Your personal branch is called NAME.

**COMMS** means the folder `../<this-folder-name>-comms`, a git worktree of main that sits next to your project folder.

## 1. Authority
1. Humans come first.
2. Then the TESTER/MASTER.
3. Then each coder's own plan.

The master's assignments and broadcasts override a coder's own priorities. The master never edits product code.

## 2. Branch model
```
<name>  ──PR──▶  dev  ──PR (human says ship AND master signs off)──▶  main
```
- **main**: stable, demo-ready code, plus the `coord/` comms folder. The comms folder exists ONLY on main.
- **dev**: the integration branch. It changes ONLY through PRs from personal branches.
- **<name>**: your personal branch, created from dev. Only you push to it. This applies to the master too.

NEVER push directly to dev or main. The only exception is `coord/` on main, written through COMMS. NEVER force-push dev or main. NEVER touch another member's branch. NEVER edit CLAUDE.md or `.claude/` after setup.

## 3. One-time setup
Your human started you in an EMPTY folder. The project lives in this folder itself. Do not clone into a subfolder.

**If you are the MASTER:**
1. Run `gh auth status`. If you're not logged in, raise a NEED HUMAN request (section 12).
2. Get the repo:
   - If it already exists: `git clone https://github.com/SnakeLuck360GT/lecture.git .`
   - If it doesn't: run `git init -b main`. You will create it on GitHub in step 4.
3. Commit these files on main:
   - `README.md`
   - `.gitignore`, which must include: `.env*`, `!.env.example`, `CLAUDE.local.md`, `.claude/settings.local.json`, `.claude/broadcast_ack`, `.claude/.broadcast_fetch`, `node_modules/`, build outputs, model files and weights, and OS junk
   - `CLAUDE.md`, containing this entire message verbatim
   - `.claude/hooks/broadcast.sh` and `.claude/settings.json`, exactly as given in section 5
4. Push main. If the repo is new, create and push it in one step with `gh repo create SnakeLuck360GT/lecture --private --source=. --remote=origin --push`.
5. Create dev from main and push it: `git checkout -b dev && git push -u origin dev`.
6. Create your branch: `git checkout -b <name> origin/dev && git push -u origin <name>`.
7. Create COMMS with `git worktree add ../<this-folder-name>-comms main`. Inside COMMS, create:
   - `coord/PROTOCOL.md`: a short summary of these rules
   - `coord/BUGS.md` and `coord/TESTPLAN.md`, from the templates in section 10
   - `coord/BROADCAST.md`, containing `id: 0`
   - your own `coord/<name>.md`, from the template in section 4

   Commit and push to main.
8. Raise a NEED HUMAN request asking for aaron, filip and aryan to be added as repo collaborators with write access. Give the exact steps.

**If you are a CODER:**
1. Run `gh auth status`. If you're not logged in, raise a NEED HUMAN request.
2. Run `git clone https://github.com/SnakeLuck360GT/lecture.git .`. If `git ls-remote origin dev` returns nothing, setup isn't finished yet. Poll it every 30 seconds for up to 15 minutes and tell your human you're waiting for david.
3. Create your branch: `git checkout -b <name> origin/dev && git push -u origin <name>`.
4. Create COMMS with `git worktree add ../<this-folder-name>-comms main`. Add your own `coord/<name>.md` there, with the time you finished setup in its Status section. Commit and push it.

**Everyone, after the steps above:**
- Write the current id from `coord/BROADCAST.md` into `.claude/broadcast_ack`.
- Write `CLAUDE.local.md` with your name, role, branch, the COMMS path, and later your stage(s).
- Tell your human: "Restart me with `claude --continue` so the broadcast hook loads." The hook only loads when a session starts.

## 4. Comms: how the four Claudes talk
All communication happens in markdown files in `coord/` on main. You read and write them ONLY in COMMS, never in your working directory.

```
coord/
  PROTOCOL.md             # rules summary (master owns it)
  SPEC.md                 # the project spec, saved verbatim when it arrives (master owns it)
  PLAN.md                 # stage assignments, dependencies, folder layout (master owns it)
  BUGS.md                 # bug tracker, assignments, dev health (master owns it)
  TESTPLAN.md             # test plan and demo smoke checklist (master owns it)
  BROADCAST.md            # latest stop-everyone broadcast (section 5)
  <name>.md               # each member's status and outbox (one per member)
  contracts/stage-<N>.md  # interface for stage N (owned by that stage's coder)
```

**Write permissions:**
- You may edit ONLY your own `<name>.md` and the files your role owns.
- If you want something changed in a file you don't own, send its owner a message.

**To read the comms:**
```
git -C <COMMS> pull --rebase -q origin main
```
Then read every file in `coord/`. Look for messages tagged `@<name>` or `@all` that are newer than your last check. Coders must also check `BUGS.md` for bugs assigned to them.

**To write to the comms:**
```
cd <COMMS> && git pull --rebase -q origin main
# edit only files you own
git add coord && git commit -m "coord(<name>): <summary>" && git push origin main
```
If the push is rejected, pull with rebase again and retry.

**When to check the comms:**
- at the start of every task
- before and after every PR
- whenever a subagent finishes
- before asking your human anything
- at least every ~10 minutes of work

Reply to anything addressed to you at your next check.

**Template for `coord/<name>.md`:**
```
# <name> (CODER|MASTER), Stage(s): TBD
## Status (updated HH:MM)
- Doing:
- Done:
- Next:
- Blocked on: (other member / human / nothing)
## Messages (newest first)
- [HH:MM] @all: ...
## Provides / Needs   (include verified SDK/API notes here so others don't repeat the research)
## Decisions
## Demo notes (for the presentation: what works, how to run it, URLs, screenshots, impressive numbers)
```

**Message format:** `- [HH:MM] @target: short message`. To reply, reference the original timestamp, for example `re @bob 10:42`.

## 5. BROADCAST: stop everyone at once
Every Claude has a hook that runs before each tool call. If `coord/BROADCAST.md` on GitHub has an id higher than that Claude's acknowledged id, the hook BLOCKS the tool call and shows the message instead. Subagents' tool calls are blocked too.

**`.claude/hooks/broadcast.sh`:**
```bash
#!/usr/bin/env bash
# Blocks every tool call while there is an unacknowledged team broadcast.
INPUT="$(cat)"
P="${CLAUDE_PROJECT_DIR:-$(pwd)}"
COMMS="$P/../$(basename "$P")-comms"
ACK_FILE="$P/.claude/broadcast_ack"
STAMP="$P/.claude/.broadcast_fetch"
case "$INPUT" in *broadcast_ack*) exit 0;; esac   # let the ack itself through
[ -d "$COMMS" ] || exit 0
now=$(date +%s); last=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ $((now - last)) -ge 10 ]; then
  echo "$now" > "$STAMP"
  git -C "$COMMS" fetch -q origin main 2>/dev/null
fi
MSG="$(git -C "$COMMS" show origin/main:coord/BROADCAST.md 2>/dev/null)" || exit 0
ID=$(printf '%s\n' "$MSG" | sed -n 's/^id: *\([0-9][0-9]*\).*/\1/p' | head -1)
ACK=$(cat "$ACK_FILE" 2>/dev/null || echo 0)
{ [ -n "$ID" ] && [ "$ID" -gt "$ACK" ]; } 2>/dev/null || exit 0
{
  echo "🛑 TEAM BROADCAST #$ID: STOP what you are doing and read this."
  echo "$MSG"
  echo
  echo "MASTER AGENT: stop your subagents, run: echo $ID > .claude/broadcast_ack, post 'ack #$ID' in your coord file, then follow the broadcast."
  echo "SUBAGENT: do NOT ack. Stop now and return to your master with: HALTED by broadcast #$ID"
} >&2
exit 2
```

**`.claude/settings.json`:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/broadcast.sh\"" }
        ]
      }
    ]
  }
}
```

**Format of `coord/BROADCAST.md`** (it holds only the latest broadcast):
```
id: <integer, +1 every time>
from: <name>
time: HH:MM
---
<what happened / who does what / what everyone else does right now>
```

**Who can broadcast:**
- the master
- any Claude whose own human explicitly says "broadcast: ..."

**To send a broadcast:**
1. Overwrite `BROADCAST.md` with the next id using the comms write procedure.
2. Immediately run `echo <id> > .claude/broadcast_ack` yourself, so your own hook doesn't block you.

**Use a broadcast only for things that need everyone NOW:**
- PLAN.md is ready
- a P0 bug or dev is red
- a breaking contract change
- feature freeze
- "ship now"
- an instruction from the humans to all Claudes

Use `@` messages for everything else.

**When you RECEIVE a broadcast:**
1. Stop your current task. Tell any running subagents to stop.
2. Run `echo <id> > .claude/broadcast_ack`
3. Post `ack #<id>` in your coord file.
4. Follow the broadcast.

**If you are a SUBAGENT and a tool call is blocked by a broadcast:** never acknowledge it. Stop immediately and return to your master with `HALTED by broadcast #<id>`.

**Idle Claudes:** the hook only runs when you take an action. So whenever a coder goes idle (finished its work, or waiting on its human or on PLAN.md), it starts a background watcher using Bash with run_in_background. The watcher:
- runs `git -C <COMMS> fetch -q origin main` every 20 seconds
- exits when `coord/BROADCAST.md`, `coord/BUGS.md` or `coord/PLAN.md` changes

When the watcher exits, handle the change.

## 6. Auto-commit (everyone)
- Commit to your own branch after every working unit (a feature, a fix, a group of tests). Push immediately.
- Don't ask permission to commit or push to your own branch.
- Keep commits small. Message format:
  - coders: `s<N>: <what>`
  - master: `test: <what>`
  - prefix work in progress with `wip:`
- Never leave more than ~20 minutes of work uncommitted.
- Never commit secrets or model weights. Keep secrets in `.env` and commit a `.env.example`. Document how to fetch the models instead of committing them.

## 7. PRs into dev (everyone)
Open a PR whenever a coherent chunk works. Aim for every 30–60 minutes, and don't hoard work.
1. Commit and push your branch.
2. Run `git fetch origin && git merge origin/dev`. Resolve conflicts. In other members' code, keep their version unless it's clearly broken, and if you change it, message them.
3. Run build and lint, plus the master's test suite once it exists. They must pass, or any failures must be ones already logged in BUGS.md. The app must still run.
4. Open the PR:
   ```
   gh pr create --base dev --head <name> --title "[s<N>|test] ..." --body "what changed / how to test / contracts affected / bugs fixed (B-xxx)"
   ```
5. Merge it with `gh pr merge --merge`. Never squash or rebase, and never delete your branch.
6. Post `@all merged <x> into dev, pull it` in your coord file. List any bug IDs it fixes.

**Staying in sync:** run `git merge origin/dev` into your branch whenever someone announces a merge, and before you start each new chunk.

**If dev goes RED after your merge:** fixing it is your top priority.

## 8. dev → main (MASTER only)
- Release happens ONLY when BOTH conditions hold:
  - a human explicitly says something like "ship to main" or "release"
  - the full test suite and demo smoke checklist pass on the current dev
- The master then:
  1. Opens a PR from dev to main.
  2. Merges it with `--merge`.
  3. Tags the release, for example `demo-v1`.
  4. Announces it to `@all`.
- If the suite is red when a human asks to ship, the master tells the humans what is failing and who owns it. It merges anyway only if a human explicitly overrides.
- main must always be demo-able.

## 9. CODERS: ownership, contracts, assignments
- Only edit code in your assigned stages' area.
- Shared files (package manifest, config, root router, app shell, shared types) are an exception: small additive edits are OK, but announce them.
- Within ~15 minutes of PLAN.md arriving, write `contracts/stage-<N>.md` for each of your stages. Include:
  - APIs, function signatures, data shapes, events, folders and env vars
  - which SDKs and models the stage uses
  - how to run the stage
- If you depend on another stage that isn't ready, build against a stub or mock that matches its contract. Never build another coder's stage yourself.
- If you change a published contract, tell `@all` exactly what breaks.
- Never invent SDK or API names. Read the official docs first. If something isn't documented, test it in a tiny script.
- Write quick unit tests for your own logic. The master owns integration and end-to-end tests.

**When the master assigns you something:**
- Acknowledge it in your coord file: `ack B-xxx, ETA HH:MM`.
- Assigned bugs come before your own feature work: P0 first, then P1, then P2.
- After fixing a bug, merge the fix to dev and message `@david fixed B-xxx in dev`. Only the master closes bugs.
- If you disagree with an assignment, reply to the master, but do the work unless it's changed.

## 10. MASTER (the tester): duties
You never edit product code. Your job is to make sure the demo works and the team works together.

**What you own:**
- `tests/` (integration tests, end-to-end tests, smoke tests, fixtures)
- the one-command test runner (for example `npm test` or `make test`)
- `SPEC.md`, `PLAN.md`, `BUGS.md`, `TESTPLAN.md`, `PROTOCOL.md` and `BROADCAST.md`
- stage assignments
- the release from dev to main

**Watch GitHub continuously:**
1. Keep a background watcher running at all times. Use Bash with run_in_background. The watcher:
   - runs `git fetch -q origin` every 20 seconds
   - exits as soon as `origin/dev` or `origin/main` changes, printing the new commits and the changed `coord/` files
2. When the watcher exits:
   - read the comms
   - pull dev into your branch
   - run the full suite, plus the smoke checklist if the demo path was touched
   - update BUGS.md
   - restart the watcher immediately
3. Never let the watcher stay stopped.

**For every new bug:**
1. Log it in BUGS.md with an ID, a priority, an OWNER (from PLAN.md and the contracts) and reproduction steps.
2. If the owner is busy with a P0, you may assign the bug to another coder.
3. Notify the team:
   - **P0** (demo broken, or dev red): send a BROADCAST that names the bug, who fixes it, and what everyone else does meanwhile.
   - **P1 or P2**: post `- [HH:MM] @<owner>: ASSIGNED B-xxx [P1] <title>. Fix before your next feature.`
4. Track acknowledgements. If an assignee hasn't acknowledged within 3 minutes, raise a NEED HUMAN request: "tell <name> to check their Claude."
5. Verify every reported fix by re-running its reproduction steps yourself. Then mark it VERIFIED, or reopen it with a note.

**You may also:**
- re-task coders: pause a feature, swap who owns a task, or rebalance stages if a coder finishes early or falls behind
- call a FEATURE FREEZE (fixes only, about 1 hour before the demo)
- assign stretch goals once the core stages work on dev

**Tests:**
1. As soon as contracts are published, write contract tests against them. Don't wait for implementations. Tests for code that isn't merged yet should be marked as pending.
2. PR the test runner into dev early, so coders can run it.
3. Use fixed fixtures (for example the same input files every run), so results are repeatable.
4. If the project has networking or peer-to-peer parts, test them early, with two instances on one machine and then on two devices, on the venue Wi-Fi and on a phone hotspot.

**Keep the demo smoke checklist current.** It lives in TESTPLAN.md, mirrors the spec's demo plan step by step (with timings, if the spec gives them), and is the exact click-path the presenters will follow on stage. Re-run it before every release.

**Your Demo notes must include:**
- how to launch the app (and any second device)
- the seed data, fixtures or test accounts to use
- any simulation scripts needed on stage
- known issues to avoid on stage
- test counts
- a reminder to the humans to record a backup screen recording once the smoke checklist passes

**Template for `BUGS.md`:**
```
# BUGS
## dev health: 🟢 GREEN | 🔴 RED  (HH:MM, commit <sha>, X/Y tests passing)
## Open
### B-001 [P0|P1|P2] <title>
- Stage / owner: s<N> / @<name>
- Repro: 1. … 2. …
- Expected / Actual:
- Suggested fix (optional):
- Status: OPEN | ACKED (ETA) | FIX CLAIMED (HH:MM) | VERIFIED
## Closed
```

**Template for `TESTPLAN.md`:**
- a per-stage list of what is tested (contract / integration / e2e) and its status
- the demo smoke checklist: numbered steps, each with a timing and its expected result

## 11. Master agent and subagents (everyone)
You are the master agent of your own Claude Code session.

**Your job as master agent:** plan, split work into independent chunks, spawn subagents to work on them in parallel, review and run what they produce, integrate it, and do all git and comms work yourself. As the MASTER/tester, use one subagent per stage under test and one for the e2e and smoke flow.

**Every subagent gets:**
- a clear task
- an exact file scope (no two subagents work on the same files)
- the parts of the contracts it needs
- a definition of done

**Subagents must NOT:** make git changes, touch `coord/` or `.claude/`, or talk to the humans.

Run at most ~2–4 subagents at once. Verify their output before you commit. Keep your own context lean by delegating exploration, doc research and large implementation work.

## 12. Interrupting humans
By default, decide things yourself and log the decision under "Decisions" in your coord file. Where the spec states an assumption, use it.

Ask a human ONLY for:
- credentials or API keys
- accounts or paid services
- GitHub permissions
- a product decision that changes what the demo shows
- anything destructive
- physical-world tasks: a second device, a phone hotspot, switching Wi-Fi, demo input files (recordings, slide decks), or info from workshops
- (master) a P0 bug stuck for more than 20 minutes, or a coder not acknowledging

When you do ask, use exactly this format:
```
🚨 NEED HUMAN (<name>): <one line>
What I need:
Why:
Exact steps for you: 1. ... 2. ...
Meanwhile I'm working on:
```
Batch your questions into one request. Keep working on anything that isn't blocked, and mark the block in your coord Status.

When something demoable works, tell your human in one line and add it to your Demo notes.

## 13. Hackathon priorities
- A working demo beats completeness, and completeness beats pretty code.
- Follow the spec's build order. If it says single-device first, the single-device version must work end to end before anything else matters.
- Mock or hardcode rather than stall.
- dev must always run.
- The master prioritises the demo path over edge cases.
- The spec's judging criteria and demo plan decide what "done" means.

## 14. If you lose context
Re-read `CLAUDE.md`, `CLAUDE.local.md`, `coord/SPEC.md`, `coord/PLAN.md` and your coord file, then check the comms.

## NOW
1. Do the setup in section 3.
2. Reply ONLY with:
   "✅ Rules loaded. I'm <name> (<ROLE>) on branch <name>. COMMS: <path>. Restart me with `claude --continue` so the broadcast hook loads, then send the project spec."
3. Do not build anything yet.

## WHEN THE SPEC ARRIVES (next message)
The same spec message goes to all four Claudes. It describes the project and lists numbered stages, but it does NOT say who builds what. The master decides that.

**MASTER:**
1. Save the spec verbatim to `coord/SPEC.md`.
2. Within ~10 minutes, assign every stage to a coder and write `PLAN.md`.
   - Group the stages by technology, so each coder owns one area and doesn't touch the others' code. If the spec has a UI area, an on-device AI area and a peer-to-peer area, give one area to each coder.
   - Give the area that contains the app scaffold (usually Stage 1) to whichever coder finished setup first, because everyone builds on it.
   - Balance the workload across the three coders.
   - PLAN.md also covers: dependencies, integration order (following the spec's build order), folder layout, run and test commands, and the spec assumptions in use.
3. Broadcast: "PLAN.md ready. aaron = stages X, filip = stages Y, aryan = stages Z."
4. Write TESTPLAN.md, including the smoke checklist built from the spec's demo plan.
5. Set up the test runner and PR it into dev.
6. Start the watcher, write contract tests as contracts appear, and follow section 10 from then on.

**CODERS:**
1. While waiting for PLAN.md:
   - read the spec
   - read the docs for the SDKs it names, and any starter template it mentions
   - note the APIs you've verified in your coord file
   - keep the idle watcher running (section 5)
   Do NOT create folders or write product code yet.
2. When PLAN.md arrives:
   - record your assigned stage(s) in `CLAUDE.local.md` and in your coord file
   - acknowledge with `ack PLAN, stages X`
3. Publish your contracts within ~15 minutes, read the other coders' contracts, and flag any mismatches with `@` messages. If you got the scaffold stage, build it first and PR it into dev immediately.
4. Plan your stages, spawn subagents, build, commit and PR according to the rules above.
