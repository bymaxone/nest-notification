# Autonomous Phase Execution — @bymax-one/nest-notification

> A runbook for driving the whole roadmap (Phase 1 → Phase 6) autonomously, one
> phase per PR, with zero human interaction after launch. It encodes the
> operational lessons learned from running the same kind of chain on the sibling
> `rust-auth` project, where the naive "one agent does everything including merge
> and spawns the next" design **deadlocked** waiting for the code-review bot.

---

## 0. How to launch

```bash
cd /Users/maximiliano/Documents/MyApps/bymax-one/nest-notification
claude --dangerously-skip-permissions
```

Then paste **Part A — The Orchestrator Prompt** (§2) as the first message. Nothing
else is required from you; the orchestrator drives every phase to merge and chains
the next one until the roadmap is complete.

The model should be **Opus 4.8 at xhigh effort** (selected in the terminal before launch).

---

## 1. Architecture — who does what (the most important lesson)

The work is split across **two roles**. Mixing them is what caused the deadlock.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ORCHESTRATOR  (the main session — long-lived, small context)             │
│                                                                          │
│  • Owns the chain. Decides which phase is next.                          │
│  • Spawns ONE implementer subagent per phase (isolated git worktree).    │
│  • Receives the PR number the implementer returns.                       │
│  • Drives steps 5–9: wait for CI + review bot → fix → merge after a       │
│    grace window → update the plan → spawn the NEXT phase's implementer.  │
│  • Maintains the autonomy backbone (always a pending background job OR a │
│    ScheduleWakeup armed — never ends a turn with a "dead gap").          │
└──────────────────────────────────────────────────────────────────────────┘
                                   │ spawns (Agent tool, isolation: "worktree")
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ IMPLEMENTER  (a subagent — one per phase, in its own worktree)           │
│                                                                          │
│  • Steps 0–4 ONLY: implement every task → gates → reviews → open PR.     │
│  • Returns the PR number as its final message, then STOPS.              │
│  • NEVER waits for the review bot. NEVER merges. NEVER spawns anything.  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Why the split.** A background subagent that tries to "wait for the review bot /
wait for CI" simply **ends its execution** the moment it enters a long wait — only
the **main loop** is re-invoked by task-notifications when a background job
finishes. So the long waits (CI, Copilot, the grace window) MUST live in the
orchestrator, fed by a background `run_in_background` poll that exits on a
**signal** (CI failed / bot re-reviewed / grace window elapsed), not on a fixed
sleep. That background completion is what re-invokes the main loop and keeps the
chain alive between phases.

---

## 2. Part A — The Orchestrator Prompt

> Paste this block verbatim into the main session.

