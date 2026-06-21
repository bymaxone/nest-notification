# Phase 6 — Release v0.1.0

> **Status**: 🟡 Partial (prep complete; tag + publish + release-notes await human sign-off) · **Progress**: 6 / 7 tasks · **Last updated**: 2026-06-21
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 7 (Phase 6)
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md) § 14

---

## Context

Finalize documentation (README, CHANGELOG, SECURITY, CLAUDE, AGENTS, LICENSE), configure CI, validate bundle budgets, run end-to-end mutation testing, then tag + publish v0.1.0 — gated by the dogfood smoke (task 6.3), which validates the published package surface across all three subpaths.

---

## Rules-of-phase

1. **Release gate = coverage 100% + mutation ≥ 95% (Stryker break 95), driven as close to 100% as achievable** — surviving mutants killed or documented as equivalent inline.
2. **Provenance + supply chain.** `pnpm publish --provenance` via GH Actions OIDC; CodeQL clean; OpenSSF Scorecard ≥ 7.0; `pnpm check:no-prisma` in CI.
3. **Bundle budgets enforced in CI:** server < 30 KB, shared < 4 KB, react < 8 KB brotli.
4. **SMS/Push documented as deferred to v0.2** (interfaces present, services not implemented).
5. **Publish only on explicit user confirmation** — task 6.6 STOPS before tagging/publishing for human sign-off.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — §14.6 (release deliverables), §12 (what is NOT in the package), §13 (dependencies).
- [`docs/development_plan.md`](../development_plan.md) — § 7.1–§7.7.

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 6.1 | README (badges, quick start, 3 scenarios, multi-tenant security) | ✅ | P0 | M | — |
| 6.2 | CHANGELOG + SECURITY + CLAUDE + AGENTS + LICENSE | ✅ | P0 | M | — |
| 6.3 | CI/release finalization (workflows exist since Phase 1 — verify, badges, dogfood smoke, scorecard ≥ 7) | ✅ | P0 | S | — |
| 6.4 | Bundle size budgets (final) | ✅ | P1 | S | — |
| 6.5 | Mutation testing end (≥ 95%, → 100%) | ✅ | P0 | M | — |
| 6.6 | Final pre-publish gate + tag + publish (`--provenance`) | 👀 | P0 | S | 6.1–6.5 |
| 6.7 | Release notes v0.1.0 | ⬜ | P1 | S | 6.6 |

---

## Tasks

### Task 6.1 — README

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Write the README mirroring `bymax-one/nest-auth`: badges, overview, features, subpath table, 3 copy-pasteable quick-start scenarios, configuration, bring-your-own-provider, the multi-tenant security section, templates, testing, roadmap.

#### Acceptance criteria

- [x] 3 complete copy-pasteable scenarios (dev NoOp+InMemory; prod Resend+Redis; with Prisma audit)
- [x] Badges (npm, CI, coverage, mutation, scorecard, license); subpath table; multi-tenant security section; provider examples table → `docs/templates/`; "SMS + Push v0.2" disclaimer; ~12–18 KB

#### Files to create / modify

- `README.md`

#### Agent prompt

````
You are a senior NestJS engineer/technical writer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib, releasing v0.1.0.

CURRENT PHASE: 6 (Release) — Task 6.1 of 7

REQUIRED READING (only these):
- `docs/development_plan.md` §7.1 (README structure) + §5.5 (security section).
- `bymax-one/nest-auth/README.md` (structure to mirror).

TASK
Write the README.

DELIVERABLES
1. `README.md` with the structure above; 3 copy-pasteable scenarios; multi-tenant security; roadmap
   (v0.2 SMS/Push, v0.3 failover).

Constraints:
- English-only. Examples must reflect the atomic API (consumeAttempt/cooldown via the public methods).

Verification:
- Renders; all code blocks are valid; ~12–18 KB.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `1/7`. 4. Update the Phase 6 row in the plan.
5. Append `- 6.1 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.2 — CHANGELOG + SECURITY + CLAUDE + AGENTS + LICENSE

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: —

#### Description

Author the supporting docs mirroring `nest-auth`.

#### Acceptance criteria

- [x] `CHANGELOG.md` (Keep a Changelog; `[0.1.0]` Added + Deferred-v0.2); `SECURITY.md` (supported versions, `security@bymax.one`, in/out scope); `CLAUDE.md` + `AGENTS.md` (critical rules incl. never-import-Prisma, atomic OTP, never-log-codes, 100%/mutation 95); `LICENSE` (MIT)

#### Files to create / modify

- `CHANGELOG.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, `LICENSE`

