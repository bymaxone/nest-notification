# Phase 5 — Frontend (`./react`)

> **Status**: 🔄 In Progress · **Progress**: 2 / 5 tasks · **Last updated**: 2026-06-20
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 6 (Phase 5)
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md)

---

## Context

Implement the `./react` subpath: `useOtpInput` (N single-digit inputs with auto-focus, paste handling, Backspace/Arrow navigation) and `useOtpCountdown` (reactive timer to `expiresAt` with `MM:SS`/`HH:MM:SS` formatting). State + UX only — no HTTP client (the verify call is the consumer app's job). `react` is an optional peer dep, marked external in the build.

---

## Rules-of-phase

1. **State + UX only.** No fetch/HTTP client in the hooks. `react` is external in the bundle; the `./react` subpath targets es2022 (may run in the browser).
2. **Stable refs.** `useMemo` for the input refs; `useRef` for callbacks (avoid stale closures); `onComplete` deferred to a microtask so React commits state first.
3. **100% coverage** with React Testing Library `renderHook` + `act` (+ `jest.useFakeTimers()` for the countdown). English-only, timeless comments, fn ≤ 50 / file ≤ 800.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — §16.2 (`useOtpInput`), §16.3 (`useOtpCountdown`).
- [`docs/development_plan.md`](../development_plan.md) — §6.1–§6.5.

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 5.1 | `useOtpInput` hook | ✅ | P0 | M | 1.1 |
| 5.2 | `useOtpCountdown` hook | ✅ | P0 | S | 1.1 |
| 5.3 | `./react` barrel export | ⬜ | P1 | S | 5.1, 5.2 |
| 5.4 | Tests — RTL (`renderHook`/`act`/fake timers) | ⬜ | P0 | M | 5.1, 5.2, 5.3 |
| 5.5 | Phase 5 validation | ⬜ | P0 | S | 5.4 |

---

## Tasks

### Task 5.1 — `useOtpInput` hook

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.1

#### Description

Manage N single-digit inputs: validation per `type`, auto-focus next, Backspace clears+focuses previous, Arrow navigation, paste distribution (sanitize+filter), `onComplete` on full code, `reset`, derived `code`/`isComplete`.

#### Acceptance criteria

- [x] Initializes `length` empty strings; valid char fills + focuses next; invalid char rejected; alpha/alphanumeric uppercased
- [x] Backspace on empty slot clears+focuses previous; Arrow Left/Right navigate; paste distributes, sanitizes spaces/hyphens, filters invalid
- [x] `onComplete` fires when full and `autoSubmit:true` (microtask-deferred); `reset()` clears + focuses slot 0; `code`/`isComplete` derived
- [x] Coverage 100%

#### Files to create / modify

- `src/react/useOtpInput.ts`, `src/react/types.ts`

#### Agent prompt

````
You are a senior React 19 engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. The `./react` subpath is
state/UX-only OTP hooks (no HTTP); `react` is an optional peer dep, external in the bundle.

CURRENT PHASE: 5 (Frontend) — Task 5.1 of 5

PRECONDITIONS
- Task 1.1 done: the `./react` tsup entry + `react` peer dep exist.

REQUIRED READING (only these):
- `docs/technical_specification.md` §16.2 (`useOtpInput` API).
- `docs/development_plan.md` §6.1.

TASK
Implement `useOtpInput`.

DELIVERABLES
1. `types.ts` — `OtpInputType`, `UseOtpInputOptions`, `UseOtpInputState`, `UseOtpCountdownOptions`,
   `UseOtpCountdownState`.
2. `useOtpInput.ts` — values state, `useMemo` refs, `useRef(onComplete)`, validators by type,
   `onChange`/`onKeyDown`/`onPaste`/`reset`/`setValue`, derived `code`/`isComplete`; `onComplete` in a
   microtask.

Constraints:
- No HTTP. Early-return on `raw.length>1` (mobile Safari paste-through). English-only, timeless comments.

Verification:
- `pnpm test src/react/useOtpInput.spec.tsx` (RTL `renderHook`/`act`) at 100%.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `1/5`. 4. Update Phase 5 row in the plan.
5. Append `- 5.1 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 5.2 — `useOtpCountdown` hook

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.1

#### Description

Reactive countdown to `expiresAt` with `onExpired`, configurable tick, and `MM:SS`/`HH:MM:SS` formatting; cleans up its interval.

#### Acceptance criteria

- [x] `expiresAt:null` → `{remainingSeconds:0, expired:true, formatted:'00:00'}`; non-null computes initial value, decrements per tick
- [x] `onExpired` fires once at 0; interval cleared after expiry and on unmount; re-render with new `expiresAt` resets immediately
- [x] `formatted` `MM:SS` (<1h) / `HH:MM:SS` (≥1h); Coverage 100%

#### Files to create / modify

- `src/react/useOtpCountdown.ts`

#### Agent prompt

````
You are a senior React 19 engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 5 (Frontend) — Task 5.2 of 5

PRECONDITIONS
- Task 1.1 done; `types.ts` from 5.1 available.

REQUIRED READING (only these):
- `docs/technical_specification.md` §16.3 (`useOtpCountdown`).
- `docs/development_plan.md` §6.2.

TASK
Implement `useOtpCountdown`.

DELIVERABLES
1. `useOtpCountdown.ts` — state from `computeRemaining`, `useRef(onExpired)`, `useEffect([expiresAt,tick])`
   with `setInterval` + cleanup; `computeRemaining`/`formatTime` helpers.

Constraints:
- Clear the interval at 0 and on unmount. English-only, timeless comments.

Verification:
- `pnpm test src/react/useOtpCountdown.spec.tsx` (`jest.useFakeTimers()`) at 100%.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `2/5`. 4. Update Phase 5 row.
5. Append `- 5.2 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 5.3 — `./react` barrel export

- **Status**: ⬜ Not started
- **Priority**: P1
- **Size**: S
- **Depends on**: 5.1, 5.2

#### Description

Export the hooks + their types from `src/react/index.ts`.

#### Acceptance criteria

- [ ] `useOtpInput`, `useOtpCountdown` + the 4 option/state types exported
- [ ] `pnpm build` emits `dist/react/index.{mjs,cjs,d.ts}` with `react` external

#### Files to create / modify

- `src/react/index.ts`

#### Agent prompt

````
You are a senior TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 5 (Frontend) — Task 5.3 of 5

PRECONDITIONS
- Tasks 5.1–5.2 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §6.3.

TASK
Write the `./react` barrel.

DELIVERABLES
1. `src/react/index.ts` — export both hooks + `OtpInputType`/`UseOtpInputOptions`/`UseOtpInputState`/
   `UseOtpCountdownOptions`/`UseOtpCountdownState`.

Verification:
- `pnpm build`; `dist/react/index.mjs` does not bundle `react`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `3/5`. 4. Update Phase 5 row.
5. Append `- 5.3 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 5.4 — Tests (RTL)

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: M
- **Depends on**: 5.1, 5.2, 5.3

#### Description

100% coverage on both hooks via `@testing-library/react` `renderHook`/`act` (+ fake timers for the countdown).

#### Acceptance criteria

- [ ] `useOtpInput`: init, valid/invalid char, uppercase, Backspace, Arrows, paste (distribute/sanitize/filter), `onComplete`, `reset`, derived values
- [ ] `useOtpCountdown`: null case, decrement, `onExpired` once, interval cleanup, format, re-render reset
- [ ] Coverage 100%; `jest-environment-jsdom`

#### Files to create / modify

- `src/react/useOtpInput.spec.tsx`, `src/react/useOtpCountdown.spec.tsx`

#### Agent prompt

````
You are a senior React test engineer working on the nest-notification project. Use /bymax-quality:tdd
or `tester`.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. 100% coverage.

CURRENT PHASE: 5 (Frontend) — Task 5.4 of 5

PRECONDITIONS
- Tasks 5.1–5.3 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §6.4.

TASK
Write the RTL tests for both hooks.

DELIVERABLES
- `useOtpInput.spec.tsx` + `useOtpCountdown.spec.tsx` (renderHook/act/fake timers) covering all cases above.

Verification:
- `pnpm test src/react/` at 100% under `jest-environment-jsdom`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `4/5`. 4. Update Phase 5 row.
5. Append `- 5.4 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 5.5 — Phase 5 validation

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: S
- **Depends on**: 5.4

#### Description

Run gates and confirm the `./react` bundle budget; close the phase.

#### Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size` green
- [ ] `dist/react/index.mjs` < 8 KB brotli; `react` external; both hooks at 100%
- [ ] Code-review findings applied

#### Files to create / modify

- (validation only)

#### Agent prompt

````
You are a senior React engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 5 (Frontend) — Task 5.5 of 5 (LAST)

PRECONDITIONS
- Tasks 5.1–5.4 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §6.5.

TASK
Run the Phase 5 gate + bundle-budget check.

DELIVERABLES
- Gate green; `pnpm size` confirms react < 8 KB brotli.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `5/5`. 4. Mark the Phase 5 row ✅ in
the plan. 5. Append `- 5.5 ✅ <YYYY-MM-DD> — <summary>`.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 5.1 ✅ 2026-06-20 — `useOtpInput` + `types.ts`: N-slot OTP state, validation by class, auto-focus, Backspace/Arrow nav, paste distribute/sanitize/filter, microtask-deferred `onComplete`; 100% coverage.
- 5.2 ✅ 2026-06-20 — `useOtpCountdown`: reactive countdown to `expiresAt`, one-shot `onExpired`, configurable tick, `MM:SS`/`HH:MM:SS` formatting, interval cleanup on expiry/unmount; 100% coverage.