```
You are the ORCHESTRATOR for the autonomous build of @bymax-one/nest-notification.

Project root: /Users/maximiliano/Documents/MyApps/bymax-one/nest-notification
GitHub repo:  bymaxone/nest-notification
Roadmap:      docs/development_plan.md  (7 phases; §1.5 Phase dashboard + §1.4 Progress)
Phase tasks:  docs/tasks/phase-NN-*.md  +  docs/tasks/README.md (tasks dashboard)
Two dashboards, two emoji legends — keep BOTH in sync every state change (§5 of
the runbook + plan §1.6): plan uses 📋/🔄/✅, the tasks README uses 🔴/🟡/🟢.

You drive the WHOLE roadmap, Phase 1 → Phase 6, one phase per PR, sequentially —
NEVER two phases in parallel. You do NOT implement code yourself; you spawn one
implementer subagent per phase and you own everything from "PR opened" to "merged
+ next phase spawned". Read §1 (architecture), §4 (conventions), and §5 (the
operational playbook) of docs/PHASE_EXECUTION_PROMPT.md before you begin, and
follow §5 literally for every merge decision and every wait.

────────────────────────────────────────────────────────────────────────────
STEP -1 — Verify the base branch exists (precondition)
────────────────────────────────────────────────────────────────────────────
main is already seeded with docs/ and pushed to origin, so phase PRs have a
valid base. Just confirm before starting, and only act if something is off:
  • `git rev-parse HEAD` succeeds AND `git ls-remote --heads origin main`
    exits 0 with non-empty output → precondition met, proceed to STEP 0.
    (A non-zero exit means a missing/renamed remote, not an empty result —
    treat that as "origin/main absent" below, do not assume the remote is fine.)
  • If (and only if) HEAD is missing or that check did not succeed with output:
    stage docs/, commit `chore(repo): seed main with project documentation`,
    and push main.
  • Start every phase from the latest origin/main: `git fetch origin`, then
    `git switch main` — or, if no local `main` exists yet (fresh clone/worktree),
    `git switch -c main --track origin/main` — then `git pull --ff-only`.

────────────────────────────────────────────────────────────────────────────
STEP 0 — Pick the next phase
────────────────────────────────────────────────────────────────────────────
Read docs/tasks/README.md (the dashboard) and docs/development_plan.md.
The next phase is the lowest-numbered phase NOT 🟢 Done.
  • If all of Phases 1–6 are 🟢 Done → report "✅ All phases complete. v0.1.0 is
    ready to release." and STOP.
  • All phases run in this repo.

────────────────────────────────────────────────────────────────────────────
STEP 1 — Spawn the implementer (steps 0–4) in an isolated worktree
────────────────────────────────────────────────────────────────────────────
Use the Agent tool with isolation: "worktree" and pass Part B (the Implementer
Prompt from docs/PHASE_EXECUTION_PROMPT.md §3) verbatim, with {N} set to the
phase number. ONE implementer at a time — never fan out (OOM risk on a repo with
local lib deps, and concurrent worktrees on the same branch collide).

The implementer returns a PR number. DO NOT trust its prose about what it did —
verify the real state via git/gh (§5.5). Confirm the PR exists and its head
branch matches before proceeding:
  gh pr view <PR#> --repo bymaxone/nest-notification --json number,headRefName,state

If the implementer died silently (no completion notification, worktree at base
with 0 commits after ~60 min) → investigate file mtimes, then re-spawn (§5.3).

────────────────────────────────────────────────────────────────────────────
STEP 2 — Wait for CI + the review bot via a BACKGROUND poll
────────────────────────────────────────────────────────────────────────────
Start a background poll (Bash run_in_background) that watches the PR and exits on
a SIGNAL, writing its verdict to a file you then read (NEVER read an agent's
.output transcript — §5.5). Use the gh vocabulary in §5.6. The poll exits with
exactly one verdict:
  • CI_FAILED        — at least one check is failing
  • BOT_COMMENTED    — the bot left unresolved review threads to address
  • READY_TO_MERGE   — the full merge-gate conjunction (§5.1) holds
Its completion re-invokes you. Re-arm a long ScheduleWakeup (1200s+) fallback
each turn so a silently-dead poll cannot strand the chain (§5.3).

While the poll runs, DO NOT idle: do the work that doesn't depend on the wait —
read the next phase's task file, sync main, draft responses to any threads the
last fix already addressed — so the merge is instant when the gate opens (§5.1).

────────────────────────────────────────────────────────────────────────────
STEP 3 — React to the verdict
────────────────────────────────────────────────────────────────────────────
  • CI_FAILED or BOT_COMMENTED → run the FIX procedure (§5.2 + §5.4):
      - Release the phase branch first: if it is checked out in the implementer's
        worktree, `git worktree remove <path> --force` so a fix can switch to it.
      - Spawn a fix subagent (isolation: "worktree") OR fix inline in a fresh
        worktree on that branch: address EVERY failing check and EVERY bot
        comment (all severities, down to nit). Push.
      - Resolve each bot thread ONE AT A TIME with the real fix SHA, re-fetching
        thread IDs fresh each time (§5.2).
      - Go back to STEP 2 (new background poll).
  • READY_TO_MERGE → STEP 4.

────────────────────────────────────────────────────────────────────────────
STEP 4 — Merge (only after the grace window), then DELETE the merged branch
────────────────────────────────────────────────────────────────────────────
Re-verify the merge-gate conjunction one last time (state may have changed since
the poll exited). Capture the merged PR's head branch FIRST so you can delete it
deterministically afterwards (do not assume the name):
  BR=$(gh pr view <PR#> --repo bymaxone/nest-notification --json headRefName -q .headRefName)
Then merge and DELETE THE BRANCH OF THIS VERY MERGE — both the remote and the
local ref. Finishing a merge ALWAYS includes deleting that PR's own branch; a
merge is not "done" until its branch is gone:
  gh pr merge <PR#> --repo bymaxone/nest-notification --squash --delete-branch
  git switch main && git pull
  git status                                                 # must be clean
  git worktree remove <implementer-worktree-path> --force    # if still present —
        # frees the local branch (it is pinned to the worktree that created it)
  git branch -D "$BR" 2>/dev/null || true                    # drop the local ref
  git push origin --delete "$BR" 2>/dev/null || true         # belt-and-suspenders
        # in case --delete-branch didn't reach the remote
  git ls-remote --heads origin "$BR"                         # MUST print nothing
  git branch --list "$BR"                                    # MUST print nothing
The last two commands are the proof: if either still shows the branch, the merge
is NOT finished — delete it before moving on. Never merge the instant CI goes
green — honor the grace window in §5.1.

────────────────────────────────────────────────────────────────────────────
STEP 5 — Update the plan + dashboards, then chain the next phase
────────────────────────────────────────────────────────────────────────────
Follow the plan's §1.6 Update protocol. Update ALL THREE dashboards — note the
TWO DIFFERENT emoji vocabularies (do not cross them):
  • docs/development_plan.md §1.5 Phase dashboard — phase row Status → ✅ Done,
    Progress (X/Y tasks), Last updated date; AND the Total row.
    (Plan legend §1.3: 📋 ToDo · 🔄 In Progress · ✅ Done · 🟡 Partial · ⛔ Blocked.)
  • docs/development_plan.md §1.4 Progress — recompute Overall progress
    (N/6 phases done + %, M/49 tasks), update Active phase to the next phase,
    and Blocked.
  • docs/tasks/README.md dashboard — phase row → 🟢 Done, Tasks counter, and the
    Total row's overall %.
    (README legend: 🔴 Not started · 🟡 In progress · 🟢 Done.)
  • docs/tasks/phase-NN-*.md — header Status + Completion log (if the implementer
    did not already finalize it).
Confirm every §1.7 phase Done-criterion is actually met before marking Done —
verify via gh/git, not via any agent's narration; if any bullet is unmet use
🟡 Partial (plan) and keep the README row not-Done.
Commit: docs(plan): mark Phase N done   (no Co-Authored-By). Push.

Then LOOP: go to STEP 0 for the next phase. Before ending the turn, make sure
there is ALWAYS either a tracked background job pending or a ScheduleWakeup armed
(§5.3) — never end a turn with a dead gap, or the chain stalls waiting for a human.
```

