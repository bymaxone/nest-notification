# Phase 1 — Foundation + Interfaces (`IEmailProvider` + `IOtpStorage`)

> **Status**: 🔄 In Progress · **Progress**: 4 / 11 tasks · **Last updated**: 2026-06-19
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 2 (Phase 1)
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md)

---

## Context

This phase establishes the complete project scaffold and the **public contracts** of the library: the provider/storage/renderer/audit interfaces, the injection tokens, the error catalog + exception, options validation/resolution, the crypto utilities, and the dynamic-module skeleton with conditional registration. No channel services exist yet — at the end of the phase a consumer can install the lib in a NestJS fixture and call `BymaxNotificationModule.forRoot({ ... })` without error.

The flagship decision baked in here is the **dissolution of the Prisma coupling** that existed in `bymax-fitness/_commons_/notification/EmailVerificationService`: all OTP persistence goes behind `IOtpStorage`, which declares **atomic** primitives (`consumeAttempt`, `tryAcquireCooldown`, `clearCooldown`) so the `maxAttempts`/anti-resend guarantees hold under concurrency. The lib NEVER imports `@prisma/client`.

---

## Rules-of-phase

1. **Zero runtime deps.** `package.json` ships `"dependencies": {}`; everything is an optional peer dep. The lib never imports `@prisma/client`, `ioredis`, `resend`, etc. directly.
2. **`IOtpStorage` declares the atomic contract** — `consumeAttempt` (lookup + attempt increment in one indivisible step) and `tryAcquireCooldown` (`SET NX EX`) MUST be documented as "must be atomic". A plain `get`+`update` would race and let `maxAttempts` be bypassed.
3. **English only, timeless comments** (no `Phase N`/`Task N` references in committed code). TS strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), zero `any`. `@fileoverview` + `@layer` header per file. Functions ≤ 50 lines, files ≤ 800.
4. **DI tokens are `Symbol`s**; explicit `@Inject(TOKEN)`. Only configured channels are registered (opt-in).
5. **Security primitives are correct**: codes via `crypto.randomInt` built digit-by-digit (no `10**length` overflow); `safeCompare` length-guards before `crypto.timingSafeEqual`; Redis identifiers hashed `sha256(tenantId:recipient)`.
6. **100% line/branch coverage** on every implemented file before the phase closes; mutation focus on the crypto utils.
7. **CI is complete and green from the very first PR.** The four workflows (`ci` · `codeql` · `scorecard` · `release`) are created in Task 1.1 and every PR/branch gate is **incremental-safe** — it must pass at *every* phase, not depend on later-phase resources: jest configs set `passWithNoTests: true`; coverage is enforced only on implemented files (`collectCoverageFrom`); the build-output integrity check tolerates the still-empty `react` subpath; size budgets pass on small/empty bundles; `check:no-prisma` runs on `src/`. **Mutation is a pre-release gate only — never on per-PR CI.** Heavy/last-phase steps (`--provenance` publish, dogfood smoke, CHANGELOG extraction) live in the tag-driven `release` workflow, which does not run during phases.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — §3 (Package structure, subpath exports), §4 (Configuration API, `ResolvedNotificationOptions`, `forRoot`/instance-vs-class), §5 (provider/storage/renderer/log contracts), §6.2.1/6.2.2 (code generator, `safeCompare`), §11 (error catalog).
- [`docs/development_plan.md`](../development_plan.md) — §2.1–§2.11, §1.2 (guiding principles), Appendix C (reference configs), Appendix E (Redis key strategy).
- Config template: `bymax-one/nest-auth` (sibling TS lib) — copy and adapt per Appendix C.
- `/bymax-workflow:standards` skill — universal coding rules.

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 1.1 | Project scaffold **+ complete CI** (package.json, tsconfig×, tsup 3 entries, jest×, stryker, eslint, check-size, check:no-prisma, **ci/codeql/scorecard/release workflows — incremental-safe**) | ✅ | P0 | L | — |
| 1.2 | Shared types + constants (`src/shared`) | ✅ | P0 | S | 1.1 |
| 1.3 | Main interfaces (`IEmailProvider`, `IOtpStorage` + atomic methods, renderer, log, SMS/Push sketches, module options, `NotificationRequest`) | ✅ | P0 | M | 1.1, 1.2 |
| 1.4 | Injection tokens + error catalog (incl. `OTP_EMAIL_DELIVERY_NOT_CONFIGURED`) + `NotificationException` + default-options constants | ✅ | P0 | M | 1.2, 1.3 |
| 1.5 | Options validation + resolution (`ResolvedNotificationOptions` + `resolveForPurpose`, `maxAttachmentBytes`, `maskRecipient`) | ⬜ | P0 | M | 1.3, 1.4 |
| 1.6 | No-op providers + minimal `DefaultTemplateRenderer` (escape html body only) | ⬜ | P0 | S | 1.3 |
| 1.7 | Crypto utils — `hash`, `code-generator` (digit-by-digit), `safeCompare` (length-guard) | ⬜ | P0 | M | 1.4 |
| 1.8 | Dynamic module — synchronous `forRoot()` with conditional registration | ⬜ | P0 | M | 1.5, 1.6 |
| 1.9 | Server barrel exports | ⬜ | P1 | S | 1.3–1.8 |
| 1.10 | Tests for Phase 1 (100% coverage) | ⬜ | P0 | L | 1.3–1.9 |
| 1.11 | Phase 1 validation (gates + error-codes sync + smoke) | ⬜ | P0 | S | 1.10 |

---

## Tasks

### Task 1.1 — Project scaffold + complete CI

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: —