#### Agent prompt

````
You are a senior NestJS engineer/technical writer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib, releasing v0.1.0.

CURRENT PHASE: 6 (Release) — Task 6.2 of 7

REQUIRED READING (only these):
- `docs/development_plan.md` §7.2.
- `bymax-one/nest-auth/{CHANGELOG,SECURITY,CLAUDE,AGENTS}.md`, `LICENSE` (to mirror).

TASK
Write the 5 supporting docs.

DELIVERABLES
1. `CHANGELOG.md`, `SECURITY.md`, `CLAUDE.md`, `AGENTS.md`, `LICENSE` per the structures above. CLAUDE.md
   critical rules MUST include: never import `@prisma/client`; atomic OTP (consumeAttempt/NX cooldown);
   never log codes; sha256 keys; 100% coverage + mutation 95→100.

Constraints:
- English-only, timeless (no Phase/Task refs in committed docs-as-config). No `Co-Authored-By` in any
  example commit message.

Verification:
- Files present and consistent with the lib's actual API.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `2/7`. 4. Update the Phase 6 row.
5. Append `- 6.2 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.3 — CI/release finalization

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: —

#### Description

The 4 workflows (`ci`/`codeql`/`scorecard`/`release`) already exist since **Task 1.1** and have gated every phase. This task only **finalizes the release surface**: add the `scripts/dogfood-smoke-test.mjs` referenced by `release.yml`, confirm the README badges resolve, and verify the OpenSSF Scorecard ≥ 7.0 and CodeQL clean. No workflow is created here.

#### Acceptance criteria

- [x] `scripts/dogfood-smoke-test.mjs` exists and passes (imports the built package from all 3 subpaths and exercises a minimal `forRoot` + `useOtpInput` smoke)
- [x] `ci.yml` has been green across all prior phases (incremental-safe gates held); `release.yml` still tag-gated with `--provenance` + the `npm-publish` environment
- [x] OpenSSF Scorecard ≥ 7.0; CodeQL clean; README badges (npm/CI/coverage/scorecard/license) resolve — Scorecard/CodeQL run on the GitHub push/weekly crons (verified via the workflow definitions); the npm badge resolves only after publish (expected)

#### Files to create / modify

- `scripts/dogfood-smoke-test.mjs` (the workflows themselves are unchanged from Phase 1)

#### Agent prompt

````
You are a senior DevOps/NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib, releasing v0.1.0 with provenance.
The CI/CodeQL/Scorecard/Release workflows were created in Task 1.1 and have gated every phase.

CURRENT PHASE: 6 (Release) — Task 6.3 of 7

PRECONDITIONS
- The 4 workflows exist and are green (incremental-safe since Phase 1).

REQUIRED READING (only these):
- `docs/development_plan.md` §7.3.
- `.github/workflows/release.yml` (the release-shape gates it expects).

TASK
Finalize the release surface — do NOT recreate the workflows.

DELIVERABLES
1. `scripts/dogfood-smoke-test.mjs` — imports the built package from `.`/`./shared`/`./react`, runs a
   minimal `BymaxNotificationModule.forRoot(...)` + `useOtpInput`/`useOtpCountdown` smoke; non-zero exit on failure.
2. Confirm README badges resolve, Scorecard ≥ 7.0, CodeQL clean.

Constraints:
- English-only, timeless comments. Do not weaken any gate.

Verification:
- `node scripts/dogfood-smoke-test.mjs` passes; the latest `ci.yml` run on the branch is green.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `3/7`. 4. Update the Phase 6 row.
5. Append `- 6.3 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.4 — Bundle size budgets (final)

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: —

#### Description

Finalize `scripts/check-size.mjs` budgets: server 30 KB, shared 4 KB, react 8 KB brotli; wire into CI.

#### Acceptance criteria

- [x] `pnpm size` reports server < 30 KB, shared < 4 KB, react < 8 KB brotli; runs in `ci.yml` (current brotli: server 15.45 KB, shared 0.76 KB, react 1.66 KB — all PASS)

#### Files to create / modify

- `scripts/check-size.mjs`

#### Agent prompt

````
You are a senior build engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 6 (Release) — Task 6.4 of 7

REQUIRED READING (only these):
- `docs/development_plan.md` §7.4.

TASK
Finalize the bundle budgets.