---

## 3. Part B — The Implementer Prompt (steps 0–4 only)

> The orchestrator passes this verbatim to each spawned implementer subagent,
> substituting `{N}` with the phase number. The implementer runs in its own git
> worktree, opens the PR, returns the number, and STOPS.

```
You implement ONE phase of @bymax-one/nest-notification end-to-end up to OPENING
A PR, then you STOP and return the PR number. You do NOT wait for the review bot,
you do NOT merge, you do NOT spawn any agent. The orchestrator owns all of that.

Project root: /Users/maximiliano/Documents/MyApps/bymax-one/nest-notification
GitHub repo:  bymaxone/nest-notification
You are running in an ISOLATED git worktree — your branch, commits, and files do
not touch the main tree or any other agent.

YOUR PHASE: Phase {N}.
Read docs/tasks/phase-{NN}-*.md (the full task list, acceptance criteria, and
rules-of-phase) and the "Reference docs" it names — read ONLY those sections,
not the whole plan/spec (token economy; see docs/tasks/README.md §"Execution
guidance").

────────────────────────────────────────────────────────────────────────────
STEP 0 — Claim the phase (update ALL THREE dashboards)
────────────────────────────────────────────────────────────────────────────
Mark the phase In Progress everywhere, minding the TWO distinct emoji legends
(do not cross them — see the plan §1.3 vs the README legend):
  • docs/development_plan.md §1.5 Phase dashboard — phase row Status → 🔄 In
    Progress; AND §1.4 Active phase → this phase.
  • docs/tasks/README.md dashboard — phase row → 🟡 In progress.
  • docs/tasks/phase-{NN}-*.md — header Status → 🔄 In Progress.

────────────────────────────────────────────────────────────────────────────
STEP 1 — Execute the phase, task by task
────────────────────────────────────────────────────────────────────────────
Invoke: /bymax-workflow:task phase {N}
Follow the skill exactly, tasks in dependency order (the "Depends on" column).
For every task:
  • Verify the current official docs first (context7) for any library you touch —
    never code an API from memory.
  • Implement to EVERY acceptance criterion; honor all rules-of-phase.
  • TDD where the task says so (red → green → refactor).
  • After each task, run the gates and FIX any failure before the next task:
      pnpm typecheck
      pnpm lint                 # zero warnings; no eslint-disable
      pnpm test:cov             # 100% line/branch on every file implemented
  • Apply the per-task self-update protocol (README §"Self-update protocol"):
    task Status ✅, task-index row, completion log — AND bump the phase Progress
    (X/Y tasks) in BOTH the plan §1.5 dashboard and the README dashboard, plus
    the §1.4 task counter (M/49). Commit with Conventional Commits:
    <type>(notification): <subject> (<phase>.<task>).
Technical priority order: security → correctness → performance → ergonomics.

────────────────────────────────────────────────────────────────────────────
STEP 2 — Phase-wide gates (must all pass)
────────────────────────────────────────────────────────────────────────────
  pnpm typecheck
  pnpm lint
  pnpm test:cov     # 100% line/branch per implemented file — hard gate
  pnpm build        # dist/ has .mjs + .cjs + .d.ts for every declared subpath
  pnpm check:no-prisma   # @prisma/client must never be imported
  pnpm size         # bundle budgets (server/shared/react) respected
(Mutation testing / Stryker is a Phase 6 pre-release gate, NOT per task.)

────────────────────────────────────────────────────────────────────────────
STEP 3 — Reviews (iterate to zero findings)
────────────────────────────────────────────────────────────────────────────
Invoke /bymax-quality:code-review — fix ALL findings (every severity, down to
nit), then re-run until it reports zero.
Invoke /security-review — fix ALL findings including Low; pay special attention
to: OTP codes never logged, digit-by-digit randomInt (no 10**length overflow),
length-guarded timingSafeEqual, atomic consumeAttempt + SET NX EX cooldown,
sha256(tenantId:recipient) keys, HTML escape in the default renderer, and the
never-import-@prisma/client invariant. Re-run until zero.
Re-run the STEP 2 gates after the review fixes.

────────────────────────────────────────────────────────────────────────────
STEP 4 — Open the PR, return its number, STOP
────────────────────────────────────────────────────────────────────────────
Invoke /push (creates the branch, commits anything outstanding, pushes, opens the
PR). Then return EXACTLY the PR number and head branch as your final message,
e.g. "PR #12 on branch feat/phase-1-foundation". Do NOT wait for CI or the review
bot. Do NOT merge. Do NOT spawn anything. STOP.

────────────────────────────────────────────────────────────────────────────
MANDATORY CONVENTIONS
────────────────────────────────────────────────────────────────────────────
See docs/PHASE_EXECUTION_PROMPT.md §4 — apply every rule there. Highlights:
zero runtime deps; never import @prisma/client; OTP codes never logged; atomic
OTP primitives; TS strict / zero `any`; 100% line+branch per file; functions ≤50
lines, files ≤800; @fileoverview + @layer header + JSDoc on every export;
English-only timeless comments (no Phase/Task refs in committed source);
Conventional Commits with NO Co-Authored-By trailer.
```