#### Description

Create the full repo scaffold **and the complete CI** in one foundation task, so every subsequent PR (all phases, 100%-agent-built) is gated by a green pipeline from day one. Scaffold: `package.json` (scope `@bymax-one`, version `0.1.0`, zero `dependencies`, required + optional peer deps, canonical scripts + `check:no-prisma`), the `tsconfig.*` family, `tsup.config.ts` (3 entries), the jest configs (`passWithNoTests: true`, + jsdom for react), `stryker.config.json` (high 100 / low 95 / break 95), eslint flat config, `scripts/check-size.mjs` (server 30KB / shared 4KB / react 8KB brotli), and the empty `src/{server,shared,react}/index.ts`. CI: the four GitHub Actions workflows mirrored from `bymax-one/nest-cache`, made **incremental-safe** (pass at every phase, no later-phase dependency).

#### Acceptance criteria

- [x] `package.json`: name `@bymax-one/nest-notification`, version `0.1.0`, `type: module`, `sideEffects: false`, `"dependencies": {}`, 3 `exports` subpaths, all peer deps optional, scripts incl. `check:no-prisma`, `test:cov`, `test:e2e`
- [x] `tsconfig.json` strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), aliases for 3 subpaths
- [x] `tsup.config.ts` with 3 entries (server node24, shared zero-extern, react es2022 external `react`), `dts: true`, `format: ['esm','cjs']`
- [x] jest configs set **`passWithNoTests: true`**; coverage 100% via `collectCoverageFrom` over implemented `src/**` (excludes `*.spec.ts`, `index.ts`); `stryker.config.json` high 100 / low 95 / break 95
- [x] **`.github/workflows/ci.yml`** — `concurrency` + `permissions: contents: read`; `verify` job (Node 24, pnpm 10.8.1): dependency-review (PR, non-blocking), `typecheck`, `lint`, `check:no-prisma`, `test:cov`, `test:e2e`, `build`, build-output integrity (loops `server`/`shared`/`react` × `mjs`/`cjs`/`d.ts` — tolerates the empty react bundle), `size`, coverage artifact upload
- [x] **`codeql.yml`** (javascript-typescript, security-extended, PR+push+weekly), **`scorecard.yml`** (push+weekly, SARIF upload, `publish_results`), **`release.yml`** (tag `v*.*.*`-driven only: OIDC `--provenance` publish behind an `npm-publish` environment, tag↔version guard, `prepublishOnly`, release-shape gates incl. `size` + dogfood smoke, CHANGELOG-extract via env var)
- [x] **Incremental-safe proof:** with empty sources + zero tests, `pnpm install && pnpm typecheck && pnpm lint && pnpm check:no-prisma && pnpm test:cov && pnpm test:e2e && pnpm build && pnpm size` is all green (the CI `verify` job would pass)
- [x] **Mutation is NOT in `ci.yml`** (pre-release gate only); `release.yml` never runs during phases
- [x] No `test/e2e/.gitkeep` / placeholder files anywhere

#### Files to create / modify

- `package.json`, `tsconfig.json`, `tsconfig.build.json`, `tsconfig.server.json`, `tsconfig.e2e.json`, `tsconfig.jest.json`, `tsup.config.ts`
- `jest.config.ts`, `jest.coverage.config.ts`, `jest.e2e.config.ts`, `jest.stryker.config.ts`, `stryker.config.json`
- `eslint.config.mjs`, `.prettierrc`, `.gitignore`, `.npmignore`, `scripts/check-size.mjs`
- `.github/workflows/{ci,codeql,scorecard,release}.yml`
- `src/server/index.ts`, `src/shared/index.ts`, `src/react/index.ts` (placeholder comment only)

#### Agent prompt

````
You are a senior NestJS/TypeScript library engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — a public, MIT, multi-tenant, multi-channel notification
library for NestJS (email + OTP in v0.1; SMS/push v0.2). Zero runtime deps (everything via optional
peer deps), Node 24+, NestJS 11, pnpm, 3 subpaths (`.` server, `./shared` zero-dep types, `./react`
hooks). Successor of bymax-fitness `_commons_/notification/` with the Prisma coupling dissolved.

CURRENT PHASE: 1 (Foundation) — Task 1.1 of 11 (FIRST)

PRECONDITIONS
- Empty repo with only `docs/`. Sibling config template lives at `bymax-one/nest-auth`.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.1 (scaffold detail incl. the package.json field list) + Appendix C
  (reference configs — copy from `bymax-one/nest-auth`, adapt to 3 subpaths).
- `docs/technical_specification.md` §3.2 (subpath exports) + §13 (peer deps).
- `bymax-one/nest-cache/.github/workflows/{ci,codeql,scorecard,release}.yml` (gold-standard, Redis-aware
  CI to mirror) — adapt to this lib (add `check:no-prisma`; e2e uses `ioredis-mock`, no Docker/testcontainers).

TASK
Create the full project scaffold (configs + empty source entry points) AND the complete, incremental-safe
CI. The CI must be green from THIS first PR and at every later phase — no dependency on later-phase
resources. No library code yet.

DELIVERABLES
1. `package.json` — name `@bymax-one/nest-notification`, version `0.1.0`, `type: module`,
   `sideEffects: false`, `"dependencies": {}`, 3 `exports` subpaths (types/import/require), required
   peers (`@nestjs/common`/`@nestjs/core` ^11, `reflect-metadata` ^0.2), all other peers optional via
   `peerDependenciesMeta`, scripts (build/lint/test/test:cov/test:e2e/test:cov:all/mutation/typecheck/
   size/clean/prepublishOnly/release) + `check:no-prisma` (`grep -r "@prisma/client" src/ && exit 1 || exit 0`),
   `engines.node >=24`, `publishConfig.access public`.