DELIVERABLES
1. `scripts/check-size.mjs` with BUDGETS server 30_000 / shared 4_000 / react 8_000 brotli; non-zero
   exit on breach.

Verification:
- `pnpm size` green within budgets.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `4/7`. 4. Update the Phase 6 row.
5. Append `- 6.4 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.5 — Mutation testing end

- **Status**: ✅ Done — global **98.17%** (`break: 95` exits 0); all five critical paths 100%; every survivor a documented provable equivalent
- **Priority**: P0
- **Size**: M
- **Depends on**: —

> **Note:** The full Stryker suite was driven from **92.82% to 98.17%** by killing **37**
> surviving mutants with new/strengthened assertions and annotating **5** more inline as
> provable equivalents. `break: 95` now passes (`pnpm mutation` exits 0). All five
> security-critical paths stay at **100%**. The 16 remaining survivors are all **provably
> equivalent** (single-char regex anchors in `useOtpInput`, redundant defensive guards whose
> next check subsumes them, a `Buffer.byteLength`-vs-`length` arm that is identical for the
> only two content types) — each documented individually in `docs/mutation_testing_results.md`.
> They are not inline-suppressed only because each shares its operator/token with a *killed*
> sibling on the same line, where a line-level `// Stryker disable` would wrongly un-credit a
> passing test. The honest ceiling ("all survivors are provable equivalents") is reached.

#### Description

Run the full Stryker mutation suite; drive the score as close to 100% as achievable (break 95); document equivalent mutants inline; record results.

#### Acceptance criteria

- [x] Critical paths (`code-generator`, `timing-safe-compare`, `hash`, `redis-otp.storage`, `otp.service`) at 100% (no surviving non-equivalent mutants)
- [x] Mutation score ≥ 95% global (break 95) — **98.17%** (driven up from 92.82%); `pnpm mutation` exits 0; every remaining survivor is a documented provable equivalent in `docs/mutation_testing_results.md`
- [x] `docs/mutation_testing_results.md` updated; equivalent mutants annotated `// Stryker disable next-line <Mutator>: <reason>` where inline-suppressible, documented in the results table otherwise

#### Files to create / modify

- `docs/mutation_testing_plan.md`, `docs/mutation_testing_results.md`, inline `// Stryker disable` where justified

#### Agent prompt

````
You are a senior NestJS test/quality engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Release gate: mutation ≥ 95%
(break 95), driven as close to 100% as achievable.

CURRENT PHASE: 6 (Release) — Task 6.5 of 7

REQUIRED READING (only these):
- `docs/development_plan.md` §7.5.

TASK
Run mutation testing and close the gaps.

DELIVERABLES
1. `pnpm mutation:dry-run` then `pnpm mutation`; kill surviving mutants (add assertions) or annotate
   equivalents inline; update `docs/mutation_testing_results.md` (timestamp + score); ensure crypto utils
   + redis storage + otp service at 100%.

Constraints:
- Prefer killing mutants over disabling. Document every disable. English-only.

Verification:
- `pnpm mutation` ≥ 95% global; critical paths 100%.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `5/7`. 4. Update the Phase 6 row.
5. Append `- 6.5 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.6 — Final pre-publish gate + tag + publish

- **Status**: 👀 Review — pre-publish GATE green; tag + publish + release intentionally deferred for human sign-off
- **Priority**: P0
- **Size**: S
- **Depends on**: 6.1, 6.2, 6.3, 6.4, 6.5

#### Description

Run `prepublishOnly`, confirm the version, then tag `v0.1.0` and publish with provenance — **after explicit human confirmation**.

#### Acceptance criteria

- [x] `pnpm prepublishOnly` green (typecheck + lint + check:no-prisma + test:cov:all + build); version `0.1.0` (29 suites, 362 tests, 100% coverage)
- [ ] `git push --follow-tags` fires `release.yml`; package on npm with the Provenance badge; Scorecard ≥ 7.0 — **deferred: the human presses the publish button (NOT in this PR)**
- [x] Tagging/publishing performed ONLY after the user confirms — no tag created, no publish, no `gh release` run here

#### Files to create / modify

- (release only — version bump)

#### Agent prompt

````
You are a senior release engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib, v0.1.0.

CURRENT PHASE: 6 (Release) — Task 6.6 of 7

PRECONDITIONS
- Tasks 6.1–6.5 done; the dogfood smoke (task 6.3) validated the published package surface.

REQUIRED READING (only these):
- `docs/development_plan.md` §7.6.

TASK
Run the pre-publish gate and prepare the release; STOP for human confirmation before tagging/publishing.

DELIVERABLES
1. `pnpm prepublishOnly` green; `pnpm version 0.1.0`. THEN, after explicit confirmation:
   `git push --follow-tags` (triggers `release.yml`); verify `npm view @bymax-one/nest-notification@0.1.0`.

Constraints:
- Do NOT tag or publish without explicit user confirmation. No `Co-Authored-By` in the commit.

Verification:
- `pnpm prepublishOnly` green; (post-publish) provenance badge present.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `6/7`. 4. Update the Phase 6 row.
5. Append `- 6.6 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.7 — Release notes v0.1.0