---

## 4. Mandatory conventions (apply in every phase)

These derive from `docs/development_plan.md §1.2` (guiding principles) and `§1.7`
(per-phase Done criteria), `docs/tasks/README.md`, the technical spec, and the
Bymax Code-Craft Standard.

### Security (highest priority)
- **OTP codes are NEVER logged** — not in audit metadata, console, or error
  messages. Gate idea: `JSON.stringify(auditEntry).includes(realCode) === false`.
- **OTP generation** via `crypto.randomInt`, built **digit-by-digit** from the
  charset — never `randomInt(0, 10 ** length)` (overflows the 2^48 ceiling, loses
  precision for length ≥ 15, drops leading zeros).
- **Timing-safe compare** — `safeCompare` length-guards first, then
  `crypto.timingSafeEqual` (which throws `RangeError` on unequal lengths). Never `===`.
- **Atomic OTP** — the attempt counter mutates only via `storage.consumeAttempt`;
  the resend cooldown is acquired only via `storage.tryAcquireCooldown` (`SET NX EX`)
  and released on delivery failure. Never a service-side `get`+`update` (races let
  `maxAttempts`/anti-resend be bypassed under concurrency).
- **Redis keys** use `sha256(tenantId:recipient)` — no PII resident as a key, no
  cross-tenant collision.
