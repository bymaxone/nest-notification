---
applyTo: '**/*.spec.ts,**/*.spec.tsx,**/*.e2e.spec.ts,**/*.e2e-spec.ts,**/*.test.ts,**/*.test.tsx'
---

# Test Review Instructions

## Coverage

- 100% on all metrics for files that carry logic. Non-executable glue
  (`main.ts` / `main.rs`, generated code, pure type modules, `*.d.ts`) is out of scope.
- Every branch of a conditional is exercised by at least one test.

## Test design

- Name the scenario and the rule each test protects — describe behavior, not
  implementation: `it('rejects an expired reset token')`, not `it('path 2')`.
- One observable behavior per test; a single, focused assertion target.
- Mock at the boundary (the dependency), not inside the unit under test.
- Deterministic — mock time, randomness, and timers; restore mocks in `afterEach`.
- No focused/skipped tests committed (`it.only`, `describe.only`, Rust `#[ignore]`).
- Assert on the specific error class and message, not just that something threw.
- Mutation-aware — no generic matchers (`toBeDefined()`, `toBeTruthy()`) where a
  concrete value assertion is possible.

## Memory safety (mandatory)

When a library is consumed via a local link its code is recompiled into every test
runner. **Bound the pools** and run suites **sequentially**:

- TypeScript: Vitest / Jest `maxWorkers: '50%'` baked into the config.
- Rust: `cargo nextest run` with a capped `--test-threads` (≤ cores / 2).
- Never fan out parallel test agents, and never run two package suites at once.

## Integration tests

- The e2e tier (`test/e2e/`) boots a real NestJS application context through
  `BymaxNotificationModule` and exercises the wiring end to end — module
  registration, tenant isolation, and the audit path. Storage and delivery stay
  behind test doubles: this library has no infrastructure of its own to stand up,
  and the storage contract is proven by the unit specs of each adapter.

## Notification-specific assertions

- **A test that involves a code must prove the code did not leak.** Assert on the
  serialized audit entry / log line, not on a substring:
  `expect(JSON.stringify(entry)).not.toContain(code)`.
- **Attempt ceilings and cooldowns are proven under concurrency**, not by calling
  the service twice in sequence. A `Promise.all` of two generate/verify calls is
  what distinguishes an atomic storage primitive from a `get` + `update` race.
- **Never assert a generated code equals a fixed value** by stubbing
  `node:crypto`. Assert its shape (length, alphabet) and its uniformity across
  many draws — a single sample passes by luck against a broken generator.