2. `tsconfig.*` family (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), `tsup.config.ts`
   (3 entries), jest configs with **`passWithNoTests: true`** (+ `jest-environment-jsdom` for `react/*`) and
   `coverageThreshold` 100% over `collectCoverageFrom: ['src/**/*.ts','!**/*.spec.ts','!**/index.ts']`,
   `stryker.config.json` (high 100 / low 95 / break 95), `eslint.config.mjs` (flat v9, keep
   eslint-plugin-security/import), `.prettierrc`, `.gitignore`, `.npmignore`, `scripts/check-size.mjs`
   (budgets 30/4/8 KB brotli).
3. `.github/workflows/` — mirror `bymax-one/nest-cache`, adapted:
   - `ci.yml`: `on` push/PR(main)+dispatch; `concurrency`; `permissions: contents: read`; one `verify`
     job (Node 24, pnpm 10.8.1, `pnpm install --frozen-lockfile`): dependency-review (PR, `continue-on-error`),
     `typecheck`, `lint`, `check:no-prisma`, `test:cov`, `test:e2e`, `build`, build-output integrity
     (loop `server shared react` × `mjs cjs d.ts`; the empty react bundle still emits — keep it in the loop),
     `size`, upload coverage artifact. **No mutation step.**
   - `codeql.yml` (javascript-typescript, `security-extended`, push/PR/weekly), `scorecard.yml`
     (push/weekly, SARIF upload + `publish_results: true`, least-priv job perms), `release.yml`
     (tag `v*.*.*`-driven + dispatch ONLY; `npm-publish` environment; tag↔`package.json` version guard;
     `prepublishOnly`; release-shape gates `pnpm size` + `node scripts/dogfood-smoke-test.mjs`; OIDC
     `pnpm publish --provenance --no-git-checks`; CHANGELOG extract passed via env var, `gh release create`).
4. `src/{server,shared,react}/index.ts` with a placeholder comment only.

Constraints:
- **CI must pass with empty sources and zero tests** (`passWithNoTests`, coverage over implemented files,
  size on small bundles). Mutation runs ONLY pre-release. `release.yml` must not run during phases (tag-gated).
- Do NOT create `.gitkeep` or empty-dir placeholders (Bymax rule). `tsup` has 3 entries (nest-auth has 5 —
  do not copy verbatim). English-only, timeless comments (no Phase/Task refs in YAML).

