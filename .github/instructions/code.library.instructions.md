---
applyTo: 'src/**/*.ts,package.json'
---

# Code Review Instructions — publishable library (`@bymax-one/*`)

Rules for a NestJS/TypeScript library that ships to consumers.

## Supply-chain contract

- **`dependencies` in `package.json` stays empty** — everything runtime is a
  `peerDependency`. Adding a real dependency is a breaking change to the
  supply-chain contract; flag it.
- The **subpath export model** is authoritative: the server root (`.`) is
  server-only; browser-safe code ships under `./shared` (and `./react`, …).

## NestJS shape

- Dynamic module via `forRoot` + `forRootAsync({ useFactory, useClass, useExisting })`.
- **DI injection tokens are `Symbol()`**, never string literals — string tokens
  collide silently across modules.
- Ports are `interface` (the `I` prefix is reserved for these); unions are `type`.
- Singletons only; no `console.*` in `src/` — log through the injected logger port.

## TypeScript

- `strict` with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noImplicitReturns`.
- **Zero `any`** — use `unknown` with type guards; generics for typed APIs.
- Import types with `import type { … }` when the value is not used at runtime.
- No suppression comments without a written justification.
- Every exported symbol carries JSDoc.

## Published package shape

- The `exports` map declares **`types` inside each condition** — `import` resolves
  to `.d.ts`, `require` to `.d.cts`. A single shared `types` key hands ESM
  declarations to a CommonJS consumer; the runtime still works, so nothing else
  catches it. Flag any subpath that regresses to a shared key.
- `main` / `module` / `types` stay at the top level, because the legacy `node`
  resolution algorithm ignores `exports` entirely. `"./package.json"` stays
  exported, and every new subpath is added to `typesVersions`, to the
  build-integrity loop in `ci.yml`, and to the budgets in
  `scripts/check-size.mjs`.
- A new entry point also needs `EXPECTED_EXPORTS` in
  `scripts/dogfood-smoke-test.mjs` and an assertion in `test/types/`.

## This library

- Three subpaths: `.` (NestJS server), `./shared` (types + constants, zero deps,
  must stay importable from a browser bundle), `./react` (state/UX-only hooks —
  no HTTP client, no Node builtins).
- Reference adapters (`ResendEmailProvider`, `RedisOtpStorage`,
  `InMemoryOtpStorage`, `DefaultTemplateRenderer`) are examples of the contract,
  not the contract: a consumer must be able to replace any of them without
  touching a call site.
