# Mutation Testing Plan

Mutation testing is the deeper quality gate beyond line coverage: 100% coverage proves a
line ran, but only mutation testing proves a test would *fail* if that line were wrong. This
document describes how `@bymax-one/nest-notification` runs [Stryker](https://stryker-mutator.io/),
the gate, and the iteration workflow. The latest recorded results live in
[`mutation_testing_results.md`](./mutation_testing_results.md).

## Gate

- **Release gate:** mutation score **≥ 95%** (`stryker.config.json` `break: 95`), driven as
  close to 100% as achievable; security-critical paths at **100%**.
- **Critical paths (must be 100%, no surviving non-equivalent mutant):**
  `utils/code-generator.ts`, `utils/timing-safe-compare.ts`, `utils/hash.ts`,
  `providers/redis-otp.storage.ts`, `services/otp.service.ts`.
- **Not a per-PR gate.** Stryker takes minutes and is a manual / pre-release gate only — it is
  never added to `prepublishOnly` or `ci.yml`.

## Configuration (`stryker.config.json`)

- `testRunner: jest`, `coverageAnalysis: perTest` (maps every mutant to the exact covering tests).
- `checkers: ["typescript"]` with `disableTypeChecks: "src/**/*.{ts,tsx}"` — strips type
  checks from mutated files; the checker still discards mutations that would not compile under
  `strict` mode (reported as `CompileError` and excluded from the score, since non-compiling
  code is never a shippable fault).
- `thresholds: { high: 100, low: 95, break: 95 }`.
- `concurrency: 4` plus `NODE_OPTIONS=--max-old-space-size=4096` when running locally — bounded
  so the run stays within a safe memory envelope (never an unbounded worker fan-out).
- React `.spec.tsx` files declare `@jest-environment @stryker-mutator/jest-runner/jest-env/jsdom`
  — Stryker's coverage-reporting jsdom wrapper, transparent under a normal `pnpm test`. Plain
  `jsdom` does **not** report `perTest` coverage to Stryker and breaks the initial run.

## Running

```bash
pnpm mutation:dry-run   # validate config + the initial test run (no mutants tested)
pnpm mutation           # full run (~3 min on this codebase); writes reports/mutation/*
```

The HTML report (`reports/mutation/mutation.html`) lists every surviving mutant with its
location and replacement — the worklist for hardening.

## Iteration workflow

1. Run `pnpm mutation`; open the HTML (or parse `mutation.json`) for survivors.
2. For each survivor, write a **real assertion** that the mutated code would fail — exact-object
   matches, `'key' in obj` absence checks, boundary inputs, audit-metadata assertions, etc.
3. Re-run `pnpm test:cov` to confirm 100% coverage is preserved, then `pnpm mutation` to confirm
   the kill.
4. Only when a mutant is **provably equivalent** (no test can distinguish it) annotate it inline
   with `// Stryker disable next-line <Mutator>: <reason>` carrying a concrete reason. Minimize
   these; **never** disable a mutant a test could kill, and **never** lower the threshold.

## Equivalent-mutant policy

Inline `// Stryker disable next-line` is reserved for genuine equivalents — e.g. a Redis TTL
comparison whose two operands are never equal in practice, or a Lua-script body that only
executes on a real Redis server while unit tests drive a JS fake. Each disable carries a reason
explaining why no test can kill it. The full accounting of current equivalents and survivors is
in [`mutation_testing_results.md`](./mutation_testing_results.md).