Verification:
- `pnpm install` (no missing-peer warnings), then `pnpm typecheck && pnpm lint && pnpm check:no-prisma &&
  pnpm test:cov && pnpm test:e2e && pnpm build && pnpm size` — ALL green on empty sources (this is exactly
  what `ci.yml`'s `verify` job runs). Build emits `.mjs/.cjs/.d.ts` for all 3 subpaths.
- `actionlint` (or a YAML lint) is clean on the 4 workflows; `release.yml` triggers only on tags.

Completion Protocol:
1. Set status ✅ (block + index). 2. Tick acceptance criteria. 3. Update the index row + progress `1/11`.
4. Update the Phase 1 row in `docs/development_plan.md`. 5. Append to the completion log:
`- 1.1 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.2 — Shared types + constants (`src/shared`)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.1

#### Description

Define the zero-dependency public types and constants importable from the frontend: `OtpPurpose`, `NotificationChannel`, `NotificationErrorResponse`, `NOTIFICATION_ERROR_CODES` (21 codes), `DEFAULT_TTLS`.

#### Acceptance criteria

- [x] `OtpPurpose` is `'email_verification' | 'password_reset' | 'mfa_oob' | 'phone_verification' | 'magic_link' | (string & {})` with JSDoc noting `phone_verification` = SMS-delivered (v0.2/manual) and `magic_link` = long token via URL
- [x] `NOTIFICATION_ERROR_CODES` lists all **21** codes (incl. `OTP_EMAIL_DELIVERY_NOT_CONFIGURED`), `as const`
- [x] `DEFAULT_TTLS` carries rationale per constant
- [x] No `@nestjs`/`node:` import in `src/shared` (`grep` returns empty); `import type` used for types
- [x] `import('@bymax-one/nest-notification/shared')` resolves in a fixture; bundle < 4 KB brotli
- [x] Coverage 100%

#### Files to create / modify

- `src/shared/types/{otp-purpose,notification-channel,notification-error}.types.ts`
- `src/shared/constants/{error-codes,default-ttls}.ts`
- `src/shared/index.ts`

#### Agent prompt

````
You are a senior TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. The `./shared` subpath is a
zero-dependency surface importable from both backend and frontend (e.g. to match an error code in UI).

CURRENT PHASE: 1 (Foundation) — Task 1.2 of 11

PRECONDITIONS
- Task 1.1 done: scaffold + empty `src/shared/index.ts`.

REQUIRED READING (only these):
- `docs/technical_specification.md` §16.1 (`./shared` exports) + §11.4 (`NOTIFICATION_ERROR_CODES`).
- `docs/development_plan.md` §2.2.

TASK
Implement the shared types + constants (pure types/constants, zero runtime deps).

DELIVERABLES
1. `types/otp-purpose.types.ts` — `OtpPurpose` discriminated string with the `(string & {})` escape
   hatch; JSDoc clarifying `phone_verification` (SMS, v0.2/manual) and `magic_link` (URL token).
2. `types/notification-channel.types.ts` — `NotificationChannel = 'email'|'otp'|'sms'|'push'`.
3. `types/notification-error.types.ts` — `NotificationErrorResponse { error: { code; message; details: Record<string,unknown>|null } }`.
4. `constants/error-codes.ts` — `NOTIFICATION_ERROR_CODES` (all 21 codes, byte-identical to the server
   catalog) + `NotificationErrorCode` type.
5. `constants/default-ttls.ts` — `DEFAULT_TTLS` (`as const`, rationale per value).
6. `index.ts` — barrel re-exporting all of the above.

Constraints:
- No `@nestjs`/`node:` imports; `import type` for types; `as const` for constants; English-only.

Verification:
- `pnpm build` then `node -e "import('./dist/shared/index.mjs').then(m=>console.log(Object.keys(m).sort()))"`
  → `['DEFAULT_TTLS','NOTIFICATION_ERROR_CODES']`. `grep -r "@nestjs\|node:" src/shared/` empty.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `2/11`. 4. Update Phase 1 row in
the plan. 5. Append `- 1.2 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.3 — Main interfaces

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.1, 1.2

#### Description

Declare every interface the consumer can implement or reference: `IEmailProvider`, `IOtpStorage` (with the **atomic** `consumeAttempt`/`tryAcquireCooldown`/`clearCooldown`), `IEmailTemplateRenderer`, `INotificationLogRepository`, the `ISmsProvider`/`IPushProvider` v0.2 sketches, the module options (`BymaxNotificationModuleOptions` + `NotificationRequest` + channel option sub-interfaces incl. `maxAttachmentBytes`/`maskRecipient`), and the `OtpVerifyResult` union (no `expired`).

#### Acceptance criteria

- [x] `IOtpStorage` declares `set`, `get`, `consumeAttempt`, `update`, `delete`, `tryAcquireCooldown`, `getCooldown`, `clearCooldown`, `isConfigured`, `name` — with the "MUST be atomic" contract on `consumeAttempt`/`tryAcquireCooldown` and the "no recipient normalization" note
- [x] `consumeAttempt` return = `{ status: 'not_found' } | { status: 'max_attempts' } | { status: 'ok'; entry: OtpEntry }`
- [x] `OtpVerifyResult` = `{valid:true} | {valid:false; reason:'not_found'} | {…'max_attempts'} | {…'invalid_code'; remainingAttempts}` (no `'expired'`)
- [x] `tenantIdResolver?: (req: NotificationRequest) => string | Promise<string>` (not `express.Request`)
- [x] `EmailChannelOptions.maxAttachmentBytes?`, `AuditOptions.maskRecipient?` present
- [x] `ISmsProvider`/`IPushProvider` carry `@since v0.2 (planned)`; JSDoc states the Prisma-dissolution on `IOtpStorage`
- [x] No `any`; `pnpm typecheck` passes

#### Files to create / modify

- `src/server/interfaces/{email-provider,otp-storage,email-template-renderer,notification-log-repository,sms-provider,push-provider,notification-module-options}.interface.ts`
- `src/server/interfaces/index.ts`

#### Agent prompt

````
You are a senior TypeScript/NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. All persistence and delivery
go through TypeScript interfaces; reference adapters (Resend, Redis) come later. The OTP storage
contract is the core security surface.

CURRENT PHASE: 1 (Foundation) — Task 1.3 of 11

PRECONDITIONS
- Tasks 1.1–1.2 done: scaffold + shared types.

REQUIRED READING (only these):
- `docs/technical_specification.md` §5 (all provider/storage/renderer/log contracts — copy the exact
  signatures, incl. the atomic `consumeAttempt`/`tryAcquireCooldown`/`clearCooldown` and the contract
  bullets) + §4.1 (`BymaxNotificationModuleOptions`, `NotificationRequest`, `OtpPurposeConfig`).
- `docs/development_plan.md` §2.3.

TASK
Declare all interfaces as TypeScript-only contracts with complete JSDoc.

DELIVERABLES
1. `email-provider.interface.ts` — `IEmailProvider` (`send`/`isConfigured`/`name`), `EmailSendOptions`,
   `EmailSendResult`. JSDoc: never log body, never leak credentials.
2. `otp-storage.interface.ts` — `IOtpStorage` with the 8 methods above + `OtpEntry`, `OtpVerifyResult`
   (no `'expired'`), and the `consumeAttempt` return union. JSDoc MUST state: `consumeAttempt`/
   `tryAcquireCooldown` MUST be atomic; the lib does NOT normalize `recipient`; this dissolves the
   Prisma coupling.
3. `email-template-renderer.interface.ts` — `IEmailTemplateRenderer` (`render`/`hasTemplate`/`name`), `RenderedEmail`.
4. `notification-log-repository.interface.ts` — `INotificationLogRepository` (`create`/`name`), `NotificationLogEntry` (verb union incl. `cooldown_blocked`/`max_attempts_exceeded`).
5. `sms-provider.interface.ts` / `push-provider.interface.ts` — `@since v0.2 (planned)` sketches.
6. `notification-module-options.interface.ts` — `BymaxNotificationModuleOptions`, `NotificationRequest`,
   `GlobalOptions` (`tenantIdResolver: (req: NotificationRequest)=>…`), `EmailChannelOptions`
   (+`maxAttachmentBytes?`), `OtpChannelOptions`, `OtpPurposeConfig`, `SmsChannelOptions`/`PushChannelOptions`
   (v0.2), `AuditOptions` (+`maskRecipient?`), `BymaxNotificationModuleAsyncOptions`, `…OptionsFactory`.
7. `index.ts` barrel (type re-exports only, incl. `NotificationRequest`).

Constraints:
- No `any`; `readonly` on immutable props; provider/storage accept `instance | class` per spec §4.6.
- English-only, timeless comments.

Verification:
- `pnpm typecheck`; `grep -n ': any\b' src/server/interfaces/` empty; `OtpVerifyResult` narrows on `reason`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `3/11`. 4. Update Phase 1 row.
5. Append `- 1.3 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.4 — Injection tokens + error catalog + `NotificationException` + default constants

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.2, 1.3

#### Description

Define the 7 `Symbol` injection tokens, the `NOTIFICATION_ERROR_DEFINITIONS` catalog (21 codes with HTTP status + message, incl. `OTP_EMAIL_DELIVERY_NOT_CONFIGURED`), the `NotificationException` (payload `{ error: { code, message, details } }`), `NOTIFICATION_PURPOSES`, and the `DEFAULT_*_OPTIONS` constants.

#### Acceptance criteria

- [x] 7 unique `Symbol` tokens
- [x] `NOTIFICATION_ERROR_DEFINITIONS` covers all 21 codes; the code strings match `shared/constants/error-codes.ts` **byte-for-byte** (CI/script gate)
- [x] `OTP_EMAIL_DELIVERY_NOT_CONFIGURED` present (500)
- [x] `NotificationException` produces the exact `NotificationErrorResponse` shape; accepts `overrideStatus`/`overrideMessage`; error lookups via `Map.get` (no object-injection)
- [x] `DEFAULT_OTP_OPTIONS` includes `consumeOnVerify:false`; `DEFAULT_EMAIL_OPTIONS` includes `maxAttachmentBytes: 10_485_760`; `DEFAULT_AUDIT_OPTIONS` includes `swallowErrors:true`
- [x] Coverage 100% on `notification-exception.ts`

#### Files to create / modify

- `src/server/bymax-notification.constants.ts`
- `src/server/constants/{notification-purposes,default-options.constants}.ts`
- `src/server/errors/{notification-error-codes,notification-exception}.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Error responses follow the
`@bymax-one/nest-auth` shape `{ error: { code, message, details } }`; consumers match on `code`.

CURRENT PHASE: 1 (Foundation) — Task 1.4 of 11

PRECONDITIONS
- Tasks 1.2–1.3 done: shared error codes + interfaces.

REQUIRED READING (only these):
- `docs/technical_specification.md` §11.2 (the 21-row error table) + §4.4 (injection tokens).
- `docs/development_plan.md` §2.4.

TASK
Define injection tokens, the error catalog + exception, purposes, and default-options constants.

DELIVERABLES
1. `bymax-notification.constants.ts` — 7 `Symbol` tokens (OPTIONS, EMAIL_PROVIDER, OTP_STORAGE,
   SMS_PROVIDER, PUSH_PROVIDER, TEMPLATE_RENDERER, LOG_REPOSITORY).
2. `errors/notification-error-codes.ts` — `NOTIFICATION_ERROR_DEFINITIONS` (21 entries: code + HttpStatus
   + message, incl. `OTP_EMAIL_DELIVERY_NOT_CONFIGURED` = 500). Re-export `NOTIFICATION_ERROR_CODES` from shared.
3. `errors/notification-exception.ts` — `NotificationException extends HttpException` with `code`,
   `(key, details?, overrideStatus?, overrideMessage?)`; lookups via `Map.get(key)` (no object-injection).
4. `constants/notification-purposes.ts` — `NOTIFICATION_PURPOSES` + `CanonicalNotificationPurpose`.
5. `constants/default-options.constants.ts` — `DEFAULT_GLOBAL_OPTIONS`, `DEFAULT_OTP_OPTIONS`
   (`consumeOnVerify:false`, `perPurpose:{}`), `DEFAULT_EMAIL_OPTIONS` (`maxAttachmentBytes:10_485_760`,
   `defaultTags:[]`), `DEFAULT_AUDIT_OPTIONS` (`swallowErrors:true`).

Constraints:
- Server error code strings byte-identical to shared. English-only, timeless comments.

Verification:
- `pnpm typecheck`; a script confirms server `NOTIFICATION_ERROR_DEFINITIONS` codes == shared
  `NOTIFICATION_ERROR_CODES` values (sorted, equal).

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `4/11`. 4. Update Phase 1 row.
5. Append `- 1.4 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.5 — Options validation + resolution

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.3, 1.4

#### Description

Implement `validate-options.ts` (clear messages; rejects `sms`/`push` in v0.1) and `resolved-options.ts` (`ResolvedNotificationOptions` with `maxAttachmentBytes`, `maskRecipient`, and a `resolveForPurpose(purpose)` helper; deep-frozen; channel sections omitted when unconfigured).

#### Acceptance criteria

- [ ] `validateOptions` rejects: no channel; email missing `provider`/`defaultFrom`/malformed from; otp missing `storage`; `defaultLength` ∉ [1,32] (→ `OTP_INVALID_LENGTH`); bad `codeType`; `ttl<=0`; `maxAttempts<1`; `cooldown<0`; `sms`/`push` configured (v0.1); audit missing `repository`
- [ ] `resolveOptions` deep-freezes the result; omits sections for unconfigured channels; `otp.resolveForPurpose(p)` returns `perPurpose[p]` merged over otp defaults; `email.maxAttachmentBytes` defaults to 10 MiB; `audit.maskRecipient` defaults to identity
- [ ] Coverage 100% on both files

#### Files to create / modify

- `src/server/config/{validate-options,resolved-options,default-options}.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Options are validated with
clear messages (no zod/class-validator) and resolved to a frozen `ResolvedNotificationOptions`
injected under `BYMAX_NOTIFICATION_OPTIONS`.

CURRENT PHASE: 1 (Foundation) — Task 1.5 of 11

PRECONDITIONS
- Tasks 1.3–1.4 done: interfaces + constants/exception.

REQUIRED READING (only these):
- `docs/technical_specification.md` §4.5 (`ResolvedNotificationOptions` incl. `resolveForPurpose`).
- `docs/development_plan.md` §2.5.

TASK
Implement options validation + resolution.

DELIVERABLES
1. `validate-options.ts` — `validateOptions(options): void` with the rejection rules above (rejects
   `sms`/`push` in v0.1 with an explanatory "planned for v0.2" message).
2. `resolved-options.ts` — `ResolvedNotificationOptions` (global always present; email/otp/audit
   optional, all defaults applied; `otp.resolveForPurpose(purpose)`; `email.maxAttachmentBytes`;
   `audit.maskRecipient`), `resolveOptions(options): Readonly<…>`, recursive `deepFreeze`.

Constraints:
- No zod/class-validator. Omit unconfigured channel sections (enables `if (resolved.email)` narrowing).
- English-only, timeless comments.

Verification:
- `pnpm test src/server/config/`; mutating a resolved object throws (deep-frozen).

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `5/11`. 4. Update Phase 1 row.
5. Append `- 1.5 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.6 — No-op providers + minimal `DefaultTemplateRenderer`

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.3

#### Description

Implement `NoOpEmailProvider` (logs `to`+`subject` only, never the body), `NoOpNotificationLogRepository` (silent discard), and the minimal `DefaultTemplateRenderer` that HTML-escapes interpolated variables **in the html body only** (not subject/text), with `en` fallback.

#### Acceptance criteria

- [ ] `NoOpEmailProvider.send()` returns a `messageId` and NEVER logs `html`/`text`
- [ ] `NoOpNotificationLogRepository.create()` resolves to nothing (idempotent)
- [ ] `DefaultTemplateRenderer.render` applies `escapeHtml` only to the html body (`fill(subject,false)`, `fill(html,true)`, `fill(text,false)`); falls back to `en`; throws with the template name when missing
- [ ] Coverage 100% on all three files

#### Files to create / modify

- `src/server/providers/{no-op-email.provider,no-op-notification-log.repository,default-template-renderer}.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. The default renderer must not
become an XSS or PII vector: escape only the html body; never log message bodies.

CURRENT PHASE: 1 (Foundation) — Task 1.6 of 11

PRECONDITIONS
- Task 1.3 done: interfaces.

REQUIRED READING (only these):
- `docs/technical_specification.md` §5.1.6 (NoOpEmailProvider), §5.5.1 (DefaultTemplateRenderer — the
  `fill(str, escape)` html-only escaping), §5.6.1 (NoOp log repo).
- `docs/development_plan.md` §2.6.

TASK
Implement the no-op providers + the minimal renderer (refined further in Phase 3).

DELIVERABLES
1. `no-op-email.provider.ts` — logs `to`+`subject` via `logger.debug`, NEVER body; returns `{ messageId: 'noop-…' }`.
2. `no-op-notification-log.repository.ts` — `create()` is a silent no-op.
3. `default-template-renderer.ts` — `fill(str, escape)` replaces `{{var}}`; escape ONLY when `escape===true`;
   apply `fill(subject,false)`, `fill(html,true)`, `fill(text,false)`; `${name}::${locale}` lookup with
   `::en` fallback; throws `Template not found: …` when missing; `escapeHtml` covers `& < > " '`.

Constraints:
- Subject/text are NOT HTML contexts — do not escape them. English-only, timeless comments.

Verification:
- `pnpm test src/server/providers/` — a `<script>` value is escaped in html but raw in subject/text;
  NoOp logger spy never sees the body.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `6/11`. 4. Update Phase 1 row.
5. Append `- 1.6 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.7 — Crypto utils (`hash`, `code-generator`, `safeCompare`)

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.4

#### Description

Implement the security-critical utilities: `hashTenantRecipient` (sha256), `generateOtpCode` (every type built **digit/char-by-char** — no `10**length` overflow), and `safeCompare` (length-guard then `timingSafeEqual`).

#### Acceptance criteria

- [ ] `hashTenantRecipient('a','b')` = 64-hex, deterministic, order-sensitive
- [ ] `generateOtpCode(6,'numeric')` = 6 digits (leading zeros preserved); `generateOtpCode(20,'numeric')` returns 20 digits without throwing (overflow regression); alpha/alphanumeric exclude I/O/0/1; length ∉ [1,32] throws `OTP_INVALID_LENGTH`
- [ ] `safeCompare` returns true/false correctly and returns `false` (no throw) on length mismatch
- [ ] Coverage **100%** on all 3 files; mutation 100% (no surviving non-equivalent mutants)

#### Files to create / modify

- `src/server/utils/{hash,code-generator,timing-safe-compare}.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript security engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. These utils are the security
core: CSPRNG codes, constant-time compare, PII-free key hashing.

CURRENT PHASE: 1 (Foundation) — Task 1.7 of 11

PRECONDITIONS
- Task 1.4 done: `NotificationException`.

REQUIRED READING (only these):
- `docs/technical_specification.md` §6.2.1 (code generator — digit-by-digit, no `10**length`),
  §6.2.2 (`safeCompare` — length-guard), §10.2 (key hashing).
- `docs/development_plan.md` §2.7.

TASK
Implement hash, code-generator, and safeCompare.

DELIVERABLES
1. `hash.ts` — `hashTenantRecipient(tenantId, recipient) = sha256(`${tenantId}:${recipient}`)` hex.
2. `code-generator.ts` — `generateOtpCode(length, type)`: validate integer length ∈ [1,32] (else
   `NotificationException('OTP_INVALID_LENGTH', …)`); build EVERY type char-by-char from its charset
   (`NUMERIC='0123456789'`, `ALPHA` excl. I/O, `ALPHANUMERIC` excl. 0/1/I/O); per-char `randomInt(0, len)`.
   Do NOT use `randomInt(0, 10**length)`.
3. `timing-safe-compare.ts` — `safeCompare(expected, actual)`: `Buffer.from(...,'utf8')`; if lengths
   differ return false; else `timingSafeEqual`.

Constraints:
- `node:crypto` only; never `Math.random`. `Buffer.from(str,'utf-8')` explicit encoding. English-only.

Verification:
- `pnpm test src/server/utils/` at 100%; property tests for leading zeros + forbidden chars +
  `generateOtpCode(20,'numeric')` no-throw.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `7/11`. 4. Update Phase 1 row.
5. Append `- 1.7 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.8 — Dynamic module (synchronous `forRoot()`)

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.5, 1.6

#### Description

Implement `BymaxNotificationModule.forRoot()` with conditional provider registration (only configured channels), the `resolveAsProvider` instance-vs-class helper, the audit/renderer fallbacks, and a `forRootAsync` stub (completed in Phase 4). Service providers are added in Phase 2 — leave a timeless TODO.

#### Acceptance criteria

- [ ] `forRoot({email})` returns a valid global `DynamicModule`; only configured channels register their tokens
- [ ] Audit defaults to `NoOpNotificationLogRepository`; renderer defaults to `DefaultTemplateRenderer`
- [ ] `resolveAsProvider`: class → `useClass`, instance → `useValue`
- [ ] Bootstrap log `BYMAX_NOTIFICATION_MODULE_BOOTSTRAP_OK` with active channels
- [ ] No `// TODO Phase N` in code — use a timeless TODO (`// register EmailService once implemented`)
- [ ] Coverage 100% on the module

#### Files to create / modify

- `src/server/bymax-notification.module.ts`

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib using the dynamic-module
pattern with opt-in channel registration and Symbol DI tokens.

CURRENT PHASE: 1 (Foundation) — Task 1.8 of 11

PRECONDITIONS
- Tasks 1.5–1.6 done: validate/resolve + no-op providers.

REQUIRED READING (only these):
- `docs/technical_specification.md` §4.6 (forRoot + instance-vs-class rule).
- `docs/development_plan.md` §2.8.

TASK
Implement `forRoot()` with conditional registration; stub `forRootAsync`.

DELIVERABLES
1. `forRoot(options)`: `validateOptions` → `resolveOptions` → build providers: `BYMAX_NOTIFICATION_OPTIONS`
   (useValue resolved); audit (resolved → repo, else NoOp); if `resolved.email` → email provider +
   renderer (or DefaultTemplateRenderer); if `resolved.otp` → otp storage. Emit bootstrap log. Return
   `{ module, global:true, providers, exports }`.
2. `resolveAsProvider(token, valueOrClass)`: detect class via prototype → `useClass`, else `useValue`.
3. `forRootAsync(asyncOptions)`: Phase-1 stub wiring only the options provider via `useFactory`+`inject`.

Constraints:
- Service providers (EmailService/OtpService) are added in §3.7 — leave a TIMELESS TODO comment, never
  a `Phase N` reference. English-only.

Verification:
- `pnpm test src/server/bymax-notification.module.spec.ts` — without `otp`, `BYMAX_NOTIFICATION_OTP_STORAGE`
  is not provided; `forRoot({})` throws (validation runs first).

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `8/11`. 4. Update Phase 1 row.
5. Append `- 1.8 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.9 — Server barrel exports

- **Status**: ⬜ Not started
- **Priority**: P1
- **Size**: S
- **Depends on**: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8

#### Description

Expose the public server API in `src/server/index.ts`: module, 7 tokens, `NOTIFICATION_PURPOSES`, interface types, module-options types (incl. `NotificationRequest`), resolved-options types, reference providers, errors, and a convenience re-export from `../shared`.

#### Acceptance criteria

- [ ] All public symbols exported; no `_internal*` leakage
- [ ] `pnpm build` emits `dist/server/index.{mjs,cjs,d.ts}`; `Object.keys` lists the expected set
- [ ] `import('@bymax-one/nest-notification').BymaxNotificationModule.forRoot({...})` works in a fixture

#### Files to create / modify

- `src/server/index.ts`

#### Agent prompt

````
You are a senior TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Only documented symbols are
public; internals (interceptors, dto, crypto utils) stay internal until needed.

CURRENT PHASE: 1 (Foundation) — Task 1.9 of 11

PRECONDITIONS
- Tasks 1.3–1.8 done.

REQUIRED READING (only these):
- `docs/technical_specification.md` §3.3 (server exports list).
- `docs/development_plan.md` §2.9.

TASK
Write the server barrel.

DELIVERABLES
1. `src/server/index.ts` — export `BymaxNotificationModule`; the 7 tokens; `NOTIFICATION_PURPOSES`
   (+ type); all interface types (incl. `NotificationRequest`); module-options + resolved-options types;
   reference providers (`NoOpEmailProvider`, `NoOpNotificationLogRepository`, `DefaultTemplateRenderer`);
   `NotificationException`, `NOTIFICATION_ERROR_DEFINITIONS`, `NotificationErrorKey`,
   `NOTIFICATION_ERROR_CODES`; convenience re-exports from `../shared`.

Constraints:
- Services/utilities/Resend/Redis are added in the Phase 2 barrel — not here. English-only.

Verification:
- `pnpm build` then `node -e "import('./dist/server/index.mjs').then(m=>console.log(Object.keys(m).sort()))"`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `9/11`. 4. Update Phase 1 row.
5. Append `- 1.9 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.10 — Tests for Phase 1

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9

#### Description

Write unit tests reaching **100% coverage** on every implemented file: validate/resolve, exception, hash, code-generator (incl. long-numeric regression), safeCompare, default renderer (escape scope), no-op providers, module, and the shared error-codes parity.

#### Acceptance criteria

- [ ] `pnpm test:cov` = **100% global** and per file (validate-options, resolved-options, notification-exception, hash, code-generator, timing-safe-compare, bymax-notification.module, default-template-renderer)
- [ ] code-generator: leading-zeros property test + `generateOtpCode(20,'numeric')` no-throw; safeCompare: length-mismatch returns false without throwing; renderer: escape html-only
- [ ] `clearMocks`/`restoreMocks` honored; `pnpm test` zero failures

#### Files to create / modify

- `src/server/config/*.spec.ts`, `src/server/errors/notification-exception.spec.ts`, `src/server/utils/*.spec.ts`, `src/server/providers/*.spec.ts`, `src/server/bymax-notification.module.spec.ts`, `src/shared/constants/error-codes.spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on the nest-notification project. Use /bymax-quality:tdd
or the `tester` skill.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Bymax standard: 100% coverage
per file; crypto utils additionally at 100% mutation.

CURRENT PHASE: 1 (Foundation) — Task 1.10 of 11

PRECONDITIONS
- Tasks 1.3–1.9 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.10 (the per-file test-case lists).

TASK
Write Phase 1 unit tests to 100% coverage.

DELIVERABLES
- Specs for validate-options (all rejection cases), resolved-options (defaults/omit/deep-freeze/
  resolveForPurpose), notification-exception (every key, override status/message, details default),
  hash, code-generator (incl. 20-digit no-throw + forbidden chars), timing-safe-compare (length
  mismatch no-throw), default-template-renderer (escape html-only, en fallback, not-found), no-op
  providers (never log body), module (conditional registration), shared/server error-code parity.

Constraints:
- `Test.createTestingModule` for the module; AAA pattern; one descriptive `it()` per case. English-only.

Verification:
- `pnpm test:cov` = 100% global + per file.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `10/11`. 4. Update Phase 1 row.
5. Append `- 1.10 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 1.11 — Phase 1 validation

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: S
- **Depends on**: 1.10

#### Description

Run all gates, the error-codes sync gate (server vs shared), and a smoke test that builds the module with a `NoOpEmailProvider` and asserts the resolved shape + shared exports.

#### Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size && pnpm check:no-prisma` all green
- [ ] Error-codes sync gate passes (server `NOTIFICATION_ERROR_DEFINITIONS` codes == shared `NOTIFICATION_ERROR_CODES`)
- [ ] Smoke: `forRoot({ email:{ provider:new NoOpEmailProvider(), defaultFrom:'noreply@example.com' } })` → `module.global===true`, expected provider count, `DEFAULT_TTLS`/`NOTIFICATION_PURPOSES`/`NOTIFICATION_ERROR_CODES` resolve
- [ ] No file > 800 lines, no function > 50 lines

#### Files to create / modify

- (validation only — no new source)

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 1 (Foundation) — Task 1.11 of 11 (LAST)

PRECONDITIONS
- Tasks 1.1–1.10 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §2.11.

TASK
Run the full Phase 1 gate, the error-codes sync gate, and the smoke test.

DELIVERABLES
- All gate commands green; the sync gate script; the smoke test described in §2.11.

Constraints:
- Run `/bymax-quality:code-review` and apply findings before closing. English-only.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size && pnpm check:no-prisma`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `11/11`. 4. Mark the Phase 1 row ✅
in `docs/development_plan.md`. 5. Append `- 1.11 ✅ <YYYY-MM-DD> — <summary>`.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 1.1 ✅ 2026-06-19 — Scaffold + incremental-safe CI: package.json (zero deps, 3 subpaths, optional peers), tsconfig family, tsup (3 entries), jest×4, stryker, eslint flat, check-size (30/4/8 KB), check:no-prisma, ci/codeql/scorecard/release workflows. All gates green on empty sources.
- 1.2 ✅ 2026-06-19 — Shared subpath: `OtpPurpose`/`NotificationChannel`/`NotificationErrorResponse` types, the 21-code `NOTIFICATION_ERROR_CODES`, `DEFAULT_TTLS`; zero NestJS/Node imports; 100% coverage.
- 1.3 ✅ 2026-06-19 — Interfaces: `IEmailProvider`, `IOtpStorage` (atomic `consumeAttempt`/`tryAcquireCooldown`/`clearCooldown`, Prisma-dissolution note), renderer, log repo, SMS/Push v0.2 sketches, module options (+`NotificationRequest`, async factory). Zero `any`.
- 1.4 ✅ 2026-06-19 — 7 Symbol DI tokens, the 21-entry `NOTIFICATION_ERROR_DEFINITIONS` (+`OTP_EMAIL_DELIVERY_NOT_CONFIGURED`, `Map`-based lookup), `NotificationException`, `NOTIFICATION_PURPOSES`, `DEFAULT_*_OPTIONS`. Server/shared parity asserted; 100% coverage.