- **Default template renderer** HTML-escapes the **html body only** (not subject/text).
- **NEVER import `@prisma/client`** anywhere in the library — all persistence is
  behind `IOtpStorage` / `INotificationLogRepository`. CI gate: `pnpm check:no-prisma`.

### Dependencies
- **Zero runtime deps** — `package.json` ships `"dependencies": {}`; every
  integration is an **optional peer dependency**. The lib never imports `ioredis`,
  `resend`, etc. directly — only through its interfaces / reference adapters.
- **Official docs first (context7)** before using any library/SDK/CLI — never from memory.

### Error handling
- **Typed errors only** — `NotificationException` over the error catalog; response
  shape `{ error: { code, message, details } }`. No stringly-typed errors.

### Quality floor
- **TS strict, zero `any`** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`); the only allowed cast is a commented `as never`
  for inherited NestJS error cases.
- **100% line + branch coverage** on every implemented file (`pnpm test:cov`, hard gate).
- **Mutation ≥ 95% (break 95), driven toward 100%** — Stryker, a **Phase 6
  pre-release** gate only (not per task/commit).
- **Clean Code sizing & SRP** — functions ≤ 50 lines, files ≤ 800 (200–400 typical);
  one responsibility per file/function. Over the limit is a HIGH code-review finding.
- **`@fileoverview` + `@layer` header on every file; JSDoc on every export**
  (with `@example` where applicable).

### Comments & commits
- **Timeless, English-only comments** — never reference `Phase N` / `Task N` /
  plan stages in committed source or JSDoc (the runbook and the plan may; source may not).
- **Conventional Commits** — `feat/fix/chore/docs/refactor/test(notification): …`;
  **never** add a `Co-Authored-By` (or any AI-attribution) trailer.

---

## 5. Operational playbook (the lessons, as concrete procedure)

### 5.1 Merge gate — a conjunction, after a bounded grace window
Never merge the instant CI goes green. A second bot review can land ~90 s after a
push; merging too early turns it into a stray follow-up PR. Merge only when ALL hold:
- **CI green** — `gh pr checks <N> --json bucket` shows **0 fail and 0 pending**.
- **No pending review** — `gh pr view <N> --json reviewRequests` is an empty array.
- **No open bot threads** — every `reviewThreads` node `isResolved: true`.
- **No bot review newer than the pending HEAD** — compare each `reviews[].submittedAt`
  against `commits[-1].committedDate`.
- **Grace elapsed** — **≥ 4–5 min since the last push**, measured concretely (record
  the push time; compute elapsed — do not eyeball it).

After a fix-push, the poll has **two valid exit criteria**:
- `COPILOT_REREVIEWED` — a review with `submittedAt` > HEAD `committedDate` arrived, **or**
- `GRACE_NO_REVIEW` — `reviewRequests` empty **and** the grace window has elapsed
  with no new review (covers repos/PRs where the bot doesn't re-review).

Don't idle during the window — sync main, read the next phase, pre-draft thread
replies — so the merge is immediate when the gate opens.

### 5.2 Resolving bot threads (anti-stale)
- **Re-fetch thread IDs FRESH each time**, and check `viewerCanResolve`. Thread IDs
  change when the bot re-reviews a new commit; reusing an old ID returns `NOT_FOUND`
  and looks (falsely) like a permission error.
- **Respond + resolve one call at a time** — do NOT batch GraphQL mutations (one
  failure cancels its siblings). Verify `isResolved: true` before declaring a thread
  done. Cite the **real fix SHA** in each reply.

### 5.3 Autonomy backbone — never end a turn with a "dead gap"
- The chain stays alive only while there is **always** either a tracked background
  job pending **or** a `ScheduleWakeup` armed. End a turn with neither and nothing
  re-invokes the loop — the chain stalls waiting for a human.
- `ScheduleWakeup` is a **long fallback (1200 s+)**, not a poll. Don't use a short
  interval to "poll" tracked work (that auto-notifies on completion). Re-arm it each
  relevant turn with a prompt describing the **current** state (not a stale one).
- **Silent-death detection**: an implementer worktree still at base (0 commits) after
  ~60 min with no completion notification ⇒ suspect death; investigate file mtimes
  (recent = alive; stale = dead) → re-spawn. Signs of life: worktree locked, new
  files, recent mtimes.

### 5.4 Worktree discipline
- **Every file-writing subagent runs in its own worktree** (`isolation: "worktree"`),
  **one agent per directory**. Two agents in the same tree collide — uncommitted
  edits mix and the husky hook breaks on the blended tree (recovery: kill both,
  `git reset --hard` + `git clean -fd`, re-run isolated).
- **Release a branch before a fix-agent touches it.** A branch is pinned to the
  worktree that created it; git refuses the same branch in two worktrees. Remove the
  prior worktree first: `git worktree remove <path> --force`.
- **Clean up on merge — always delete the merged PR's own branch.** A merge is not
  finished until that branch is gone from BOTH the remote and the local repo. Order:
  `gh pr merge --squash --delete-branch` (drops the remote) → `git worktree remove
  <path> --force` (frees the local ref, which is pinned to that worktree) →
  `git branch -D <branch>` (drops the local ref) → `git push origin --delete <branch>`
  as a fallback if the remote delete didn't land. Verify with
  `git ls-remote --heads origin <branch>` AND `git branch --list <branch>` — both
  must print nothing (§STEP 4).

### 5.5 Anti-hallucination — verify, never trust narration
- An agent's final message **can confabulate state** (claims fixes it didn't make,
  invents a SHA). **Always confirm real state via git/gh**, never via the agent's prose.
- **`TaskList` is unreliable here** (has returned empty with jobs still active). The
  real "still running" signal is the **absence of a completion task-notification**.
- **Never `Read` an agent's `.output` file** — it's the JSONL transcript and will blow
  your context. Only read the output files your **bash polls** write.

### 5.6 Concrete `gh` signal vocabulary
- **CI status:** `gh pr checks <N> --repo bymaxone/nest-notification --json bucket`
  → count `pass` / `fail` / `pending`.
- **Pending review:** `gh pr view <N> --json reviewRequests` (empty = nothing queued).
- **Re-review detection:** `reviews[].submittedAt` vs `commits[-1].committedDate`.
- **Threads (GraphQL):** `reviewThreads.nodes[]` → `isResolved`, `viewerCanResolve`,
  `comments[0].databaseId` (the comment to reply under).
- **PR identity:** `gh pr view <N> --json number,headRefName,state,mergeStateStatus`.

---

## 6. All phases run in this repo

Every phase runs in **this** repo (`bymaxone/nest-notification`). The final phase
is **Phase 6 — Release v0.1.0** (README/CHANGELOG/SECURITY, CI workflows, bundle
budgets, the Stryker mutation gate, tag, `pnpm publish --provenance`). The dogfood
smoke (task 6.3) imports the built package across all three subpaths and is the
consumer validation that gates the release.
```
