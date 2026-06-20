# Development Tasks — @bymax-one/nest-notification

> **Last updated:** 2026-06-19
> **Source roadmap:** [`../development_plan.md`](../development_plan.md) (plan rev 1.1.0) · **Spec:** [`../technical_specification.md`](../technical_specification.md) (rev 1.1.0)

Tasks live **one file per phase** in this folder (`docs/tasks/phase-NN-<slug>.md`), following the Bymax task-doc convention (same pattern as `bymax-one/rust-auth`). Each phase file is self-contained: context, rules-of-phase, reference docs, a task index, the tasks (each with an executable **Agent prompt**), and a completion log.

> **Canonical phase status lives in the plan's [Phase dashboard](../development_plan.md#15-phase-dashboard) (§1.5).** This folder index mirrors it for convenience — when a phase/task changes state, update the plan dashboard first, then this table.

---

## Phase files (folder index)

| Phase | File | Tasks | Status |
|---|---|---|---|
| 1 | [`phase-01-foundation-interfaces.md`](./phase-01-foundation-interfaces.md) | 2 / 11 | 🟡 In progress |
| 2 | [`phase-02-email-otp-services.md`](./phase-02-email-otp-services.md) | 0 / 10 | 🔴 Not started |
| 3 | [`phase-03-templating-rate-limiting.md`](./phase-03-templating-rate-limiting.md) | 0 / 8 | 🔴 Not started |
| 4 | [`phase-04-multitenant-audit.md`](./phase-04-multitenant-audit.md) | 0 / 8 | 🔴 Not started |
| 5 | [`phase-05-frontend-react.md`](./phase-05-frontend-react.md) | 0 / 5 | 🔴 Not started |
| 6 | [`phase-06-adoption-bymax-fitness.md`](./phase-06-adoption-bymax-fitness.md) | 0 / 6 | 🔴 Not started |
| 7 | [`phase-07-release.md`](./phase-07-release.md) | 0 / 7 | 🔴 Not started |
| | **Total** | **0 / 55** | 🔴 0% |

> Phases 1–5 + 7 are in this repo; **Phase 6 (Adoption)** runs in the `bymax-fitness-ai` repo and validates the package before release.

---

## Status legend

| Status | Task emoji | Dashboard emoji | Meaning |
|---|---|---|---|
| TODO | ⬜ | 🔴 | Not started |
| IN_PROGRESS | 🔄 | 🟡 | In progress |
| DONE | ✅ | 🟢 | Completed and verified (acceptance criteria met) |
| BLOCKED | 🚫 | ⚪ | Blocked by a dependency |
| REVIEW | 👀 | 🔵 | Under review |

Task sizes: **S** (< ~100 LoC), **M** (~100–250), **L** (~250+). Priorities: **P0** (blocking), **P1** (important), **P2** (nice-to-have).

---

## Execution guidance for AI agents

> **Read this before executing any task.**

### Token economy
1. **Do not load a whole phase file** — jump to your task's anchor (e.g. `#task-2-5`); use `Read` with `offset`/`limit`.
2. **Do not load the plan or spec entirely** — each task lists "REQUIRED READING" with exact sections; read only those.
3. **Do not load `nest-auth`/`nest-logger`/`nest-cache` entirely** — copy only the specific file a task references.

### Phase execution mode (`/bymax-workflow:task phase <N>`)
- Resolve the phase's tasks in dependency order (the `Depends on` column), execute sequentially, and after each task confirm `Status: ✅` was applied. The phase closes when all its tasks are done.

### Self-update protocol (mandatory at the end of each task)
Update **three** places, then the cross-doc rows:
1. The task block's **Status** + tick its acceptance criteria.
2. The phase file's **Task index** row + **Progress** counter (`X / Y`).
3. The phase file's **Completion log** (append `- <id> ✅ <YYYY-MM-DD> — <summary>`).
4. The phase row in [`../development_plan.md`](../development_plan.md) and this README's dashboard.
5. Commit with Conventional Commits: `<type>(notification): <subject> (<phase>.<task>)` — **no `Co-Authored-By` trailer**.

### Blocked / review
- Blocked → `Status: 🚫`, add `> **Blocker:** …` under the task header, no destructive commit.
- Acceptance fails after 2 red-green cycles → `Status: 👀` + an inline note.

---

## Project-wide constraints (apply to every task)

- **The lib NEVER imports `@prisma/client`** — all persistence behind `IOtpStorage` / `INotificationLogRepository`. CI gate: `pnpm check:no-prisma`.
- **OTP codes are NEVER logged** — not in audit metadata, console, or error messages. Gate: `JSON.stringify(auditEntry).includes(realCode) === false`.
- **Atomic OTP** — the attempt counter is mutated only by `storage.consumeAttempt`; the cooldown is acquired only by `storage.tryAcquireCooldown` (`SET NX EX`) and released on delivery failure. Never a service-side `get`+`update`.
- **Code-Craft Standard** — TS strict (no `any`); **100% coverage** per file; mutation **≥ 95% (break 95), driven to 100%**; functions ≤ 50 lines, files ≤ 800; `@fileoverview` + `@layer` header per file; official-docs-first (context7) before using any library; English-only, timeless comments (no Phase/Task references in committed code).
- **CI green from the first PR** — the four workflows (`ci`/`codeql`/`scorecard`/`release`) are created in **Task 1.1** and every per-PR gate is incremental-safe (jest `passWithNoTests`, coverage on implemented files, empty-`react` build-output integrity, size budgets, `check:no-prisma`). Mutation is a pre-release gate only; `release.yml` is tag-driven. Every PR must leave CI green.
- **MVP scope** — v0.1 ships **Email + OTP** only; `ISmsProvider`/`IPushProvider` are declared but their services are not implemented (`validateOptions` rejects `sms`/`push`). Deferred to v0.2.