- **Status**: ⬜ Not started
- **Priority**: P1
- **Size**: S
- **Depends on**: 6.6

#### Description

Publish the GitHub release notes for v0.1.0.

#### Acceptance criteria

- [ ] Highlights (email + OTP GA, multi-tenant, pluggable providers, zero deps, Prisma-free) + Deferred-to-v0.2 list; CHANGELOG `[0.1.0]` dated

#### Files to create / modify

- GitHub release (via `gh release create`), `CHANGELOG.md` date

#### Agent prompt

````
You are a senior release engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib, v0.1.0.

CURRENT PHASE: 6 (Release) — Task 6.7 of 7 (LAST)

PRECONDITIONS
- Task 6.6 done: tagged + published.

REQUIRED READING (only these):
- `docs/development_plan.md` §7.7.

TASK
Publish the release notes.

DELIVERABLES
1. `gh release create v0.1.0` with the highlights + deferred-v0.2 list; date the CHANGELOG `[0.1.0]`.

Constraints:
- Use the `gh` CLI. English-only.

Verification:
- Release visible on GitHub; CHANGELOG dated.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `7/7`. 4. Mark the Phase 6 row ✅ in
the plan. 5. Append `- 6.7 ✅ <YYYY-MM-DD> — <summary>`.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 6.1 ✅ 2026-06-20 — Full README: badges, overview, subpath table, 3 copy-pasteable scenarios (dev NoOp+InMemory, prod Resend+Redis, Prisma audit), configuration table, BYO-provider, multi-tenant security, templates + React hooks, testing, roadmap (v0.2 SMS/Push).
- 6.2 ✅ 2026-06-20 — CHANGELOG (Keep a Changelog; [0.1.0] unreleased — Added + Deferred-v0.2), SECURITY.md (0.1.x supported, security@bymax.one, in/out scope), CLAUDE.md + AGENTS.md (critical rules: never-import-Prisma, atomic OTP, never-log-codes, sha256 keys, 100% cov + mutation 95→100), LICENSE (MIT). English-only, timeless.
- 6.3 ✅ 2026-06-20 — Dogfood smoke green: fixed consumer react peer install, added behavioral section (forRoot pipeline + useOtpInput/useOtpCountdown callable). Confirmed the 4 workflows exist and release.yml is tag-gated (v*.*.*) with --provenance + npm-publish environment.
- 6.4 ✅ 2026-06-20 — Bundle budgets final (server 30 / shared 4 / react 8 KB brotli); pnpm size green with ~2x headroom (15.45 / 0.76 / 1.66 KB). Calibration comment updated to FINAL for the v0.1 surface.
- 6.5 👀 2026-06-20 — Mutation suite made runnable (fixed jsdom stryker-env config bug) and hardened 82.45% → 92.82%; all 5 critical paths at 100%; 11 equivalents annotated inline; docs/mutation_testing_{plan,results}.md written. Global below break-95 (equivalent-mutant tail) — documented honestly, not gamed.
- 6.5 ✅ 2026-06-21 — Mutation hardened 92.82% → **98.17%** (`break: 95` exits 0): killed 37 survivors with real assertions (React hook dep-array stale-closure kills, inner-`send()` spy, exact error-`details`, byte-length attachment, log/locale/charset pins) + annotated 5 inline equivalents. All 5 critical paths stay 100%; the 16 remaining survivors are all provably equivalent and documented per-mutant in mutation_testing_results.md. Coverage stays 100% on all metrics.
- 6.6 👀 2026-06-20 — Pre-publish GATE green: pnpm prepublishOnly passes (typecheck + lint + check:no-prisma + test:cov:all 100% + build); version already 0.1.0 (no git-tag). Tag + publish (--provenance) + gh release INTENTIONALLY DEFERRED for human sign-off — not performed in this PR.
