# Development Plan — @bymax-one/nest-notification

> **Version:** 1.1.0 (re-synced with audited spec)
> **Last updated:** 2026-06-20
> **Status:** Ready for execution
> **Reference spec:** [`docs/technical_specification.md`](./technical_specification.md) (spec rev 1.1.0)
> **Target engine:** NestJS 11 (server) + native Node 24 (`node:crypto`) + optional Redis 7
> **Derived documents:** `docs/tasks/phase-NN-<slug>.md` (Layer 3 — one file per phase, generated from this plan)

---

## Table of Contents

1. [Plan Overview](#1-plan-overview)
2. [Phase 1 — Foundation + IEmailProvider + IOtpStorage Interfaces](#2-phase-1--foundation--iemailprovider--iotpstorage-interfaces)
3. [Phase 2 — EmailService + OtpService](#3-phase-2--emailservice--otpservice)
4. [Phase 3 — Templating + Rate Limiting](#4-phase-3--templating--rate-limiting)
5. [Phase 4 — Multi-tenant + Audit Log](#5-phase-4--multi-tenant--audit-log)
6. [Phase 5 — Frontend (./react)](#6-phase-5--frontend-react)
7. [Phase 6 — Release v0.1.0](#7-phase-6--release-v010)
8. [Appendix A — Dependency Graph](#appendix-a--dependency-graph)
9. [Appendix B — Complexity Matrix](#appendix-b--complexity-matrix)
10. [Appendix C — Reference Configs](#appendix-c--reference-configs)
11. [Appendix D — Glossary](#appendix-d--glossary)
12. [Appendix E — Redis Key Strategy](#appendix-e--redis-key-strategy)

---

## 1. Plan Overview

### 1.1 Development strategy

The implementation follows the **TDD red-green-refactor** protocol with vertically sliced phases:
- Each phase delivers **usable functionality** — at the end of each phase, the lib can be installed in a NestJS fixture app and the implemented subset exercised
- **Tests precede implementation** in every file with non-trivial logic (services, providers, utils, interceptors)
- **Per-phase coverage gate**: **100% line/branch per implemented file** (Bymax testing standard), with extra mutation focus on critical paths (OTP generation, timing-safe comparison, key hashing, code redaction in audit)
- **Mutation testing** runs as a **pre-release** gate only (not on per-commit CI — Stryker takes 10-20 min); release gate is mutation score **≥ 95%, driven as close to 100% as achievable** (Stryker break 95, per the Bymax Code-Craft Standard) — surviving mutants are killed or documented as equivalent
- **Refactor pass** at the end of each phase, with `/bymax-quality:code-review` before marking the phase as done

The phase order respects the dependency graph (Appendix A): interfaces before services, reference providers alongside interfaces, templating after email, audit log at the end of backend, frontend and release closing.

### 1.2 Guiding principles

| Principle | Practical application |
|---|---|
| **TS strict, zero `any`** | Compiler in `strict: true`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Only punctual casts via `as never` in inherited NestJS error cases — always commented with the reason. |
| **JSDoc on every exported symbol** | Every `export` of class, function, interface, constant carries JSDoc with `@example` when applicable. |
| **English in code and comments** | Identifiers, internal messages, comments, JSDoc — all in English. Documentation (`docs/`) in English. |
| **Zero `dependencies`** | `package.json` ships `"dependencies": {}`. Everything via peer dep. Reduces supply chain. |
| **Zero Prisma coupling** | The lib NEVER imports `@prisma/client`. All persistence via interfaces (`IOtpStorage`, `INotificationLogRepository`). This is the **central dissolver** of the Prisma coupling a hand-rolled notification module would otherwise impose on its consumer. |
| **Dependency inversion** | Email providers (`IEmailProvider`), OTP storage (`IOtpStorage`), renderer (`IEmailTemplateRenderer`), audit (`INotificationLogRepository`) are all interfaces. The lib provides **reference adapters** (Resend, Redis, default interpolator, no-op log) without tying the consumer to them. |
| **Channel abstraction** | Each channel (email, OTP) has its own service + provider/storage. Adding SMS or Push in v0.2 does not touch existing channels. |
| **Opt-in features** | Only configured channels are registered as providers in the NestJS container. Enabling audit without configuring `INotificationLogRepository` is an initialization error. |
| **Native multi-tenant** | Every operation accepts `tenantId`. Redis keys use `sha256(tenantId:recipient)` to avoid PII leaking and cross-tenant collision. |
| **Security by default** | OTP codes generated via `crypto.randomInt` (built digit-by-digit, no `10**length` overflow). Comparison via length-guarded `crypto.timingSafeEqual`. Attempt increment is **atomic** (Redis Lua / single-threaded Map) and the resend cooldown is an **atomic `SET NX EX` lock** — otherwise `maxAttempts`/anti-resend are bypassable under concurrency. Codes NEVER logged in audit/console. |
| **Audit silent failure never crashes the main flow** | Audit log is fire-and-forget by default (`audit.swallowErrors: true`). Errors are logged (meta-log) but not propagated to the caller. |
| **`MODULE_ACTION_RESULT` log key pattern** | Even in tests — eases integration with `@bymax-one/nest-logger`. |
| **Clean Code sizing & SRP** | Functions ≤ 50 lines; files ≤ 800 lines (200–400 typical); one responsibility per file/function. Over the limit = a HIGH finding in `/bymax-quality:code-review` — split by responsibility. |
| **Official docs first (never from memory)** | Before using any library/framework/SDK/API/CLI, re-verify the current official docs (`mcp__context7__resolve-library-id` → `query-docs`, WebSearch fallback) and follow the Bymax pattern in `03 - Resources/<Stack>/`. Stacks evolve fast. |
| **Layered architecture & reuse** | Each file carries an `@fileoverview` + `@layer` header; reuse `@bymax-one/*` libs (single source of truth, never reimplement); DRY; barrels only when a symbol is both exported AND imported. |
| **Conventional Commits** | `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`. Drives the semver bump on release. |

### 1.3 Status legend

| Symbol | Meaning |
| --- | --- |
| 📋 | ToDo |
| 🔄 | In Progress |
| 👀 | Review |
| ✅ | Done |
| ⛔ | Blocked |
| 🟡 | Partial |

### 1.4 Progress

- **Overall progress:** 🔄 5 / 6 phases done (83%) — 47 / 49 tasks (96%)
- **Active phase:** **Phase 6** (Release v0.1.0) 🟡 Partial — tag + publish awaiting human sign-off
- **Blocked:** none

### 1.5 Phase dashboard

| ID | Phase | Status | Progress | Complexity | Last updated |
| --- | --- | --- | --- | --- | --- |
| 1 | [Foundation + Interfaces](./tasks/phase-01-foundation-interfaces.md) | ✅ Done | 11/11 | MEDIUM | 2026-06-20 |
| 2 | [EmailService + OtpService (atomic)](./tasks/phase-02-email-otp-services.md) | ✅ Done | 10/10 | HIGH | 2026-06-20 |
| 3 | [Templating + Rate Limiting](./tasks/phase-03-templating-rate-limiting.md) | ✅ Done | 8/8 | MEDIUM | 2026-06-20 |
| 4 | [Multi-tenant + Audit Log](./tasks/phase-04-multitenant-audit.md) | ✅ Done | 8/8 | MEDIUM | 2026-06-20 |
| 5 | [Frontend (`./react`)](./tasks/phase-05-frontend-react.md) | ✅ Done | 5/5 | MEDIUM | 2026-06-20 |
| 6 | [Release v0.1.0](./tasks/phase-06-release.md) | 🟡 Partial | 5/7 | MEDIUM | 2026-06-20 |
| | **Total** | 🔄 **5 / 6 phases** | **47 / 49 tasks** | — | — |

> Each phase links to its task file in [`docs/tasks/`](./tasks/) (one file per phase). Full per-phase detail is in §2–§7; dependency graph in Appendix A, complexity matrix in Appendix B.

> **Phase mapping to spec §14.** The spec slices the roadmap slightly differently (1 Email · 2 OTP · 3 Templating+Audit · 4 Shared+React · 5 Release). This plan keeps the same total scope but groups backend work into Phases 1–4, frontend into Phase 5, then makes the spec's **Release** (its Phase 5) this plan's final phase, **Phase 6**.

> **No time estimate** — this plan is intended for execution by AI agents. Duration in human days does not apply. Relative complexity per phase is in the dashboard above and detailed per sub-step in the [Complexity Matrix in Appendix B](#appendix-b--complexity-matrix). Use those signals to prioritize more careful human review on HIGH complexity phases.

### 1.6 Update protocol

When a phase or task changes state, keep the dashboard consistent:

1. Set the phase row's **Status** emoji + **Last updated** date and bump its **Progress** (`X/Y` tasks) in the §1.5 dashboard.
2. Recompute **Overall progress** (`N / 6` phases done + percentage, `M / 49` tasks) and update **Active phase** / **Blocked** in §1.4.
3. Mirror the per-task status inside the phase's task file (`docs/tasks/phase-NN-*.md` — Task index row + Completion log).
4. Never mark a phase ✅ while any §1.7 Done-criteria bullet is unmet — use 🟡 Partial until all are satisfied.
5. Commit the plan update with a `docs(plan): …` Conventional Commit (no `Co-Authored-By` trailer).

### 1.7 Global per-phase Done criteria

A phase is only marked **Done** when, **cumulatively**:

- [ ] `pnpm typecheck` passes without errors
- [ ] `pnpm lint` passes without warnings (no `eslint-disable`)
- [ ] `pnpm test:cov` passes with **100%** line/branch coverage on every file implemented in the phase
- [ ] `pnpm build` produces `dist/` with `.mjs`, `.cjs`, `.d.ts` for every declared subpath
- [ ] All sub-step acceptance criteria checked off
- [ ] JSDoc present on all new exports; every new file has an `@fileoverview` + `@layer` header
- [ ] Clean Code sizing respected (no function > 50 lines, no file > 800 lines)
- [ ] Official docs re-verified (context7) for every library touched this phase
- [ ] `git status` clean (commits made with Conventional Commits)
- [ ] `/bymax-quality:code-review` executed and findings applied
- [ ] Phase-specific smoke test passes on a NestJS fixture

### 1.8 Expected end file structure (after Phase 6)

The `nest-notification/` repo root directory mirrors the canonical layout of the sibling libs (`bymax-one/nest-auth`, `bymax-one/nest-cache`); the monorepo-level `bymax-one/EXTRACTION_ROADMAP.md §4` (outside this repo) is the original template:

```
nest-notification/
├── .github/workflows/      # ci.yml, codeql.yml, release.yml, scorecard.yml
├── docs/
│   ├── technical_specification.md
│   ├── development_plan.md          ← this file
│   ├── tasks/                       ← one file per phase (phase-01..06-*.md) + README index
│   ├── mutation_testing_plan.md
│   ├── mutation_testing_results.md
│   └── schemas/
│       └── notification-log.prisma  ← fragment for consumer (not imported by the lib)
├── scripts/check-size.mjs
├── src/server/              # main entry — see §3.1 of the spec
├── src/shared/              # zero deps — types & constants
├── src/react/               # hooks (useOtpInput, useOtpCountdown)
├── test/e2e/                # isolated e2e specs
├── package.json
├── tsup.config.ts
├── tsconfig.json (+ build / server / e2e / jest variants)
├── jest.config.ts (+ coverage / e2e / stryker variants)
├── stryker.config.json
├── eslint.config.mjs
├── README.md / CHANGELOG.md / SECURITY.md / LICENSE / CLAUDE.md / AGENTS.md
```

### 1.9 How this plan feeds `docs/tasks/`

Each numbered **sub-step** in this plan (§2.X, §3.X, etc.) becomes **one or more executable tasks** in the per-phase task files under `docs/tasks/` (one file per phase, `phase-NN-<slug>.md`). The derivation rule:

- Sub-step with **a single file + logic < 100 LoC** → **1 task**
- Sub-step with **multiple related files** → **grouped task** with a per-file checklist
- Sub-step with **logic > 200 LoC** → **task split** into red (test), green (impl), refactor

The task carries the full prompt for AI agent execution (Role / Project / Preconditions / Required Reading / Task / Deliverables / Constraints / Verification / Completion Protocol — `/bymax-workflow:phase-tasks` standard).

### 1.10 Critical design decisions reflected in the plan

#### 1.10.1 Dissolving the Prisma coupling (highlight Phase 1)

A hand-rolled email-verification service that imports a Prisma client directly to persist OTP codes in an `email_verification` table — the typical pattern a consumer ships before adopting this lib — creates 3 problems:

1. **Non-portable** — any consumer using TypeORM/Drizzle/Mongo would need to refactor
2. **Leaks the schema** — the lib forced a specific shape (`{ email, code, expiresAt }`) on the user table
3. **Domain conflict** — email verification is an OTP use case, not its own entity

This lib **solves this in Phase 1** by defining `IOtpStorage` as the single persistence interface. Email verification is now invoked as:

```typescript
await otpService.generate({
  tenantId,
  recipient: email,
  purpose: 'email_verification',
  deliverVia: 'email',
})
```

All persistence is encapsulated in `RedisOtpStorage` (default) or any `IOtpStorage` the consumer chooses. **The lib never imports `@prisma/client`** — this is verifiable via `grep` in CI:

```bash
grep -r "@prisma/client" src/ && exit 1 || exit 0
```

#### 1.10.2 MVP scoping — SMS and Push deferred to v0.2

The `ISmsProvider` and `IPushProvider` interfaces are **declared in Phase 1** (in the `interfaces/` directory, marked with JSDoc `@since v0.2 (planned)`) to document the future contract. **But the corresponding services (`SmsService`, `PushService`) ARE NOT implemented in Phase 1-4**. The motivation:

- The primary use case (email-delivered OTP) does not need SMS/Push today — v0.1 delivers OTP by email only
- Implementing 4 channels simultaneously would widen v0.1's blast radius with no real use case to validate them
- Keeping the interfaces declared lets v0.1 consumers plan the integration ahead
- OTP delivery in v0.1 is `email` or `manual`; SMS-delivered OTP (`deliverVia: 'sms'`) lands with the SMS channel in v0.2 (see spec §15)

The Release phase notes document SMS/Push as "deferred to v0.2".

#### 1.10.3 Multi-tenant via `sha256(tenantId:recipient)`

Every Redis key uses `sha256(tenantId:recipient)` as the identifier. Two reasons:

1. **Privacy** — anyone with access to `KEYS notification:otp:*` in Redis cannot enumerate emails/phones with pending OTPs
2. **Multi-tenancy** — cross-tenant collision is mathematically impossible (SHA-256 preimage resistance)

Full details in **Appendix E**.

#### 1.10.4 Pluggable templating with default escape

The original `EmailService` had hardcoded PT-BR HTML. The new lib solves this via `IEmailTemplateRenderer`:

- **Default**: `DefaultTemplateRenderer` with `{{var}}` interpolation + automatic HTML escape (anti-XSS)
- **Pluggable**: consumer registers Handlebars/MJML/React Email implementing the interface

This closes a common XSS vector: if you interpolate `{{userName}}` in HTML without escape and the name contains `<script>`, you have stored XSS in the recipient's inbox. The default renderer applies escape; consumers who choose raw HTML (`{{{var}}}` in Handlebars) assume the risk.

---

## 2. Phase 1 — Foundation + IEmailProvider + IOtpStorage Interfaces

> **Phase objective:** Establish complete project scaffold, define public contracts (provider/storage/renderer/audit interfaces), declare injection tokens, implement the dynamic module skeleton with conditional registration. At the end of the phase, it is possible to install the lib in a NestJS fixture app and instantiate `BymaxNotificationModule.forRoot({ ... })` without error — even without implemented services.
>
> **Complexity:** MEDIUM. The largest risk lies in correctly declaring the interfaces (especially `IOtpStorage`, which carries the dissolution of the Prisma coupling) and in the dynamic module's conditional registration pattern.
>
> **Critical paths for 95% coverage:** `src/server/config/validate-options.ts`, `src/server/errors/notification-exception.ts`, `src/server/bymax-notification.module.ts` (conditional registration).

### 2.1 Project scaffold + complete CI

**Objective:** Create the folder structure, configuration files, base dependencies **and the complete CI** in one foundation step — mirroring the canonical `bymax-one/nest-auth` configs and the gold-standard, Redis-aware CI of `bymax-one/nest-cache`. Because the library is built 100% by agents, the CI must gate every PR from the very first one; the four workflows are therefore created here, not at release, and every per-PR gate is **incremental-safe** (passes at every phase, depends on no later-phase resource).

**Files to create:**

```
nest-notification/
├── .github/workflows/
│   ├── ci.yml            # verify: typecheck·lint·check:no-prisma·test:cov·test:e2e·build·integrity·size (no mutation)
│   ├── codeql.yml        # javascript-typescript, security-extended, push/PR/weekly
│   ├── scorecard.yml     # OpenSSF Scorecard, push/weekly, SARIF + publish_results
│   └── release.yml       # tag v*.*.*-driven ONLY: OIDC --provenance publish + dogfood smoke + CHANGELOG release
├── .gitignore
├── .prettierrc
├── .npmignore
├── eslint.config.mjs
├── jest.config.ts                 # passWithNoTests: true; coverage 100% over implemented src
├── jest.coverage.config.ts
├── jest.e2e.config.ts             # passWithNoTests: true (e2e specs first appear in Phase 4)
├── jest.stryker.config.ts
├── stryker.config.json            # high 100 / low 95 / break 95
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.server.json
├── tsconfig.e2e.json
├── tsconfig.jest.json
├── tsup.config.ts
├── package.json
├── scripts/check-size.mjs
├── src/server/index.ts          # empty in this step — only structure
├── src/shared/index.ts          # empty in this step
└── src/react/index.ts           # empty in this step
```

> **Incremental-safe CI (must hold at every phase).** `ci.yml`'s `verify` job runs exactly `pnpm typecheck && lint && check:no-prisma && test:cov && test:e2e && build && <integrity> && size`. It passes from this first PR (empty sources + zero tests) because: jest configs set `passWithNoTests: true`; coverage is enforced only over implemented files (`collectCoverageFrom`); the build-output integrity loop tolerates the still-empty `react` bundle; size budgets pass on small bundles. **Mutation is never in `ci.yml`** (pre-release gate, §7.5). **`release.yml` only runs on a `v*.*.*` tag**, so it never fires during phases. Full workflow spec + the gold-standard reference: §7.3.

> The `test/e2e/` directory is created on demand when the first `*.e2e-spec.ts` is added — do NOT create a `.gitkeep` placeholder.

**Reference configs:** Copy from `/Users/maximiliano/Documents/MyApps/bymax-one/nest-auth/` and adapt (replace `nest-auth` with `nest-notification`). Details in the Appendix C table. Key points:

- `tsconfig.*`: switch path aliases to the 3 subpaths
- `jest.config.ts`: `moduleNameMapper` for 3 subpaths; coverage threshold 100% per file
- `stryker.config.json`: thresholds high 100 / low 95 / break 95 (per the Bymax Code-Craft Standard — only 100% reports green; build breaks below 95)
- `tsup.config.ts`: **rewrite** — 3 entries; externals = all peer deps
- `eslint.config.mjs`: remove rules specific to `oauth/`, `crypto/`; keep `eslint-plugin-security` and `eslint-plugin-import`
- `scripts/check-size.mjs`: **rewrite** with 3 budgets (server 30 KB, shared 4 KB, react 8 KB brotli)

**Detail — `package.json` for this phase:**

Fully mirrors the template of `@bymax-one/nest-auth` (see `bymax-one/EXTRACTION_ROADMAP.md §3.1`, monorepo-level) — specific adjustments:

- **`name`**: `@bymax-one/nest-notification`, **`version`**: `0.1.0`
- **`exports`**: 3 subpaths (`.`, `./shared`, `./react`) — each one with `types`, `import`, `require`
- **`type`**: `module`, **`sideEffects`**: `false`, **`files`**: `["dist", "LICENSE", "README.md", "CHANGELOG.md"]`
- **`scripts`**: build/lint/test/test:cov/test:e2e/test:cov:all/mutation/typecheck/size/clean/prepublishOnly/release (all from the template) + **`check:no-prisma`** (new gate specific to this lib)
- **Required `peerDependencies`**: `@nestjs/common ^11`, `@nestjs/core ^11`, `reflect-metadata ^0.2`
- **`peerDependencies`** optional (full list in spec §13.2): `ioredis`, `resend`, `@sendgrid/mail`, `@aws-sdk/client-ses`, `@aws-sdk/client-sns`, `mailgun.js`, `nodemailer`, `twilio`, `firebase-admin`, `@aws-sdk/client-dynamodb`, `handlebars`, `@react-email/render`, `mjml`, `class-validator`, `class-transformer`, `express`, `@types/express`, `react`
- **`peerDependenciesMeta`**: all optional, marked `{ "optional": true }`
- **`devDependencies`** added on top of the auth template: `ioredis-mock ^8`, `jest-environment-jsdom ^30`, `@testing-library/react ^16`, `react`/`react-dom`/`@types/react ^19`
- **`packageManager`**: `pnpm@10.8.1`, **`engines.node`**: `>=24.0.0`, **`publishConfig.access`**: `public` (provenance via OIDC of GH Actions)

**`tsup.config.ts` (3 entries):** `server/index` (target node24, externals: all peer deps + nestjs), `shared/index` (target node24, zero externals), `react/index` (target es2022, external: react). Each entry: `format: ['esm','cjs']`, `dts: true`, `treeshake: true`. Output: `.mjs`/`.cjs`/`.d.ts`.

**Acceptance criteria:**

- [ ] Directory structure created per the tree above
- [ ] `package.json` with all scripts, peer deps and devDeps listed
- [ ] `tsconfig.json` inherits strict settings from nest-auth (target ES2022, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- [ ] `tsup.config.ts` configured with 3 entries
- [ ] `eslint.config.mjs` in flat config v9 working (zero warnings on the empty folder)
- [ ] Script `check:no-prisma` declared in `package.json` (verifies that `@prisma/client` is never imported)
- [ ] `pnpm install` completes without errors
- [ ] `pnpm typecheck` passes on empty `src/server/index.ts`, `src/shared/index.ts`, `src/react/index.ts` (placeholder comment only)
- [ ] `pnpm lint` passes without warnings
- [ ] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}`, `dist/shared/index.{mjs,cjs,d.ts}`, and `dist/react/index.{mjs,cjs,d.ts}` even with empty source

**Validation commands:**

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
pnpm check:no-prisma
ls -la dist/server/  # confirma .mjs, .cjs, .d.ts
ls -la dist/shared/
ls -la dist/react/
```

**Dependencies:** In the prior sub-step. This is the phase's entry point.

**Risks/Notes:**

- ⚠️ `pnpm@10.8.1` is a requirement; using a different version can break lockfile resolution
- ⚠️ Node 24 LTS is the minimum; `crypto.randomInt` and `crypto.timingSafeEqual` are essential
- ⚠️ Do not copy `tsup.config.ts` from nest-auth literally — nest-auth has 5 entries; here there are 3
- ⚠️ The `react/` folder uses `target: 'es2022'` (not `node24`) because it may run in the browser

### 2.2 Shared types and constants (`src/shared/`)

**Objective:** Define the public types and constants without NestJS dependencies. These modules can be imported in the frontend (e.g., validate error code in UI) without bringing backend overhead.

**Files to create:**

```
src/shared/
├── types/
│   ├── otp-purpose.types.ts
│   ├── notification-channel.types.ts
│   └── notification-error.types.ts
├── constants/
│   ├── error-codes.ts
│   └── default-ttls.ts
└── index.ts
```

**Skeletons (all files in `src/shared/` are types + constants — zero runtime code, zero deps):**

```typescript
// types/otp-purpose.types.ts
export type OtpPurpose =
  | 'email_verification' | 'password_reset' | 'mfa_oob'
  | 'phone_verification' | 'magic_link'
  | (string & {})    // permits custom purposes while keeping autocompletion

// types/notification-channel.types.ts
export type NotificationChannel = 'email' | 'otp' | 'sms' | 'push'
// 'sms' and 'push' declared in v0.1 so consumers can plan dispatch code paths

// types/notification-error.types.ts
export interface NotificationErrorResponse {
  error: { code: string; message: string; details: Record<string, unknown> | null }
}

// constants/error-codes.ts — 21 codes mirroring server's NOTIFICATION_ERROR_DEFINITIONS (without HTTP status)
export const NOTIFICATION_ERROR_CODES = {
  EMAIL_PROVIDER_NOT_CONFIGURED: 'notification.email_provider_not_configured',
  EMAIL_SEND_FAILED: 'notification.email_send_failed',
  // ... see full mapping in §2.4 Phase 1
  CHANNEL_DISABLED: 'notification.channel_disabled',
} as const
export type NotificationErrorCode = (typeof NOTIFICATION_ERROR_CODES)[keyof typeof NOTIFICATION_ERROR_CODES]

// constants/default-ttls.ts
export const DEFAULT_TTLS = {
  OTP_EMAIL_VERIFICATION_SECONDS: 3600,
  OTP_PASSWORD_RESET_SECONDS: 600,
  OTP_MFA_OOB_SECONDS: 300,
  OTP_PHONE_VERIFICATION_SECONDS: 600,
  OTP_MAGIC_LINK_SECONDS: 900,
  RESEND_COOLDOWN_SECONDS: 60,
  OTP_GENERIC_SECONDS: 600,
} as const

// index.ts — barrel
export type { OtpPurpose } from './types/otp-purpose.types'
export type { NotificationChannel } from './types/notification-channel.types'
export type { NotificationErrorResponse } from './types/notification-error.types'
export { NOTIFICATION_ERROR_CODES, type NotificationErrorCode } from './constants/error-codes'
export { DEFAULT_TTLS } from './constants/default-ttls'
```

JSDoc for `(string & {})` on `OtpPurpose`: explains that this TS pattern allows custom purposes (e.g., `'invoice_verification'`) while keeping literal autocompletion for known ones. JSDoc for `DEFAULT_TTLS`: each constant carries rationale (`OTP_EMAIL_VERIFICATION_SECONDS: 3600 // allows user to check email leisurely`, etc.).

**Acceptance criteria:**

- [ ] All files created per the tree
- [ ] JSDoc present on each export
- [ ] `pnpm build` generates `dist/shared/index.d.ts` listing all exports
- [ ] `pnpm typecheck` passes
- [ ] Bundle `dist/shared/index.mjs` < 4 KB brotli (validate with `pnpm size` in §2.11)
- [ ] Subpath `import('@bymax-one/nest-notification/shared')` resolves correctly in a consumer fixture
- [ ] No import of NestJS or Node-only API in this subpath (`grep -r "@nestjs\|node:" src/shared/` must return empty)

**Validation commands:**

```bash
pnpm build
node -e "import('./dist/shared/index.mjs').then(m => console.log(Object.keys(m).sort()))"
# Expected: [ 'DEFAULT_TTLS', 'NOTIFICATION_ERROR_CODES' ]
```

**Dependencies:** §2.1 complete.

**Risks/Notes:**

- ⚠️ `import type` is mandatory for types — avoids inclusion in the JS bundle
- ⚠️ Constants must be `as const` to preserve literal types
- ⚠️ Do not add logic in `shared/` — only pure types and constants
- ⚠️ `OtpPurpose` uses `(string & {})` to allow custom purposes — intentional TypeScript syntax, do not replace with `string`

### 2.3 Main interfaces (`src/server/interfaces/`)

**Objective:** Define all interfaces the consumer can implement or reference — `IEmailProvider`, `IOtpStorage`, `IEmailTemplateRenderer`, `INotificationLogRepository`, and the `ISmsProvider`/`IPushProvider` sketches for v0.2.

**Files to create:**

```
src/server/interfaces/
├── notification-module-options.interface.ts
├── email-provider.interface.ts
├── otp-storage.interface.ts
├── email-template-renderer.interface.ts
├── notification-log-repository.interface.ts
├── sms-provider.interface.ts           # v0.2 sketch — declared, not used yet
├── push-provider.interface.ts          # v0.2 sketch — declared, not used yet
└── index.ts
```

**Interfaces ship as TypeScript-only contracts (no runtime code). Full type signatures live in `docs/technical_specification.md §5` (each interface gets its own subsection). Summary of required exports:**

#### `email-provider.interface.ts`

- `IEmailProvider` — `send(options: EmailSendOptions): Promise<EmailSendResult>`, `isConfigured(): boolean`, `readonly name: string`
- `EmailSendOptions` — `{ to, from?, fromName?, subject, html, text?, replyTo?, cc?, bcc?, tags?, headers?, attachments? }`
- `EmailSendResult` — `{ messageId: string }`

JSDoc must call out: never log body, never leak credentials, throw `Error` on failure (mapped to `NotificationException` by `EmailService`).

#### `otp-storage.interface.ts`

- `IOtpStorage` — `set`, `get`, **`consumeAttempt`** (atomic verify primitive), `update`, `delete`, **`tryAcquireCooldown`** (atomic NX acquire), `getCooldown`, **`clearCooldown`**, `isConfigured()`, `readonly name`
- `OtpEntry` — `{ code, expiresAt, attempts, maxAttempts, validated?, metadata? }`
- `consumeAttempt` return — `{ status: 'not_found' } | { status: 'max_attempts' } | { status: 'ok'; entry: OtpEntry }`
- `OtpVerifyResult` — discriminated union (expired is reported as `not_found` — the entry is gone after TTL, and spec §11.5 says don't leak the difference):
  - `{ valid: true }`
  - `{ valid: false; reason: 'not_found' }`
  - `{ valid: false; reason: 'max_attempts' }`
  - `{ valid: false; reason: 'invalid_code'; remainingAttempts: number }`

**JSDoc highlight (Prisma decoupling):** "This interface DISSOLVES the Prisma coupling a hand-rolled email-verification service would otherwise impose. No `@prisma/client` import lives anywhere in this library."

Implementation contract (full text in spec §5.2):
- **`consumeAttempt` MUST be atomic** — lookup + attempt increment in one indivisible step (Redis: Lua script; in-memory: a single synchronous read-modify-write). A plain `get`+`update` races and lets `maxAttempts` be bypassed under concurrency.
- **`tryAcquireCooldown` MUST be atomic** — check-and-set in one step (Redis: `SET NX EX`), so two concurrent generate/resend calls cannot both pass.
- Honor TTL — entries past `expiresAt` MUST return `null` / `not_found`
- `update` (used to mark `validated`) MUST NOT resurrect expired entries (Redis: `SET ... KEEPTTL XX`)
- The lib does NOT normalize `recipient` — callers pass a canonical value (e.g. `email.trim().toLowerCase()`)
- Never log codes

#### `email-template-renderer.interface.ts`

- `IEmailTemplateRenderer` — `render(name, data, locale)`, `hasTemplate(name, locale)`, `readonly name`
- `RenderedEmail` — `{ subject, html, text? }`

#### `notification-log-repository.interface.ts`

- `INotificationLogRepository` — `create(entry)`, `readonly name`
- `NotificationLogEntry` — `{ timestamp, tenantId, channel, verb, recipient, purpose?, providerName, messageId?, errorMessage?, userId?, metadata? }`

`verb` union: `'sent' | 'generated' | 'verified' | 'failed' | 'cooldown_blocked' | 'max_attempts_exceeded'`.

JSDoc: `errorMessage` is the message only — NEVER include stack trace (PII / vulnerability leakage).

#### `sms-provider.interface.ts` (v0.2 sketch)

- `ISmsProvider` — same shape as `IEmailProvider` but `send(options: SmsSendOptions): Promise<SmsSendResult>`
- `SmsSendOptions` — `{ to (E.164), from?, body, tags? }`
- `SmsSendResult` — `{ messageId }`

JSDoc: `@since v0.2 (planned) — interface declared in v0.1 so consumers can plan their dispatch code paths.`

#### `push-provider.interface.ts` (v0.2 sketch)

- `IPushProvider` — `send(options: PushSendOptions): Promise<PushSendResult>`
- `PushSendOptions` — `{ tokens, title, body, data?, imageUrl?, sound?, badge?, ttlSeconds?, priority? }`
- `PushSendResult` — `{ results: Array<{ token, messageId?, error? }> }`

JSDoc: same `@since v0.2` note as SMS.

**Skeleton — `src/server/interfaces/notification-module-options.interface.ts`:**

The interface mirrors `docs/technical_specification.md §4.1` (`BymaxNotificationModuleOptions`). Key sub-interfaces:

- `BymaxNotificationModuleOptions` — top-level with optional channel sections (`global`, `email`, `otp`, `sms`, `push`, `audit`)
- `NotificationRequest` — `{ headers: Record<string, string | string[] | undefined>; hostname?: string }` (framework-agnostic request shape — works for Express and Fastify)
- `GlobalOptions` — `redisNamespace?` (default `'notification'`), `defaultLocale?` (default `'en'`), `tenantIdResolver?(req: NotificationRequest) => string | Promise<string>`
- `EmailChannelOptions` — `provider: IEmailProvider | (new (...args: never[]) => IEmailProvider)` (required), `defaultFrom: string` (required), `defaultFromName?`, `templateRenderer?`, `defaultReplyTo?`, `defaultTags?`, `maxAttachmentBytes?` (default `10485760` = 10 MiB; enforced by `EmailService`)
- `OtpChannelOptions` — `storage: IOtpStorage | (new () => IOtpStorage)` (required), `defaultLength?` (6), `defaultCodeType?` ('numeric'), `defaultTtlSeconds?` (600), `defaultMaxAttempts?` (5), `resendCooldownSeconds?` (60), `consumeOnVerify?` (false), `perPurpose?: Record<string, Partial<OtpPurposeConfig>>`
- `OtpPurposeConfig` — `{ length, codeType, ttlSeconds, maxAttempts, resendCooldownSeconds }` (all required when overriding)
- `SmsChannelOptions` (v0.2 sketch) — `provider`, `defaultFrom?`, `resendCooldownSeconds?`
- `PushChannelOptions` (v0.2 sketch) — `provider`, `defaultTtlSeconds?`
- `AuditOptions` — `repository` (required), `swallowErrors?` (true), `maskRecipient?: (recipient: string) => string` (default identity — masks PII before audit write)
- `BymaxNotificationModuleAsyncOptions` — extends `Pick<ModuleMetadata, 'imports'>`, supports `useFactory` / `inject` (only `useFactory` wired in v0.1; `useClass`/`useExisting` rejected — see §5.3)
- `BymaxNotificationModuleOptionsFactory` — reserved for the `useClass`/`useExisting` async pattern (v0.2): `createNotificationOptions()`

All `provider`/`storage`/`repository` fields accept either an instance OR a class constructor (`new (...args: never[]) => I...`) — the module resolves at registration time.

**Skeleton — `src/server/interfaces/index.ts`:**

```typescript
export type {
  IEmailProvider,
  EmailSendOptions,
  EmailSendResult,
} from './email-provider.interface'

export type {
  IOtpStorage,
  OtpEntry,
  OtpVerifyResult,
} from './otp-storage.interface'

export type {
  IEmailTemplateRenderer,
  RenderedEmail,
} from './email-template-renderer.interface'

export type {
  INotificationLogRepository,
  NotificationLogEntry,
} from './notification-log-repository.interface'

export type {
  ISmsProvider,
  SmsSendOptions,
  SmsSendResult,
} from './sms-provider.interface'

export type {
  IPushProvider,
  PushSendOptions,
  PushSendResult,
} from './push-provider.interface'

export type {
  BymaxNotificationModuleOptions,
  BymaxNotificationModuleAsyncOptions,
  BymaxNotificationModuleOptionsFactory,
  GlobalOptions,
  NotificationRequest,
  EmailChannelOptions,
  OtpChannelOptions,
  OtpPurposeConfig,
  SmsChannelOptions,
  PushChannelOptions,
  AuditOptions,
} from './notification-module-options.interface'
```

**Acceptance criteria:**

- [ ] All interfaces created with complete JSDoc
- [ ] `IOtpStorage` explicitly documents that it dissolves the Prisma coupling
- [ ] `IOtpStorage` declares `consumeAttempt` / `tryAcquireCooldown` / `clearCooldown` with the "MUST be atomic" contract in JSDoc
- [ ] `ISmsProvider` and `IPushProvider` carry `@since v0.2 (planned)` in the JSDoc
- [ ] `readonly` on immutable properties (consistent with `exactOptionalPropertyTypes`)
- [ ] `BymaxNotificationModuleAsyncOptions` follows the official NestJS async dynamic-module pattern
- [ ] `pnpm typecheck` passes
- [ ] No `any` in any signature
- [ ] `OtpVerifyResult` is a discriminated union (verifiable: TypeScript narrows `result.reason` when `result.valid === false`)

**Validation commands:**

```bash
pnpm typecheck
grep -n ': any\b\|any\[\]' src/server/interfaces/  # expected: no match
grep -n '@prisma/client' src/server/interfaces/    # expected: no match
```

**Dependencies:** §2.1 (scaffold), §2.2 (shared types referenciados in `NotificationLogEntry.channel`).

**Risks/Notes:**

- ⚠️ Do not export these interfaces directly from the server `index.ts` yet — wait for §2.10
- ⚠️ Keep `BymaxNotificationModuleOptions` separate from `BymaxNotificationModuleAsyncOptions` (do not merge into a union)
- ⚠️ The `new (...args: never[]) => I...Provider` types allow the consumer to pass **class** instead of **instance** — the module decides to instantiate via DI or use the instance directly

### 2.4 Constants, error codes and injection tokens

**Objective:** Define injection tokens (`Symbol()`), complete error codes with HTTP status and default messages, notification purposes constants.

**Files to create:**

```
src/server/
├── bymax-notification.constants.ts
├── constants/
│   ├── notification-purposes.ts
│   └── default-options.constants.ts
└── errors/
    ├── notification-error-codes.ts
    └── notification-exception.ts
```

**Skeleton — `src/server/bymax-notification.constants.ts`:**

```typescript
export const BYMAX_NOTIFICATION_OPTIONS = Symbol('BYMAX_NOTIFICATION_OPTIONS')
export const BYMAX_NOTIFICATION_EMAIL_PROVIDER = Symbol('BYMAX_NOTIFICATION_EMAIL_PROVIDER')
export const BYMAX_NOTIFICATION_OTP_STORAGE = Symbol('BYMAX_NOTIFICATION_OTP_STORAGE')
export const BYMAX_NOTIFICATION_SMS_PROVIDER = Symbol('BYMAX_NOTIFICATION_SMS_PROVIDER')
export const BYMAX_NOTIFICATION_PUSH_PROVIDER = Symbol('BYMAX_NOTIFICATION_PUSH_PROVIDER')
export const BYMAX_NOTIFICATION_TEMPLATE_RENDERER = Symbol('BYMAX_NOTIFICATION_TEMPLATE_RENDERER')
export const BYMAX_NOTIFICATION_LOG_REPOSITORY = Symbol('BYMAX_NOTIFICATION_LOG_REPOSITORY')
```

Symbols (not strings) to avoid collision with other libraries. Pattern inherited from `@bymax-one/nest-auth`. Exported publicly so consumers can override providers via `app.get(BYMAX_NOTIFICATION_EMAIL_PROVIDER)` in tests.

**Skeleton — `src/server/constants/notification-purposes.ts`:**

```typescript
export const NOTIFICATION_PURPOSES = {
  EMAIL_VERIFICATION: 'email_verification', PASSWORD_RESET: 'password_reset',
  MFA_OOB: 'mfa_oob', PHONE_VERIFICATION: 'phone_verification', MAGIC_LINK: 'magic_link',
} as const

export type CanonicalNotificationPurpose = (typeof NOTIFICATION_PURPOSES)[keyof typeof NOTIFICATION_PURPOSES]
```

Canonical OTP purposes — consumer can use these for type-safety or pass arbitrary strings.

**Skeleton — `src/server/constants/default-options.constants.ts`:**

```typescript
export const DEFAULT_GLOBAL_OPTIONS = { redisNamespace: 'notification', defaultLocale: 'en' } as const
export const DEFAULT_OTP_OPTIONS = {
  defaultLength: 6, defaultCodeType: 'numeric', defaultTtlSeconds: 600,
  defaultMaxAttempts: 5, resendCooldownSeconds: 60, consumeOnVerify: false, perPurpose: {},
} as const
export const DEFAULT_EMAIL_OPTIONS = { defaultTags: [] as ReadonlyArray<{ name: string; value: string }> } as const
export const DEFAULT_AUDIT_OPTIONS = { swallowErrors: true } as const
```

Each `as const satisfies Partial<...>` to preserve literal types while ensuring shape alignment with the corresponding option interface.

**Skeleton — `src/server/errors/notification-error-codes.ts`:**

```typescript
export const NOTIFICATION_ERROR_DEFINITIONS = {
  EMAIL_PROVIDER_NOT_CONFIGURED: { code: 'notification.email_provider_not_configured', status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Email provider not configured' },
  // ... see full table below
} as const

export type NotificationErrorKey = keyof typeof NOTIFICATION_ERROR_DEFINITIONS
export { NOTIFICATION_ERROR_CODES } from '../../shared/constants/error-codes'
```

**Full mapping (mirrors spec §11.2 — keep byte-identical strings to `shared/constants/error-codes.ts`):**

| Key | Code | HTTP | Message |
|---|---|---|---|
| `EMAIL_PROVIDER_NOT_CONFIGURED` | `notification.email_provider_not_configured` | 500 | Email provider not configured |
| `EMAIL_SEND_FAILED` | `notification.email_send_failed` | 502 | Failed to send email |
| `EMAIL_ATTACHMENTS_TOO_LARGE` | `notification.email_attachments_too_large` | 413 | Email attachments exceed size limit |
| `EMAIL_INVALID_RECIPIENT` | `notification.email_invalid_recipient` | 400 | Invalid recipient email |
| `TEMPLATE_NOT_FOUND` | `notification.template_not_found` | 500 | Email template not found |
| `TEMPLATE_RENDER_FAILED` | `notification.template_render_failed` | 500 | Failed to render email template |
| `OTP_STORAGE_NOT_CONFIGURED` | `notification.otp_storage_not_configured` | 500 | OTP storage not configured |
| `OTP_EMAIL_DELIVERY_NOT_CONFIGURED` | `notification.otp_email_delivery_not_configured` | 500 | OTP email delivery requested but email channel not configured |
| `OTP_COOLDOWN_ACTIVE` | `notification.otp_cooldown_active` | 429 | Resend cooldown is active |
| `OTP_NOT_FOUND` | `notification.otp_not_found` | 404 | OTP not found or expired |
| `OTP_EXPIRED` | `notification.otp_expired` | 410 | OTP code expired |
| `OTP_MAX_ATTEMPTS_EXCEEDED` | `notification.otp_max_attempts_exceeded` | 429 | Maximum OTP attempts exceeded |
| `OTP_INVALID_CODE` | `notification.otp_invalid_code` | 401 | Invalid OTP code |
| `OTP_INVALID_LENGTH` | `notification.otp_invalid_length` | 400 | Invalid OTP length config |
| `SMS_PROVIDER_NOT_CONFIGURED` | `notification.sms_provider_not_configured` | 500 | SMS provider not configured |
| `SMS_SEND_FAILED` | `notification.sms_send_failed` | 502 | Failed to send SMS |
| `SMS_INVALID_RECIPIENT` | `notification.sms_invalid_recipient` | 400 | Invalid phone number |
| `PUSH_PROVIDER_NOT_CONFIGURED` | `notification.push_provider_not_configured` | 500 | Push provider not configured |
| `PUSH_SEND_FAILED` | `notification.push_send_failed` | 502 | Failed to send push notification |
| `AUDIT_LOG_FAILED` | `notification.audit_log_failed` | 500 | Audit log write failed |
| `CHANNEL_DISABLED` | `notification.channel_disabled` | 501 | Channel not enabled in module config |

**Skeleton — `src/server/errors/notification-exception.ts`:**

```typescript
export class NotificationException extends HttpException {
  readonly code: string

  constructor(
    key: NotificationErrorKey,
    details?: Record<string, unknown>,
    overrideStatus?: HttpStatus,
    overrideMessage?: string,
  ) {
    const definition = NOTIFICATION_ERROR_DEFINITIONS[key]
    super({
      error: {
        code: definition.code,
        message: overrideMessage ?? definition.message,
        details: details ?? null,
      },
    }, overrideStatus ?? definition.status)
    this.code = definition.code
  }
}
```

Response body shape `{ error: { code, message, details } }` mirrors `@bymax-one/nest-auth`. Consumers match on `code` to render localized messages. `overrideStatus`/`overrideMessage` cover edge cases where defaults are not appropriate.

**Acceptance criteria:**

- [ ] Unique Symbols (verifiable: each token different from others via `!==`)
- [ ] `NOTIFICATION_ERROR_DEFINITIONS` covers ALL codes from the §11.2 spec table
- [ ] Codes in `error-codes.ts` (server) match **byte-for-byte** with those in `shared/constants/error-codes.ts` (CI script verifies)
- [ ] `NotificationException` produces a payload in the exact shape of `NotificationErrorResponse`
- [ ] `NotificationException` accepts `overrideStatus` for edge cases (consumer can force 401 vs 403)
- [ ] `pnpm typecheck` passes
- [ ] Coverage 100% in `notification-exception.ts` (verifiable in §2.10)

**Validation commands:**

```bash
pnpm typecheck

# Utility script (also runs in CI) — confirms sync between server and shared
node -e "
import('./dist/server/index.mjs').then(srv => {
  import('./dist/shared/index.mjs').then(shr => {
    const serverCodes = Object.values(srv.NOTIFICATION_ERROR_DEFINITIONS).map(d => d.code).sort()
    const sharedCodes = Object.values(shr.NOTIFICATION_ERROR_CODES).sort()
    if (JSON.stringify(serverCodes) !== JSON.stringify(sharedCodes)) {
      console.error('Mismatch!', { serverCodes, sharedCodes })
      process.exit(1)
    }
    console.log('Codes in sync')
  })
})
"
```

**Dependencies:** §2.2 (shared error codes), §2.3 (interfaces).

**Risks/Notes:**

- ⚠️ **Sync between server and shared error codes** — intentional duplication; CI checks via grep or diff
- ⚠️ Messages in English by default. Consumer i18n is the frontend's responsibility (decision aligned with nest-auth)
- ⚠️ `NotificationException` inherits from `HttpException` (not `Error`) — NestJS exception filter handles it automatically

### 2.5 Options validation and resolution

**Objective:** Implement `validate-options.ts` (manual validation with clear messages) and `resolved-options.ts` (merge consumer options with defaults; resolve class providers to instances).

**Files to create:**

```
src/server/config/
├── validate-options.ts
├── resolved-options.ts
└── default-options.ts
```

**Skeleton — `src/server/config/validate-options.ts`:**

```typescript
const VALID_CODE_TYPES = ['numeric', 'alpha', 'alphanumeric'] as const

export function validateOptions(options: BymaxNotificationModuleOptions): void
// Internal: validateEmailOptions(email), validateOtpOptions(otp)
```

**Validation rules:**

1. **At least one channel** — throw `[BymaxNotificationModule] At least one channel must be configured (email, otp, sms, or push)` if none provided
2. **Email** (if present):
   - `provider` required — throw `options.email.provider is required when 'email' is configured`
   - `defaultFrom` required, non-empty — throw `options.email.defaultFrom must be a non-empty string`
   - `defaultFrom` looks like email (`includes('@')`) — throw `does not look like an email`
3. **OTP** (if present):
   - `storage` required
   - `defaultLength` in `[1, 32]` — throw `NotificationException('OTP_INVALID_LENGTH', { provided, allowed: '1-32' })`
   - `defaultCodeType` in `VALID_CODE_TYPES`
   - `defaultTtlSeconds > 0`, `defaultMaxAttempts >= 1`, `resendCooldownSeconds >= 0`
4. **SMS** in v0.1 — throw `SMS channel is not yet implemented (planned for v0.2). Remove 'sms' from options.`
5. **Push** in v0.1 — throw `Push channel is not yet implemented (planned for v0.2). Remove 'push' from options.`
6. **Audit** — if `audit` present, `audit.repository` required

**Skeleton — `src/server/config/resolved-options.ts`:**

```typescript
export interface ResolvedNotificationOptions {
  global: Required<Omit<GlobalOptions, 'tenantIdResolver'>> & {
    tenantIdResolver?: GlobalOptions['tenantIdResolver']
  }
  email?: ResolvedEmailOptions    // all-required version sans `provider/templateRenderer`, incl. `maxAttachmentBytes` (default 10 MiB)
  otp?: ResolvedOtpOptions        // all-required version sans `storage`, plus `resolveForPurpose(purpose)` helper
  audit?: ResolvedAuditOptions    // all-required version sans `repository`, incl. `maskRecipient` (default identity)
}

export function resolveOptions(options: BymaxNotificationModuleOptions): Readonly<ResolvedNotificationOptions>
function deepFreeze<T>(obj: T): Readonly<T>  // recursive Object.freeze
```

`ResolvedOtpOptions.resolveForPurpose(purpose)` returns the effective `OtpPurposeConfig` (`perPurpose[purpose]` merged over the otp defaults) so services never recompute the merge. Mirrors spec §4.5.

**Implementation algorithm:**

1. Always build `global` section with defaults (`redisNamespace: 'notification'`, `defaultLocale: 'en'`)
2. If `options.email` provided → build `resolved.email` with `defaultTags: options.email.defaultTags ?? []` and `maxAttachmentBytes: options.email.maxAttachmentBytes ?? 10_485_760`
3. If `options.otp` provided → build `resolved.otp` with each field `consumerValue ?? DEFAULT_OTP_OPTIONS.field`, `perPurpose ?? {}`, and attach the `resolveForPurpose(purpose)` helper
4. If `options.audit` provided → build `resolved.audit` with `swallowErrors: options.audit.swallowErrors ?? true` and `maskRecipient: options.audit.maskRecipient ?? ((r) => r)`
5. **Channel sections omitted** when consumer didn't configure them — enables type narrowing `if (resolved.email) { ... }`
6. `deepFreeze(resolved)` — recursive `Object.freeze` so mutation throws in strict mode

**Acceptance criteria:**

- [ ] `validateOptions` throws with a clear message for each invalid case
- [ ] `validateOptions` rejects `sms` and `push` in v0.1 with an explanatory message
- [ ] `resolveOptions` returns a deep-frozen object (mutation throws in strict mode)
- [ ] `resolveOptions` omits sections for unconfigured channels (verifiable: `resolved.email === undefined` when consumer did not pass `email`)
- [ ] Coverage 100% in both files
- [ ] `pnpm typecheck` passes

**Validation commands:**

```bash
pnpm test src/server/config/  # tests will be written in §2.10
pnpm typecheck
```

**Dependencies:** §2.3 (interfaces), §2.4 (constants + exception).

**Risks/Notes:**

- ⚠️ `deepFreeze` is recursive — can be costly in complex config; applied only once at bootstrap, ok
- ⚠️ Do not use `zod` or `class-validator` here — adds an unnecessary dep for simple validation
- ⚠️ Rejecting `sms`/`push` in v0.1 prevents the consumer from running production thinking SMS works

### 2.6 No-op providers / reference storages

**Objective:** Implement the lowest-risk providers — `NoOpEmailProvider`, `NoOpNotificationLogRepository`, `DefaultTemplateRenderer` (minimal version, refined in Phase 3) — to unblock Phase 1.

**Files to create:**

```
src/server/providers/
├── no-op-email.provider.ts
├── no-op-notification-log.repository.ts
└── default-template-renderer.ts
```

**`NoOpEmailProvider`** (dev/test only — NEVER in production):

```typescript
@Injectable()
export class NoOpEmailProvider implements IEmailProvider {
  readonly name = 'noop'
  private readonly logger = new Logger(NoOpEmailProvider.name)
  isConfigured(): boolean { return true }
  async send(options): Promise<EmailSendResult>
}
```

Implementation: log only `to` + `subject` via `logger.debug` — **NEVER** log `options.html` or `options.text` (body may contain OTP codes / PII). Return `{ messageId: 'noop-${Date.now()}-${randomSuffix}' }`.

**`NoOpNotificationLogRepository`** (default when `audit` not configured):

```typescript
@Injectable()
export class NoOpNotificationLogRepository implements INotificationLogRepository {
  readonly name = 'noop'
  async create(_entry): Promise<void> {}  // silent discard
}
```

**`DefaultTemplateRenderer` (Phase 1 minimal — refined in Phase 3 §4.1):**

```typescript
@Injectable()
export class DefaultTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'default-interpolation'
  constructor(options: { templates?: Record<string, { subject; html; text? }> } = {})
  async hasTemplate(name, locale): Promise<boolean>
  async render(name, data, locale): Promise<RenderedEmail>
}
```

Phase 1 minimal behavior:
- Resolve template: `templates[`${name}::${locale}`] ?? templates[`${name}::en`]`
- Throw `Template not found: ${name} (locale=${locale})` if neither exists
- `fill(str, escape)` replaces `/\{\{\s*(\w+)\s*\}\}/g` with `String(data[varName] ?? '')`, HTML-escaped **only when `escape === true`**
- Apply `fill(subject, false)`, `fill(html, true)`, `fill(text, false)` — the subject line and plaintext body are NOT HTML contexts, so escaping them would surface literal `&amp;`/`&lt;`
- `escapeHtml` covers 5 chars: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&#39;`
- §4.1 refines: fallback locale chain, nested paths, missing-var modes, construction validation

**Acceptance criteria:**

- [ ] `NoOpEmailProvider.send()` returns `messageId` (does not throw)
- [ ] `NoOpEmailProvider` NEVER logs `options.html` or `options.text` (verifiable via a logger spy)
- [ ] `NoOpNotificationLogRepository.create()` resolves doing nothing (idempotent)
- [ ] `DefaultTemplateRenderer` escapes variables **in the html body only** (verifiable: `{{name}}` with `<script>` becomes `&lt;script&gt;`; the same value in `subject`/`text` is left raw)
- [ ] `DefaultTemplateRenderer` falls back to locale `en` when the requested locale does not exist
- [ ] `DefaultTemplateRenderer` throws with the template name in the message when not found
- [ ] Coverage 100% in each file

**Validation commands:**

```bash
pnpm test src/server/providers/no-op-email.provider.spec.ts
pnpm test src/server/providers/no-op-notification-log.repository.spec.ts
pnpm test src/server/providers/default-template-renderer.spec.ts
```

**Dependencies:** §2.3 (interfaces).

**Risks/Notes:**

- ⚠️ The regex `/\{\{\s*(\w+)\s*\}\}/g` is simple — does not support full Handlebars syntax (`{{#if}}`). Document the limitation in JSDoc
- ⚠️ HTML escape is "good enough" for reflected XSS — does not replace a full sanitizer (e.g., DOMPurify) that the consumer can plug in via a Handlebars custom helper

### 2.7 Utilities — `hash`, `code-generator`, `timing-safe-compare`

**Objective:** Implement crypto-heavy utilities shared by the services. These are critical paths with 95%+ coverage mandatory.

**Files to create:**

```
src/server/utils/
├── hash.ts
├── code-generator.ts
└── timing-safe-compare.ts
```

**Skeleton — `src/server/utils/hash.ts`:**

```typescript
import { createHash } from 'node:crypto'

export function hashTenantRecipient(tenantId: string, recipient: string): string {
  return createHash('sha256').update(`${tenantId}:${recipient}`).digest('hex')
}
```

JSDoc must explain dual-purpose: (1) Privacy — Redis operators with `KEYS` access cannot enumerate recipients; (2) Multi-tenancy — preimage resistance under SHA-256 prevents tenant collision.

**Skeleton — `src/server/utils/code-generator.ts`:**

```typescript
import { randomInt } from 'node:crypto'
import { NotificationException } from '../errors/notification-exception'

const NUMERIC = '0123456789'
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ'          // excludes I, O
const ALPHANUMERIC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'  // excludes 0, 1, I, O

export function generateOtpCode(length: number, type: 'numeric' | 'alpha' | 'alphanumeric'): string
```

**Implementation (mirrors spec §6.2.1):**

- Validate `length` is an integer in `[1, 32]` → throw `NotificationException('OTP_INVALID_LENGTH', { provided, allowed: '1-32' })`
- **Every type is built character-by-character** from its charset: `for i in [0,length): code += charset[randomInt(0, charset.length)]`
- **Numeric is NOT `randomInt(0, 10 ** length)`** — that overflows `randomInt`'s 2^48 ceiling and loses integer precision for `length >= 15`. Per-digit `randomInt(0, 10)` is unbiased, works for any length, and preserves leading zeros naturally.
- Use `node:crypto.randomInt` — CSPRNG-backed; never `Math.random`

Charset rationale documented in JSDoc: confusion-free alphabets exclude visually-ambiguous chars (I/1, O/0).

**Skeleton — `src/server/utils/timing-safe-compare.ts`:**

```typescript
import { timingSafeEqual } from 'node:crypto'

export function safeCompare(expected: string, actual: string): boolean
```

**Implementation (mirrors spec §6.2.2):**

- Convert both to `Buffer.from(str, 'utf-8')`
- **If lengths differ → `return false`** (do NOT call `timingSafeEqual`, which throws `RangeError` on unequal-length buffers). For fixed-length OTPs this leaks only the already-public expected length, never the contents.
- If lengths equal: `return timingSafeEqual(bufA, bufB)`

Critical comment in JSDoc: comparison via `===` is UNSAFE — JavaScript's string equality short-circuits on first mismatch, leaking position via timing.

**Acceptance criteria:**

- [ ] `hashTenantRecipient('a', 'b')` returns a 64-char hex string
- [ ] `hashTenantRecipient('a', 'b') !== hashTenantRecipient('b', 'a')` (order matters)
- [ ] `generateOtpCode(6, 'numeric')` returns a 6-char string, all digits
- [ ] `generateOtpCode(6, 'numeric')` over 1000 invocations never produces a code with lost leading zeros (verifiable via property-based tests)
- [ ] `generateOtpCode(20, 'numeric')` returns 20 digits without throwing (regression for the `10 ** length` overflow)
- [ ] `generateOtpCode(8, 'alpha')` never contains 'I' or 'O'
- [ ] `generateOtpCode(0)` or `generateOtpCode(33)` throws `NotificationException OTP_INVALID_LENGTH`
- [ ] `safeCompare('a', 'a')` → `true`
- [ ] `safeCompare('a', 'b')` → `false`
- [ ] `safeCompare('abc', 'ab')` → `false` (no throw on length mismatch)
- [ ] Coverage **100%** in all 3 files
- [ ] Mutation score 100% on these crypto utils (security-critical — no surviving non-equivalent mutants)

**Validation commands:**

```bash
pnpm test src/server/utils/
pnpm test:cov  # gate 100% for those files
```

**Dependencies:** §2.4 (`NotificationException`).

**Risks/Notes:**

- ⚠️ `node:crypto.randomInt` is synchronous and blocks the event loop for **microseconds** — acceptable for OTP generation. Every type is now per-character, so a code costs `length` calls (≤ 32 ≈ 64µs); still acceptable.
- ⚠️ `timingSafeEqual` throws `RangeError` on unequal-length buffers — the `safeCompare` wrapper length-checks first and returns `false`. Do not remove that guard (a wrong-length guess would otherwise crash with a 500).
- ⚠️ `Buffer.from(str, 'utf-8')` is deterministic — do not use `Buffer.from(str)` (default encoding is platform-dependent)

### 2.8 Dynamic module skeleton

**Objective:** Implement `BymaxNotificationModule` with synchronous `forRoot()` and conditional provider registration. Services are still empty — methods `EmailService.send()`, `OtpService.generate()`, etc., come in Phase 2.

**Files to create:**

```
src/server/
└── bymax-notification.module.ts
```

**Skeleton:**

```typescript
@Module({})
export class BymaxNotificationModule {
  static forRoot(options: BymaxNotificationModuleOptions): DynamicModule
  static forRootAsync(asyncOptions: BymaxNotificationModuleAsyncOptions): DynamicModule
  private static resolveAsProvider(token: symbol, valueOrClass: unknown): Provider
}
```

**Implementation algorithm (`forRoot`):**

1. `validateOptions(options)` then `resolved = resolveOptions(options)`
2. Build providers list starting with `{ provide: BYMAX_NOTIFICATION_OPTIONS, useValue: resolved }`
3. Audit log: if `resolved.audit` provided → register via `resolveAsProvider(BYMAX_NOTIFICATION_LOG_REPOSITORY, ...)`; else `{ useClass: NoOpNotificationLogRepository }`
4. Email channel (if `resolved.email`):
   - Register provider via `resolveAsProvider(BYMAX_NOTIFICATION_EMAIL_PROVIDER, resolved.email.provider)`
   - Register renderer via `resolveAsProvider(BYMAX_NOTIFICATION_TEMPLATE_RENDERER, ...)` OR `useFactory: () => new DefaultTemplateRenderer({})` as fallback
   - The `EmailService` provider is added once the service exists (§3.7). Until then, leave a timeless TODO such as `// TODO: register EmailService once implemented` — never reference a roadmap phase in a committed comment.
5. OTP channel (if `resolved.otp`):
   - Register storage via `resolveAsProvider(BYMAX_NOTIFICATION_OTP_STORAGE, resolved.otp.storage)`
   - The `OtpService` provider is added once the service exists (§3.7). Use a timeless TODO (`// TODO: register OtpService once implemented`) — no phase references in code.
6. Emit bootstrap log via Logger: `'[BYMAX_NOTIFICATION_MODULE_BOOTSTRAP_OK] Initialized with channels: <list>'`
7. Return `{ module: BymaxNotificationModule, global: true, providers, exports: providers.map(p => p.provide) }`

**Implementation algorithm (`forRootAsync` — Phase 1 stub):**

1. Construct `optionsProvider: { provide: BYMAX_NOTIFICATION_OPTIONS, useFactory: async (...args) => { ... validate + resolve ... }, inject: asyncOptions.inject }`
2. Phase 1 stub: only options provider is wired; channel providers come in Phase 4 §5.3.

**`resolveAsProvider(token, valueOrClass)` helper:**

- Detect class vs instance via `typeof === 'function' && valueOrClass.prototype?.constructor === valueOrClass`
- Class → `{ provide: token, useClass: valueOrClass }`
- Instance → `{ provide: token, useValue: valueOrClass }`

Trade-off documented: class-detection heuristic via prototype works for ES2015+ classes; minified classes may break. Recommend instances in JSDoc.

**Acceptance criteria:**

- [ ] `BymaxNotificationModule.forRoot({ email: ... })` returns a valid `DynamicModule`
- [ ] Only providers for configured channels are registered (verifiable: without `otp`, `BYMAX_NOTIFICATION_OTP_STORAGE` is not provided)
- [ ] `forRoot({ audit: undefined })` registers `NoOpNotificationLogRepository` automatically
- [ ] `forRoot({ email: { ... }, audit: { repository: MyRepo } })` registers `MyRepo` as `BYMAX_NOTIFICATION_LOG_REPOSITORY`
- [ ] Class vs instance resolved correctly (verifiable: `useClass` for a class reference like `InMemoryOtpStorage`, `useValue` for an instance like `new ResendEmailProvider({ apiKey })`)
- [ ] Bootstrap log emitted with the active channels (`BYMAX_NOTIFICATION_MODULE_BOOTSTRAP_OK`)
- [ ] `forRootAsync` accepts `useFactory` + `inject`
- [ ] `pnpm typecheck` passes
- [ ] Coverage 100% on the module

**Validation commands:**

```bash
pnpm test src/server/bymax-notification.module.spec.ts
```

**Dependencies:** §2.3 (interfaces), §2.4 (constants/exception), §2.5 (validate + resolve), §2.6 (no-op providers).

**Risks/Notes:**

- ⚠️ `forRootAsync` is still a stub — complete wiring of async channels goes in Phase 4
- ⚠️ Inferring "class vs instance" via `prototype.constructor` is a heuristic — works for ES2015+ classes but can fail for minified classes. Mitigation: document in JSDoc that the consumer should pass an **instance** (preferred) or a **non-minified class**
- ⚠️ NestJS `@Global()` decorator is class-level — we use `global: true` in the DynamicModule, which NestJS honors

### 2.9 Server barrel exports

**Objective:** Expose the public API of the server subpath.

**Files to create/modify:**

- `src/server/index.ts`

**Public exports from `src/server/index.ts`:**

- **Module:** `BymaxNotificationModule`
- **Injection tokens** (all 7): `BYMAX_NOTIFICATION_OPTIONS`, `BYMAX_NOTIFICATION_EMAIL_PROVIDER`, `BYMAX_NOTIFICATION_OTP_STORAGE`, `BYMAX_NOTIFICATION_SMS_PROVIDER`, `BYMAX_NOTIFICATION_PUSH_PROVIDER`, `BYMAX_NOTIFICATION_TEMPLATE_RENDERER`, `BYMAX_NOTIFICATION_LOG_REPOSITORY`
- **Constants:** `NOTIFICATION_PURPOSES`, `CanonicalNotificationPurpose` (type)
- **Interface types:** `IEmailProvider`, `EmailSendOptions`, `EmailSendResult`, `IOtpStorage`, `OtpEntry`, `OtpVerifyResult`, `IEmailTemplateRenderer`, `RenderedEmail`, `INotificationLogRepository`, `NotificationLogEntry`, `ISmsProvider`, `SmsSendOptions`, `SmsSendResult`, `IPushProvider`, `PushSendOptions`, `PushSendResult`
- **Module options types:** `BymaxNotificationModuleOptions`, `BymaxNotificationModuleAsyncOptions`, `BymaxNotificationModuleOptionsFactory`, `GlobalOptions`, `EmailChannelOptions`, `OtpChannelOptions`, `OtpPurposeConfig`, `SmsChannelOptions`, `PushChannelOptions`, `AuditOptions`
- **Resolved options types** (advanced consumers): `ResolvedNotificationOptions`, `ResolvedEmailOptions`, `ResolvedOtpOptions`, `ResolvedAuditOptions`
- **Reference providers:** `NoOpEmailProvider`, `NoOpNotificationLogRepository`, `DefaultTemplateRenderer` (+ `DefaultTemplateRendererOptions`)
- **Errors:** `NotificationException`, `NOTIFICATION_ERROR_DEFINITIONS`, `NotificationErrorKey` (type), `NOTIFICATION_ERROR_CODES` (re-exported from shared)
- **Re-export from `../shared`** for convenience: `OtpPurpose`, `NotificationChannel`, `NotificationErrorResponse`, `DEFAULT_TTLS`, `NotificationErrorCode`

Phase 2 adds: `EmailService`, `OtpService`, `NotificationService`, `ResendEmailProvider`, `InMemoryOtpStorage`, `RedisOtpStorage`, `RedisOtpStorageOptions`, `RedisLike`, `hashTenantRecipient`, `generateOtpCode`, `safeCompare`.

**Acceptance criteria:**

- [ ] All public symbols exported
- [ ] `pnpm build` produces `dist/server/index.{mjs,cjs,d.ts}`
- [ ] `node -e "import('./dist/server/index.mjs').then(m => console.log(Object.keys(m).sort()))"` lists all expected exports
- [ ] No `_internal*` symbol or internal implementation is leaked
- [ ] `import('@bymax-one/nest-notification').BymaxNotificationModule.forRoot({...})` works in a consumer fixture

**Validation commands:**

```bash
pnpm build
node -e "import('./dist/server/index.mjs').then(m => console.log(Object.keys(m).sort()))"
```

**Dependencies:** §2.3 a §2.8.

### 2.10 Tests for Phase 1

**Objective:** Achieve **100% coverage on every implemented file** (`validate-options.ts`, `resolved-options.ts`, `notification-exception.ts`, `code-generator.ts`, `hash.ts`, `timing-safe-compare.ts`, `bymax-notification.module.ts`, `default-template-renderer.ts`, no-op providers), with extra mutation focus on the crypto paths.

**Files to create:**

```
src/
├── server/
│   ├── config/
│   │   ├── validate-options.spec.ts
│   │   └── resolved-options.spec.ts
│   ├── errors/
│   │   └── notification-exception.spec.ts
│   ├── providers/
│   │   ├── no-op-email.provider.spec.ts
│   │   ├── no-op-notification-log.repository.spec.ts
│   │   └── default-template-renderer.spec.ts
│   ├── utils/
│   │   ├── hash.spec.ts
│   │   ├── code-generator.spec.ts
│   │   └── timing-safe-compare.spec.ts
│   └── bymax-notification.module.spec.ts
└── shared/
    └── constants/
        └── error-codes.spec.ts
```

**AAA pattern + descriptive name:**

```typescript
it('should <do something> when <condition>', () => {
  // Arrange — setup
  // Act     — execute
  // Assert  — verify
})
```

**Test cases organized by file (AAA pattern; one descriptive `it()` per row):**

#### `validate-options.spec.ts` — required cases

- Accept minimal email-only options
- Reject options with no channels (`At least one channel must be configured`)
- Reject `email` config missing `provider`
- Reject `email` config missing `defaultFrom`
- Reject `email` config with malformed `defaultFrom` (no `@`)
- Reject `otp` config missing `storage`
- Reject `otp` config with `defaultLength` outside [1, 32] (throws `NotificationException OTP_INVALID_LENGTH`)
- Reject `otp` config with invalid `defaultCodeType`
- Reject `otp` config with `defaultTtlSeconds <= 0`
- Reject `otp` config with `defaultMaxAttempts < 1`
- Reject `otp` config with `resendCooldownSeconds < 0`
- Reject `sms` and `push` in v0.1 with explicit "not yet implemented" message
- Reject `audit` config missing `repository`

#### `resolved-options.spec.ts` — required cases

- Apply global defaults (`redisNamespace='notification'`, `defaultLocale='en'`)
- Preserve consumer global overrides
- Omit channel sections consumer did not configure (`resolved.otp === undefined`)
- Apply OTP defaults (length=6, codeType='numeric', ttl=600, maxAttempts=5, cooldown=60, consumeOnVerify=false)
- Deep-freeze the resolved options — mutation throws `TypeError` in strict mode
- Preserve `perPurpose` overrides

#### `notification-exception.spec.ts` — required cases

- Exposes `code` and HTTP status from definition
- Embeds `details` in response body shape `{ error: { code, message, details } }`
- Defaults `details` to `null` when not provided
- Allows overriding HTTP status via constructor param
- Allows overriding message via constructor param
- Covers every key in `NOTIFICATION_ERROR_DEFINITIONS` (loop and instantiate)

#### `hash.spec.ts` — required cases

- Produces 64-char lowercase hex string
- Deterministic (same input → same output)
- Order-sensitive (`hash('a', 'b') !== hash('b', 'a')`)
- Different tenants with same recipient produce different hashes (multi-tenancy gate)

#### `code-generator.spec.ts` — required cases

- Numeric code matches `/^\d{6}$/` for `length=6, type='numeric'`
- Preserves leading zeros for short numeric codes (1000-iteration property test — all 6 chars)
- Long numeric code `length=20` returns 20 digits and does NOT throw (regression for the `10 ** length` overflow)
- Alpha code (200 iterations) never contains 'I' or 'O'
- Alphanumeric code (200 iterations) never contains '0', '1', 'I', 'O'
- Throws `NotificationException OTP_INVALID_LENGTH` for length < 1 or > 32
- High entropy — 1000 distinct numeric codes produce ≥ 995 unique values (birthday paradox tolerance)

#### `timing-safe-compare.spec.ts` — required cases

- Returns `true` for identical strings
- Returns `false` for different strings of same length
- Returns `false` for different lengths WITHOUT throwing
- Handles empty strings on both sides
- Handles UTF-8 (emojis, accented chars)

#### `default-template-renderer.spec.ts` — required cases (Phase 1 minimal)

- Renders with consumer variables — output matches expected interpolated string
- HTML-escapes variable values **in the html body only** (XSS gate — `<script>` → `&lt;script&gt;`; same value in `subject`/`text` stays raw)
- Falls back to `en` locale when target locale missing
- Throws with template name in message when template not found
- `hasTemplate(name, locale)` returns boolean correctly

#### `bymax-notification.module.spec.ts` — required cases

- Registers `BYMAX_NOTIFICATION_EMAIL_PROVIDER` when email channel configured
- Does NOT register `BYMAX_NOTIFICATION_OTP_STORAGE` when otp channel not configured (`module.get(...)` throws)
- Provides `NoOpNotificationLogRepository` automatically when audit not configured
- Accepts both class (constructor reference) and instance as provider (verify both create injectable)
- `forRoot({})` throws (`validateOptions` runs first)
- `BYMAX_NOTIFICATION_OPTIONS` is globally available (verify via `module.get`)

#### `no-op-email.provider.spec.ts` — required cases

- `name === 'noop'`, `isConfigured() === true`
- `send()` returns `messageId` starting with `'noop-'`
- `send()` NEVER logs `options.html` or `options.text` (verify via Logger spy on `debug`)
- `send()` logs only `to` + `subject`

#### `no-op-notification-log.repository.spec.ts` — required cases

- `name === 'noop'`
- `create()` resolves without side effects (idempotent silent discard)

**Acceptance criteria:**

- [ ] All listed `.spec.ts` files created
- [ ] `pnpm test:cov` reports **100% global** coverage
- [ ] Coverage per file (all **100%**): `validate-options.ts`, `resolved-options.ts`, `notification-exception.ts`, `hash.ts`, `code-generator.ts`, `timing-safe-compare.ts`, `bymax-notification.module.ts`, `default-template-renderer.ts`
- [ ] `pnpm test` zero failures
- [ ] Mutation score (run optionally) ≥ 95% (target 100%) in `code-generator.ts` and `timing-safe-compare.ts`
- [ ] `clearMocks: true` and `restoreMocks: true` honored (no spillover between tests)

**Validation commands:**

```bash
pnpm test:cov
# Expected output: 80%+ global, 95%+ on critical paths, all tests passing
```

**Dependencies:** §2.3 through §2.9 (code to test).

**Risks/Notes:**

- ⚠️ `code-generator` tests that validate the absence of forbidden chars (I, O, 0, 1) need N=200+ iterations for a low probability of false positives
- ⚠️ Mutation tests may flag early-exit in `validateOptions` — confirm that each path throws the correct exception
- ⚠️ `Test.createTestingModule` from `@nestjs/testing` is the standard; don't roll your own container

### 2.11 Phase 1 validation

**Final validation commands:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size && pnpm check:no-prisma
```

Plus the **error codes sync gate** (server vs shared) via node script that imports both `dist/server/index.mjs` and `dist/shared/index.mjs`, compares `Object.values(NOTIFICATION_ERROR_DEFINITIONS).map(d => d.code).sort()` against `Object.values(NOTIFICATION_ERROR_CODES).sort()`, exits with code 1 on mismatch.

Plus a **smoke test** that imports `BymaxNotificationModule.forRoot({ email: { provider: new NoOpEmailProvider(), defaultFrom: 'noreply@example.com' } })` and verifies:
- `module.module.name === 'BymaxNotificationModule'`
- `module.global === true`
- `module.providers.length` matches expected count (4: options + audit + email + renderer)
- Shared subpath import works: `DEFAULT_TTLS.OTP_EMAIL_VERIFICATION_SECONDS === 3600`
- `NOTIFICATION_PURPOSES.EMAIL_VERIFICATION === 'email_verification'`
- `NOTIFICATION_ERROR_CODES.OTP_COOLDOWN_ACTIVE === 'notification.otp_cooldown_active'`

**Done criteria to close Phase 1:**

- [ ] All commands above pass
- [ ] Coverage thresholds met
- [ ] `git status` clean after commits with Conventional Commits (`feat(notification): scaffold project structure`, `feat(notification): add shared types and error codes`, `feat(notification): define provider interfaces`, etc.)
- [ ] `/bymax-quality:code-review` run and findings applied
- [ ] Pull request opened with label `phase-1`

---

## 3. Phase 2 — EmailService + OtpService

> **Phase objective:** Implement the two central services (`EmailService`, `OtpService`) with all public methods defined in spec §6, plus the reference providers (`ResendEmailProvider`, `RedisOtpStorage`, `InMemoryOtpStorage`). At the end, the consumer can register the module, send emails and generate/verify OTPs end-to-end. **This is the highest complexity phase** — concentrates most of the lib's business logic.
>
> **Complexity:** HIGH. The attempt counter and the resend cooldown MUST be atomic — verify goes through `storage.consumeAttempt()` (Redis Lua / single-threaded Map) and generate claims the cooldown with `storage.tryAcquireCooldown()` (`SET NX EX`), releasing it on delivery failure. Plus length-guarded timing-safe comparison and the OtpService→EmailService delegation for `deliverVia: 'email'`.
>
> **Critical paths for 100% coverage + mutation focus:** `src/server/services/email.service.ts`, `src/server/services/otp.service.ts`, `src/server/providers/redis-otp.storage.ts`, `src/server/providers/in-memory-otp.storage.ts`, `src/server/providers/resend-email.provider.ts`.

### 3.1 `ResendEmailProvider` — reference implementation

**Objective:** Implement the Resend adapter as a reference for `IEmailProvider`. Lazy-load the `resend` SDK to avoid failing when the consumer hasn't installed the peer dep.

**Files to create:**

```
src/server/providers/resend-email.provider.ts
```

**Skeleton (full implementation pattern in spec §5.1.1):**

```typescript
export interface ResendEmailProviderOptions { apiKey?: string }

@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  readonly name = 'resend'
  private client: ResendLike | null = null

  constructor(private readonly options: ResendEmailProviderOptions = {}) {}

  isConfigured(): boolean { return Boolean(this.options.apiKey) }
  async send(options: EmailSendOptions): Promise<EmailSendResult>
  private async getClient(): Promise<ResendLike>  // lazy import of `resend` peer dep
}
```

**Implementation algorithm:**

1. `send()`:
   - `client = await getClient()` — lazy-loads `resend` peer dep via dynamic `import('resend')`
   - Build `from = fromName ? "Name <email>" : email`
   - Call `client.emails.send({ from, to, subject, html, text, replyTo, cc, bcc, tags, headers, attachments })`
   - If `result.error`: log warn via NestJS Logger **without** including body (`result.error.message` only) → throw `Error('Resend send failed: ...')`
   - If `!result.data?.id`: throw `Error('Resend returned no message ID')`
   - Return `{ messageId: result.data.id }`

2. `getClient()`:
   - If cached: return cached
   - If there is no `apiKey`: throw `'Missing API key — pass { apiKey } to the constructor'`
   - `try { const mod = await import('resend'); ResendCtor = mod.Resend }` → if fails, throw `'`resend` package is not installed. Run `pnpm add resend` in the consumer app.'`
   - Cache new instance

3. Type forward declaration `ResendLike` lives locally — avoids hard import of `resend` types at compile time. Shape mirrors the subset of `Resend.emails.send` used.

**Acceptance criteria:**

- [ ] `isConfigured()` returns `false` when `apiKey` is not provided
- [ ] `send()` without `apiKey` throws "Missing API key"
- [ ] `send()` without `resend` installed throws "package is not installed" with `pnpm add resend` instruction
- [ ] `send()` builds `from` in the `'Name <email@host>'` format when `fromName` is provided
- [ ] `send()` propagates Resend errors as `Error` (mapped to `NotificationException` in the EmailService)
- [ ] Provider NEVER logs `options.html` or `options.text` (verifiable with a logger spy)
- [ ] Coverage 100% (lazy `import('resend')` mocked, including the "package not installed" path)

**Validation commands:**

```bash
pnpm test src/server/providers/resend-email.provider.spec.ts
```

**Dependencies:** §2.3 (`IEmailProvider`).

**Risks/Notes:**

- ⚠️ Lazy import via `import('resend')` in runtime — works in ESM and CJS (tsup generates shim for CJS)
- ⚠️ For tests, mock the `import` function via `jest.mock('resend', () => ({ Resend: jest.fn() }))`
- ⚠️ The Resend SDK returns `replyTo` in camelCase (not `reply_to`); confirm with the official docs

### 3.2 `InMemoryOtpStorage` — implementation for dev/test

**Objective:** Implement an in-memory storage that satisfies `IOtpStorage`. Useful in unit tests and local dev without Redis. Atomic by construction — no `await` between read and write, so the single-threaded event loop cannot interleave two operations.

**Files to create:**

```
src/server/providers/in-memory-otp.storage.ts
```

**Skeleton:**

```typescript
@Injectable()
export class InMemoryOtpStorage implements IOtpStorage {
  readonly name = 'memory'
  private readonly store = new Map<string, OtpEntry>()
  private readonly cooldowns = new Map<string, number>()  // value = epoch-ms expiry
  // All IOtpStorage methods + test helpers `clear()` / `size()` (not in interface)
}
```

**Implementation algorithm:**

- Key collapsed for `Map`: `${tenantId}::${recipient}::${purpose}`
- `set(...)` — `store.set(key, entry)`
- `get(...)` — `store.get(key)`; if `entry.expiresAt < Date.now()` → `store.delete(key)` + return null (self-eviction)
- `consumeAttempt(...)` — read entry; if absent/expired → `{ status: 'not_found' }` (delete if expired); if `attempts >= maxAttempts` → delete + `{ status: 'max_attempts' }`; else `entry.attempts++`, `store.set(key, entry)`, return `{ status: 'ok', entry }`. No `await` between read and write → atomic.
- `update(...)` — `if (store.has(key)) store.set(key, entry)` (no resurrection of an evicted key)
- `delete(...)` — `store.delete(key)` (idempotent)
- `tryAcquireCooldown(..., ttlSeconds)` — `const existing = cooldowns.get(key); if (existing && existing > Date.now()) return false; cooldowns.set(key, Date.now() + ttlSeconds * 1000); return true`
- `getCooldown(...)` — `const expiry = cooldowns.get(key); if (!expiry) return 0; const remaining = Math.ceil((expiry - Date.now()) / 1000); if (remaining <= 0) { cooldowns.delete(key); return 0 } return remaining`
- `clearCooldown(...)` — `cooldowns.delete(key)`
- Test helpers (not part of `IOtpStorage`):
  - `clear()` — wipes both maps
  - `size()` — returns `{ otps: store.size, cooldowns: cooldowns.size }`

**Acceptance criteria:**

- [ ] `set()` + `get()` returns identical entry
- [ ] `get()` after `expiresAt` returns `null` and removes the entry (self-evict)
- [ ] `consumeAttempt()` returns `{ status: 'not_found' }` for a missing or expired entry
- [ ] `consumeAttempt()` increments `attempts` by exactly 1 and returns `{ status: 'ok', entry }`
- [ ] `consumeAttempt()` returns `{ status: 'max_attempts' }` and deletes when `attempts >= maxAttempts`
- [ ] `update()` on a nonexistent key is a no-op (does not create a new one)
- [ ] `delete()` is idempotent (does not throw on a nonexistent key)
- [ ] `tryAcquireCooldown()` returns `true` first, then `false` while active; `getCooldown()` returns remaining seconds
- [ ] `getCooldown()` after TTL returns 0 and removes the cooldown
- [ ] `clearCooldown()` removes the cooldown (next `tryAcquireCooldown` returns `true`)
- [ ] Keys from different tenants/recipients/purposes do not collide
- [ ] Helper `clear()` zeroes all state (not exposed via `IOtpStorage`)
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/providers/in-memory-otp.storage.spec.ts
```

**Dependencies:** §2.3.

**Risks/Notes:**

- ⚠️ Self-eviction only happens on `get()` — old entries may pile up in the `Map` if never read. Acceptable (lib expects only for dev). For production, use `RedisOtpStorage` which has native TTL.
- ⚠️ Not thread-safe — Node.js single-threaded already guarantees atomicity at the event loop tick level

### 3.3 `RedisOtpStorage` — default implementation (production)

**Objective:** Implement the Redis-backed storage with SHA-256 key hashing for multi-tenant privacy, and the **atomic** primitives (`consumeAttempt` via a Lua script, `tryAcquireCooldown` via `SET NX EX`).

**Files to create:**

```
src/server/providers/redis-otp.storage.ts
```

**Skeleton (full implementation pattern in spec §5.2.1):**

```typescript
export interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null>
  setex(key: string, ttlSeconds: number, value: string): Promise<'OK'>
  del(...keys: string[]): Promise<number>
  ttl(key: string): Promise<number>
  pttl(key: string): Promise<number>            // used by the consumeAttempt Lua script (preserve ms TTL on rewrite)
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>  // atomic consumeAttempt
}

export interface RedisOtpStorageOptions {
  redisClient: RedisLike       // ioredis is structurally compatible
  namespace?: string           // default 'notification'
}

@Injectable()
export class RedisOtpStorage implements IOtpStorage {
  readonly name = 'redis'
  constructor(private readonly options: RedisOtpStorageOptions) {}
  // ... full implementation
}
```

**Key format (see Appendix E for full table):**

- OTP entry: `{namespace}:otp:{purpose}:{sha256(tenantId:recipient)}` — stores JSON of `OtpEntry`
- Cooldown lock: `{namespace}:otp_cd:{purpose}:{sha256(tenantId:recipient)}` — stores sentinel `'1'`

**Implementation algorithm:**

- `set(tenant, recipient, purpose, entry)`:
  - `ttlSec = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000))`
  - `await redis.setex(otpKey(...), ttlSec, JSON.stringify(entry))`

- `get(tenant, recipient, purpose)` — read-only, used by `getStatus`:
  - `raw = await redis.get(otpKey(...))` → if null, return null
  - `try { return JSON.parse(raw) } catch { await delete(...); return null }` (defensive)

- `consumeAttempt(tenant, recipient, purpose)` — **ATOMIC verify primitive** via a single `EVAL`:
  - The Lua script (one `KEYS[1]`, `ARGV[1] = Date.now()`) does, indivisibly: `GET` → if missing `{status:'not_found'}`; if `expiresAt < now` `DEL` + `{status:'not_found'}`; if `attempts >= maxAttempts` `DEL` + `{status:'max_attempts'}`; else `attempts = attempts + 1`, re-`SET` with `PX = PTTL` (preserve original expiry), return `{status:'ok', entry}` (JSON-encoded both ways).
  - Folding read→check→increment→write into the script is what makes `maxAttempts` hold under concurrency. A service-side `get`+`update` would race.

- `update(tenant, recipient, purpose, entry)` — only to mark `validated`/metadata after success:
  - `await redis.set(key, JSON.stringify(entry), 'KEEPTTL', 'XX')`
  - `KEEPTTL` preserves the original expiry; `XX` avoids resurrecting an entry that already expired.

- `delete(tenant, recipient, purpose)`:
  - `await redis.del(otpKey(...))` (idempotent)

- `tryAcquireCooldown(tenant, recipient, purpose, ttlSeconds)` — **ATOMIC** check-and-set:
  - `const res = await redis.set(cooldownKey(...), '1', 'EX', ttlSeconds, 'NX')`
  - `return res === 'OK'` (false when a cooldown is already active). Acts as a short-lived lock around generate/resend.

- `getCooldown(tenant, recipient, purpose)`:
  - `ttl = await redis.ttl(cooldownKey(...))`
  - ioredis returns: positive = seconds left, -1 = no TTL, -2 = key doesn't exist
  - Return `ttl > 0 ? ttl : 0`

- `clearCooldown(tenant, recipient, purpose)`:
  - `await redis.del(cooldownKey(...))` (called on delivery failure and on `consume`)

- Private helpers `otpKey()` / `cooldownKey()` use `hashTenantRecipient(tenantId, recipient)` from `utils/hash.ts`. The Lua script is a `private static readonly` string.

**Forward-declaring `RedisLike`** locally (instead of `import type { Redis } from 'ioredis'`) avoids requiring ioredis at compile time — consumers using DynamoDB/Memcached storage do not pay the cost. ioredis is structurally compatible with the `eval`/`pttl` signatures above.

**Acceptance criteria:**

- [ ] Keys built in the format `{namespace}:otp:{purpose}:{sha256}` (verifiable via mock Redis inspection)
- [ ] `set()` uses `SETEX` with TTL derived from `expiresAt`
- [ ] `consumeAttempt()` increments `attempts` by 1 and returns `{ status: 'ok', entry }` (verify via the entry stored back in the mock)
- [ ] `consumeAttempt()` returns `{ status: 'max_attempts' }` and deletes the key when at the limit; `{ status: 'not_found' }` for missing/expired
- [ ] Two interleaved `consumeAttempt()` calls never exceed `maxAttempts` (concurrency regression)
- [ ] `update()` uses `SET ... KEEPTTL XX` — verifiable that it does NOT create an entry when the key was removed, and preserves the TTL
- [ ] `get()` returns the parsed entry when it exists; corrupted (invalid JSON) → deletes and returns null
- [ ] `tryAcquireCooldown()` uses `SET ... NX EX` — returns `true` first then `false` while active
- [ ] `getCooldown()` returns 0 when the key does not exist (Redis TTL -2), seconds when it exists; `clearCooldown()` removes it
- [ ] Hashing used: `sha256(tenantId:recipient)` — key does NOT contain plaintext email
- [ ] Coverage 100% (Redis mocked via `ioredis-mock`)

**Validation commands:**

```bash
pnpm test src/server/providers/redis-otp.storage.spec.ts
```

**Dependencies:** §2.3, §2.7 (hash).

**Risks/Notes:**

- ⚠️ Use `ioredis-mock` in tests — do not connect to a real Redis. Confirm it supports `eval` (Lua) and `set ... KEEPTTL`; if a flag is unsupported by the mock version, assert behavior via a thin hand-rolled stub for that one path.
- ⚠️ Positional arguments of `redis.set(key, val, 'KEEPTTL', 'XX')` and `redis.set(key, '1', 'EX', ttl, 'NX')` are order-sensitive; tests must verify the exact argument order (mutation testing catches swaps)
- ⚠️ `Math.ceil` on the TTL — an entry with `expiresAt = Date.now() + 500ms` results in TTL = 1s (ok)

### 3.4 `EmailService` — raw send + sendTemplate

**Objective:** Implement `EmailService.send()` (raw body provided by the caller) and `EmailService.sendTemplate()` (delegates to the renderer). HTML escaping happens in the renderer during `sendTemplate`, not on raw `send`.

**Files to create:**

```
src/server/services/email.service.ts
```

**Skeleton (signature only — full implementation in `docs/technical_specification.md` §6.1):**

```typescript
@Injectable()
export class EmailService {
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS) private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_EMAIL_PROVIDER) private readonly provider: IEmailProvider,
    @Inject(BYMAX_NOTIFICATION_TEMPLATE_RENDERER) private readonly renderer: IEmailTemplateRenderer,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY) private readonly auditLog: INotificationLogRepository,
  ) {}

  async send(input: { /* raw body, see spec §6.1 */ }): Promise<{ messageId: string }>
  async sendTemplate(input: { /* template name + data, see spec §6.1 */ }): Promise<{ messageId: string }>
  isConfigured(): boolean
  private async audit(entry: NotificationLogEntry): Promise<void>  // swallows per options.audit.swallowErrors
  private firstRecipient(to: string | string[]): string
}
```

**Implementation algorithm:**

1. `send()`:
   - Throw `EMAIL_PROVIDER_NOT_CONFIGURED` if `options.email` missing OR `provider.isConfigured() === false`
   - **Attachment guard:** if `attachments` present, sum their byte lengths (`Buffer.byteLength` for strings, `.length` for Buffers); throw `EMAIL_ATTACHMENTS_TOO_LARGE` when the total exceeds `options.email.maxAttachmentBytes`
   - Build `EmailSendOptions` applying defaults: `from ?? defaultFrom`, `fromName ?? defaultFromName`, `replyTo ?? defaultReplyTo`, `tags = [...defaultTags, ...input.tags]`
   - `try { await provider.send(...) }` → `audit({ verb: 'sent', messageId })` → return
   - `catch (err) { await audit({ verb: 'failed', errorMessage: err.message }); throw NotificationException('EMAIL_SEND_FAILED', { providerName }) }`
   - **Do NOT expose underlying provider message to caller** — only to audit log

2. `sendTemplate()`:
   - Resolve `locale = input.locale ?? options.global.defaultLocale`
   - `renderer.hasTemplate(template, locale)` → if false, try `hasTemplate(template, 'en')` → if false, throw `TEMPLATE_NOT_FOUND`
   - `try { rendered = await renderer.render(...) } catch { throw TEMPLATE_RENDER_FAILED }`
   - Forward to `send()` with `subject`, `html`, `text` from rendered; append `{ name: 'template', value: input.template }` to tags

3. `audit()`:
   - Apply `options.audit.maskRecipient` to `entry.recipient` before writing (when `to` is an array, mask each and join with `, `)
   - `try { await auditLog.create(entry) } catch (err) { if (!swallow) throw AUDIT_LOG_FAILED }`

**Acceptance criteria:**

- [ ] `send()` returns `messageId` on success
- [ ] `send()` throws `EMAIL_PROVIDER_NOT_CONFIGURED` when provider not configured
- [ ] `send()` throws `EMAIL_SEND_FAILED` when provider fails
- [ ] `send()` throws `EMAIL_ATTACHMENTS_TOO_LARGE` when total attachment bytes exceed `maxAttachmentBytes`
- [ ] `send()` concatenates `defaultTags` + caller tags (no dedup)
- [ ] `send()` applies defaults (`defaultFrom`, `defaultFromName`, `defaultReplyTo`) when the caller omits them
- [ ] `sendTemplate()` calls `renderer.hasTemplate(template, locale)` + fallback `'en'`
- [ ] `sendTemplate()` throws `TEMPLATE_NOT_FOUND` when neither locale nor `'en'` exists
- [ ] `sendTemplate()` throws `TEMPLATE_RENDER_FAILED` when the renderer throws
- [ ] `sendTemplate()` appends tag `{ name: 'template', value: <name> }`
- [ ] Audit log called on success and on failure (`verb: 'sent'` or `'failed'`); recipient passes through `maskRecipient`
- [ ] Audit log does NOT propagate the error to the caller when `swallowErrors: true` (default)
- [ ] Audit log PROPAGATES the error as `AUDIT_LOG_FAILED` when `swallowErrors: false`
- [ ] `isConfigured()` returns `false` when `email` is not configured OR provider is not configured
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/email.service.spec.ts
```

**Dependencies:** §2.3 (interfaces), §2.4 (constants/exception), §2.5 (resolved options).

**Risks/Notes:**

- ⚠️ `send()` called from `sendTemplate()` re-checks `isConfigured()` redundantly — acceptable (defensive)
- ⚠️ `audit()` is private — spy-based tests don't work directly; test via observable behavior (auditLog.create called N times)
- ⚠️ NEVER log `input.html` or `rendered.html` in the audit `errorMessage` — only the provider's message

### 3.5 `OtpService` — generation, verification, consumption

**Objective:** Implement all public OtpService methods (`generate`, `verify`, `consume`, `resend`, `getStatus`, `isConfigured`).

**Files to create:**

```
src/server/services/otp.service.ts
```

**Skeleton (signature only — full implementation in `docs/technical_specification.md` §6.2):**

```typescript
@Injectable()
export class OtpService {
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS) private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_OTP_STORAGE) private readonly storage: IOtpStorage,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY) private readonly auditLog: INotificationLogRepository,
    @Optional() @Inject(EmailService) private readonly emailService?: EmailService,
  ) {}

  async generate(input): Promise<{ expiresAt: number; cooldownSeconds: number }>
  async verify(input): Promise<OtpVerifyResult>
  async consume(input): Promise<void>
  async resend(input): Promise<{ expiresAt: number; cooldownSeconds: number }>  // alias of generate
  async getStatus(input): Promise<{ exists, expiresAt?, attempts?, maxAttempts?, cooldownSeconds, validated? }>
  isConfigured(): boolean

  // Effective per-purpose config comes from options.otp.resolveForPurpose(purpose) (§4.5) — no local merge needed
  private auditFireAndForget(entry): Promise<void>             // swallows per options.audit.swallowErrors, applies maskRecipient
}
```

**Implementation algorithm:**

#### `generate(input)`

```
1. Throw OTP_STORAGE_NOT_CONFIGURED if options.otp missing
2. cfg = options.otp.resolveForPurpose(input.purpose)
3. acquired = await storage.tryAcquireCooldown(tenantId, recipient, purpose, cfg.resendCooldownSeconds)  // ATOMIC SET NX EX
   if !acquired:
     remaining = await storage.getCooldown(tenantId, recipient, purpose)
     audit({ verb: 'cooldown_blocked' })
     throw OTP_COOLDOWN_ACTIVE { remainingSeconds: remaining, retryAfter, expiresAt }  // see §4.4
4. code = generateOtpCode(cfg.length, cfg.codeType)             // crypto-secure, digit-by-digit
5. expiresAt = Date.now() + cfg.ttlSeconds * 1000
6. entry = { code, expiresAt, attempts: 0, maxAttempts: cfg.maxAttempts }
7. await storage.set(tenantId, recipient, purpose, entry)        // overwrites previous (resets attempts) — gated by step 3
8. if deliverVia === 'email':
     if !emailService:
       await storage.clearCooldown(...); await storage.delete(...)
       throw OTP_EMAIL_DELIVERY_NOT_CONFIGURED
     try {
       await emailService.sendTemplate({ tenantId, to: recipient,
         template: input.emailTemplate ?? 'otp_code',
         data: { ...input.emailData, code, expiresInMinutes, purpose }, locale, userId })
     } catch (err) {
       await storage.clearCooldown(...); await storage.delete(...)   // release lock + remove orphan — no lockout
       audit({ verb: 'failed', errorMessage: err.message })
       throw err
     }
9. audit({ verb: 'generated' })  // CRITICAL: never include `code` in audit metadata
10. return { expiresAt, cooldownSeconds: cfg.resendCooldownSeconds }
```

> Claiming the cooldown atomically *before* generating (step 3) and releasing it on delivery failure (step 8) closes the race where two concurrent calls both reset `attempts`, and avoids locking the user out for 60s when an email bounces. `deliverVia: 'manual'` skips step 8 and the cooldown stays.

#### `verify(input)`

```
1. Throw OTP_STORAGE_NOT_CONFIGURED if options.otp missing
2. result = await storage.consumeAttempt(tenantId, recipient, purpose)   // ATOMIC (Lua / single Map op)
3. if result.status === 'not_found' → audit('failed','not_found') → { valid: false, reason: 'not_found' }
       (expired entries are reported as not_found — the entry is already gone; see spec §11.5)
4. if result.status === 'max_attempts' → audit('max_attempts_exceeded') → { valid: false, reason: 'max_attempts' }
5. entry = result.entry   // attempts already incremented atomically by the storage
6. if !safeCompare(entry.code, input.code):
     remainingAttempts = entry.maxAttempts - entry.attempts
     audit('failed','invalid_code')
     return { valid: false, reason: 'invalid_code', remainingAttempts }
7. // success
   if options.otp.consumeOnVerify:
     await storage.delete(...); await storage.clearCooldown(...)
   else:
     await storage.update(..., { ...entry, validated: true })   // KEEPTTL XX
   audit('verified')
   return { valid: true }
```

#### `consume(input)`

```
1. Throw OTP_STORAGE_NOT_CONFIGURED if options.otp missing
2. await storage.delete(...)
3. await storage.clearCooldown(...)
   NOTE: clearing the cooldown lets a cancelled/completed flow restart immediately
   (e.g. user wants a fresh code with a corrected email). Idempotent.
```

#### `getStatus(input)`

```
1. const [entry, cooldown] = await Promise.all([storage.get(...), storage.getCooldown(...)])
2. if !entry: return { exists: false, cooldownSeconds: cooldown }
3. return { exists: true, expiresAt, attempts, maxAttempts, validated, cooldownSeconds }
   // CRITICAL: never return `code`
```

**Acceptance criteria:**

- [ ] `generate()` throws `OTP_COOLDOWN_ACTIVE` when `tryAcquireCooldown` returns false
- [ ] `generate()` acquires the cooldown **before** persisting the OTP (atomic NX lock)
- [ ] `generate()` persists entry with `attempts: 0` and `expiresAt = now + ttlSeconds*1000`
- [ ] `generate({ deliverVia: 'email' })` calls `emailService.sendTemplate` with `data.code` populated
- [ ] `generate({ deliverVia: 'email' })` without an EmailService throws `OTP_EMAIL_DELIVERY_NOT_CONFIGURED`
- [ ] `generate({ deliverVia: 'email' })` on send failure clears the cooldown and deletes the OTP (no lockout, no orphan), then rethrows
- [ ] `generate({ deliverVia: 'manual' })` does NOT call emailService and keeps the cooldown
- [ ] `verify()` on a nonexistent/expired entry returns `{ valid: false, reason: 'not_found' }`
- [ ] `verify()` on `attempts >= maxAttempts` returns `{ valid: false, reason: 'max_attempts' }` (storage deletes the entry)
- [ ] `verify()` increments `attempts` via `storage.consumeAttempt` (atomic) — two interleaved verifies never exceed `maxAttempts`
- [ ] `verify()` returns the correct `remainingAttempts` when code is invalid
- [ ] `verify()` success sets `validated: true` when `consumeOnVerify: false`
- [ ] `verify()` success deletes the entry AND clears the cooldown when `consumeOnVerify: true`
- [ ] `consume()` deletes the entry and clears the cooldown (idempotent)
- [ ] `resend()` is a functional alias of `generate()`
- [ ] `getStatus()` returns `{ exists: false }` when there is no entry
- [ ] `getStatus()` returns truncated entry (without `code`) when it exists
- [ ] `perPurpose` overrides applied correctly (via `resolveForPurpose`)
- [ ] Audit log called on EVERY operation (generated, verified, failed, cooldown_blocked, max_attempts_exceeded)
- [ ] Audit log NEVER receives `code` in `metadata`
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/services/otp.service.spec.ts
```

**Dependencies:** §2.3 (interfaces), §2.4 (constants), §2.5 (resolved options), §2.7 (code-generator, timing-safe-compare), §3.4 (EmailService).

**Risks/Notes:**

- ⚠️ The attempt counter is mutated ONLY inside `storage.consumeAttempt` (atomic). The service must never do its own `get`+`update` to increment — that would reintroduce the race the storage exists to prevent.
- ⚠️ `consumeAttempt` increments attempts **before** the code comparison — intentional: even a matching guess counts as an attempt (password-reset audit), and the count stays bounded under concurrency.
- ⚠️ `EmailService` is `@Optional()` — if the OTP channel is configured without email, OTP only works with `deliverVia: 'manual'`; `deliverVia: 'email'` throws `OTP_EMAIL_DELIVERY_NOT_CONFIGURED`.

### 3.6 `NotificationService` — orquestrador

**Objective:** Unified service for consumers that want a channel-agnostic API (`notification.dispatch({channel, payload})`).

**Files to create:**

```
src/server/services/notification.service.ts
```

**Skeleton:**

```typescript
export type DispatchInput =
  | { channel: 'email'; tenantId: string; payload: EmailDispatchPayload }
  | { channel: 'otp'; tenantId: string; payload: OtpDispatchPayload }
  // sms/push channels added in v0.2

export interface EmailDispatchPayload {
  to: string | string[]
  subject?: string; html?: string; text?: string
  template?: string; data?: Record<string, unknown>
  locale?: string; userId?: string
}

export interface OtpDispatchPayload {
  recipient: string; purpose: string
  action?: 'generate' | 'verify' | 'consume'   // default 'generate'; 'verify' requires `code`
  code?: string
  deliverVia?: 'email' | 'manual'
  emailTemplate?: string; emailData?: Record<string, unknown>
  locale?: string; userId?: string
}

// Discriminated by channel (mirrors spec §6.5)
export type DispatchResult =
  | { channel: 'email'; messageId: string }
  | { channel: 'otp'; result: { expiresAt: number; cooldownSeconds: number } | OtpVerifyResult | void }

@Injectable()
export class NotificationService {
  constructor(
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly otpService?: OtpService,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchResult>
  getEnabledChannels(): NotificationChannel[]
  getEmail(): EmailService    // throws CHANNEL_DISABLED if not configured
  getOtp(): OtpService        // throws CHANNEL_DISABLED if not configured
}
```

**Implementation algorithm (`dispatch`):**

```
switch (input.channel) {
  case 'email':
    if (!emailService) throw CHANNEL_DISABLED { channel: 'email' }
    if (payload.template):
      messageId = (await emailService.sendTemplate({ tenantId, to, template, data, locale, userId })).messageId
    else if (payload.subject && payload.html):
      messageId = (await emailService.send({ tenantId, to, subject, html, text, userId })).messageId
    else:
      throw EMAIL_INVALID_RECIPIENT { hint: 'payload requires either `template` OR `{subject, html}`' }
    return { channel: 'email', messageId }

  case 'otp':
    if (!otpService) throw CHANNEL_DISABLED { channel: 'otp' }
    switch (payload.action ?? 'generate') {
      case 'generate': result = await otpService.generate({ tenantId, ...payload }); break
      case 'verify':   result = await otpService.verify({ tenantId, recipient, purpose, code, userId }); break
      case 'consume':  result = await otpService.consume({ tenantId, recipient, purpose, userId }); break
    }
    return { channel: 'otp', result }
}
```

`getEnabledChannels()` returns array of channels where the corresponding service is both injected AND `isConfigured() === true`.

**Acceptance criteria:**

- [ ] `dispatch({ channel: 'email', payload: { template, data } })` calls `emailService.sendTemplate`
- [ ] `dispatch({ channel: 'email', payload: { subject, html } })` calls `emailService.send`
- [ ] `dispatch({ channel: 'email', payload: {} })` throws `EMAIL_INVALID_RECIPIENT`
- [ ] `dispatch({ channel: 'otp', payload })` calls `otpService.generate`
- [ ] `dispatch({ channel: 'email' })` without EmailService injected throws `CHANNEL_DISABLED`
- [ ] `dispatch({ channel: 'otp' })` without OtpService injected throws `CHANNEL_DISABLED`
- [ ] `getEnabledChannels()` returns the correct list of configured channels
- [ ] `getEmail()` / `getOtp()` throwing-getter works as expected
- [ ] Coverage 95%

**Validation commands:**

```bash
pnpm test src/server/services/notification.service.spec.ts
```

**Dependencies:** §3.4 (EmailService), §3.5 (OtpService).

### 3.7 Wiring of the services in the module

**Objective:** Update `bymax-notification.module.ts` to register `EmailService`, `OtpService`, and `NotificationService` conditionally, per active channel.

**Files to modify:**

```
src/server/bymax-notification.module.ts
```

**Modification — inside the `forRoot` method:**

```typescript
import { EmailService } from './services/email.service'
import { OtpService } from './services/otp.service'
import { NotificationService } from './services/notification.service'

// ... (validation + resolveOptions as before)

// After registering email/otp/templating/audit providers:

if (resolved.email) {
  providers.push(EmailService)
}

if (resolved.otp) {
  providers.push(OtpService)
}

// NotificationService ALWAYS registered — uses @Optional() for unconfigured channels
providers.push(NotificationService)

return {
  module: BymaxNotificationModule,
  global: true,
  providers,
  exports: [
    ...providers
      .map((p) => ('provide' in p ? p.provide : p))
      .filter((token) => token !== null && token !== undefined),
  ],
}
```

**Acceptance criteria:**

- [ ] `EmailService` registered only when `email` configured
- [ ] `OtpService` registered only when `otp` configured
- [ ] `NotificationService` always registered (even without a channel — though `validateOptions` rejects that case first)
- [ ] `EmailService`, `OtpService`, `NotificationService` exported (consumer can inject them in its own services)
- [ ] Smoke test: an email-only consumer can `app.get(EmailService)`; `app.get(OtpService)` throws

**Validation commands:**

```bash
pnpm test src/server/bymax-notification.module.spec.ts
```

**Dependencies:** §3.4, §3.5, §3.6.

### 3.8 Update `src/server/index.ts`

**Modification — add exports:**

```typescript
// Services
export { EmailService } from './services/email.service'
export { OtpService } from './services/otp.service'
export {
  NotificationService,
  type DispatchInput,
  type EmailDispatchPayload,
  type OtpDispatchPayload,
  type DispatchResult,
} from './services/notification.service'

// Providers — reference implementations added in Phase 2
export {
  ResendEmailProvider,
  type ResendEmailProviderOptions,
} from './providers/resend-email.provider'
export { InMemoryOtpStorage } from './providers/in-memory-otp.storage'
export {
  RedisOtpStorage,
  type RedisOtpStorageOptions,
  type RedisLike,
} from './providers/redis-otp.storage'

// Utilities — exposed for advanced consumers writing custom storages/providers
export { hashTenantRecipient } from './utils/hash'
export { generateOtpCode } from './utils/code-generator'
export { safeCompare } from './utils/timing-safe-compare'
```

### 3.9 Tests for Phase 2

**Objective:** Achieve **100% coverage on every implemented file** (services + Redis storage + reference providers), with extra mutation focus on `otp.service.ts` and `redis-otp.storage.ts`.

**Files to create:**

```
src/server/providers/
├── resend-email.provider.spec.ts
├── in-memory-otp.storage.spec.ts
└── redis-otp.storage.spec.ts

src/server/services/
├── email.service.spec.ts
├── otp.service.spec.ts
└── notification.service.spec.ts
```

**Test cases organized by file (full implementations follow AAA pattern; see the per-phase task files in `docs/tasks/` for per-test scaffold).**

#### `email.service.spec.ts` — required cases

- `send` happy path → returns `messageId`, applies defaults (`defaultFrom`, `defaultReplyTo`, `defaultTags`)
- `send` audits with `verb: 'sent'` + `messageId` on success
- `send` throws `EMAIL_PROVIDER_NOT_CONFIGURED` when `provider.isConfigured() === false`
- `send` throws `EMAIL_SEND_FAILED` + audits `verb: 'failed'` when provider rejects
- `send` swallows audit log failures by default (`swallowErrors: true`)
- `send` propagates audit log failures when `swallowErrors: false`
- `sendTemplate` calls `renderer.hasTemplate(template, locale)` and forwards to `send`
- `sendTemplate` falls back to `en` locale when target locale missing
- `sendTemplate` throws `TEMPLATE_NOT_FOUND` when neither locale nor `en` exist
- `sendTemplate` throws `TEMPLATE_RENDER_FAILED` when renderer throws
- `sendTemplate` appends `{ name: 'template', value: <name> }` to tags
- `isConfigured()` reflects both `options.email` presence AND `provider.isConfigured()`

Use `Test.createTestingModule` with mocked `IEmailProvider`, `IEmailTemplateRenderer`, `INotificationLogRepository`.

#### `otp.service.spec.ts` — required cases

- `generate` claims the cooldown (`tryAcquireCooldown`) BEFORE persisting; persists entry with `attempts: 0`, returns `{ expiresAt, cooldownSeconds }`
- `generate` throws `OTP_COOLDOWN_ACTIVE` on a second call within the cooldown window
- `generate({ deliverVia: 'email' })` calls `emailService.sendTemplate('otp_code', { code, expiresInMinutes, ... })`
- `generate({ deliverVia: 'email' })` without EmailService throws `OTP_EMAIL_DELIVERY_NOT_CONFIGURED`
- `generate({ deliverVia: 'email' })` whose send throws → clears cooldown + deletes OTP, then rethrows (no lockout/orphan)
- `generate({ deliverVia: 'manual' })` does NOT call EmailService and keeps the cooldown
- `generate` audit metadata NEVER contains the `code` field (gate via JSON.stringify match)
- `generate` honors `perPurpose` overrides (length, ttl, codeType, maxAttempts, resendCooldown)
- `verify` returns `{ valid: true }` on correct code
- `verify` returns `{ valid: false, reason: 'not_found' }` when there is no entry (and for expired entries)
- `verify` returns `{ valid: false, reason: 'max_attempts' }` when attempts exceeded (storage deletes entry)
- `verify` returns `{ valid: false, reason: 'invalid_code', remainingAttempts }` on wrong code
- `verify` increments `attempts` via `storage.consumeAttempt` (atomic) — verify the storage method is the only mutation path
- `verify` with `consumeOnVerify: true` deletes entry AND clears cooldown on success
- `verify` with `consumeOnVerify: false` keeps entry with `validated: true` on success
- `consume` deletes entry and clears cooldown, idempotent
- `resend` is a functional alias of `generate` (same code path)
- `getStatus` returns `{ exists: false }` when there is no entry
- `getStatus` returns entry details EXCLUDING the `code` field (security gate)

Use `InMemoryOtpStorage` directly (no mock needed) + mocked `EmailService` and `INotificationLogRepository`.

#### `redis-otp.storage.spec.ts` — required cases

- Key format: `notification:otp:{purpose}:{64-hex-chars}` (verify via `redis.keys('*')`)
- Keys NEVER contain plaintext recipient or tenantId (security gate)
- `tenant_a + foo@x.com` and `tenant_b + foo@x.com` produce different keys
- `set` uses `SETEX` with TTL derived from `expiresAt - Date.now()`
- `consumeAttempt` (Lua) increments `attempts` and preserves TTL; returns `ok`/`max_attempts`/`not_found`
- `consumeAttempt` deletes and returns `max_attempts` at the limit; `not_found` for missing/expired
- `update` uses `SET ... KEEPTTL XX` — verify it does NOT recreate an evicted entry and keeps the TTL
- `tryAcquireCooldown` uses `SET ... NX EX` with prefix `otp_cd:` — returns `true` then `false` while active
- `getCooldown` returns 0 when key missing (Redis TTL = -2); `clearCooldown` deletes the cooldown key
- `get` returns `null` for missing key, parsed entry for existing key, and deletes corrupted (invalid JSON) returning null
- `delete` is idempotent

Use `ioredis-mock` — no real Redis connection.

#### `notification.service.spec.ts` — required cases

- `dispatch({ channel: 'email', payload: { template, data } })` routes to `EmailService.sendTemplate`
- `dispatch({ channel: 'email', payload: { subject, html } })` routes to `EmailService.send`
- `dispatch({ channel: 'email' })` without EmailService injected throws `CHANNEL_DISABLED`
- `dispatch({ channel: 'otp', payload })` routes to `OtpService.generate`
- `getEnabledChannels()` returns only channels with `isConfigured() === true`
- `getEmail()` / `getOtp()` throw `CHANNEL_DISABLED` when channel absent

#### `resend-email.provider.spec.ts` — required cases

- `isConfigured()` returns `false` when there is no `apiKey`
- `send()` without `apiKey` throws "Missing API key"
- `send()` builds `from` as `'Name <email>'` when `fromName` provided
- `send()` propagates Resend SDK errors as Error (mapped to `NotificationException` in EmailService)
- Provider NEVER logs `options.html` or `options.text` (verify via logger spy)
- Test `'resend' package missing` path by `jest.mock('resend', () => { throw new Error() })`

#### `in-memory-otp.storage.spec.ts` — required cases

- All `IOtpStorage` contract methods (set/get/consumeAttempt/update/delete/tryAcquireCooldown/getCooldown/clearCooldown)
- `get` self-evicts entries past `expiresAt`
- `consumeAttempt` increments atomically; returns `max_attempts`/`not_found` at the boundaries
- `update` is a no-op for a missing key (XX equivalent)
- `tryAcquireCooldown` returns `true` then `false` while active; `clearCooldown` resets it
- `delete` is idempotent
- Different `(tenantId, recipient, purpose)` tuples never collide

**Acceptance criteria:**

- [ ] All listed `.spec.ts` files created
- [ ] `pnpm test:cov` reports **100% global** coverage
- [ ] Coverage per file (all **100%**): `email.service.ts`, `otp.service.ts`, `notification.service.ts`, `resend-email.provider.ts` (lazy `import('resend')` mocked), `redis-otp.storage.ts`, `in-memory-otp.storage.ts`
- [ ] Mutation score ≥ 95% (target 100%) in `otp.service.ts` (security-critical)
- [ ] Mutation score ≥ 95% (target 100%) on `redis-otp.storage.ts` (a wrong Redis key/flag = cross-tenant corruption)
- [ ] `pnpm test` zero failures

**Validation commands:**

```bash
pnpm test:cov
pnpm test src/server/services/otp.service.spec.ts
pnpm test src/server/providers/redis-otp.storage.spec.ts
```

**Dependencies:** §3.1 a §3.7.

**Risks/Notes:**

- ⚠️ `ioredis-mock` is faithful for most ops; but `eval` (the `consumeAttempt` Lua), `SET ... KEEPTTL XX`, and `SET ... NX EX` must be tested specifically (confirm the mock version supports them, else stub that one path)
- ⚠️ Audit fire-and-forget — test that errors in `auditLog.create` do NOT propagate to the caller (when `swallowErrors: true`)
- ⚠️ Mock `EmailService` in `OtpService` tests to avoid needing a real provider

### 3.10 Phase 2 validation

**Final commands:**

```bash
pnpm typecheck
pnpm lint
pnpm test:cov
pnpm build
pnpm size
pnpm check:no-prisma
```

**Smoke test pattern:**

Spin up a NestJS fixture with `BymaxNotificationModule.forRoot({ email: NoOp + DefaultTemplateRenderer, otp: InMemoryStorage })`. The controller injects `EmailService` + `OtpService` and exposes a `POST /test` endpoint that calls:

1. `email.send({ tenantId, to, subject, html })` → returns `{ messageId }`
2. `otp.generate({ tenantId, recipient, purpose: 'email_verification', deliverVia: 'email' })` → returns `{ expiresAt, cooldownSeconds }`
3. `otp.getStatus({...})` → returns `{ exists: true, expiresAt, attempts, maxAttempts, cooldownSeconds }`

Expected: response JSON covers the 3 returns. Validate via `curl -X POST http://localhost:3001/test`.

**Done criteria to close Phase 2:**

- [ ] Smoke test shows the end-to-end flow (send + generate + getStatus) working
- [ ] Coverage gate met (100% on every implemented file)
- [ ] Mutation score ≥ 95% (target 100%) in OtpService and RedisOtpStorage
- [ ] Commits done with Conventional Commits (`feat(notification): implement EmailService`, `feat(notification): implement OtpService with generate/verify/consume`, `feat(notification): add ResendEmailProvider`, etc.)
- [ ] `/bymax-quality:code-review` run and findings applied
- [ ] PR `phase-2` approved

---

## 4. Phase 3 — Templating + Rate Limiting

> **Phase objective:** Refine the `DefaultTemplateRenderer` (robust i18n fallback, variable edge cases with nested paths, escape only the html body), consolidate the resend-cooldown system (the atomic `tryAcquireCooldown`/`clearCooldown` primitives from Phase 2 — here tested with edge cases and exposed via helpers), and instrument `getStatus` + `getCooldown` for UX. Document adapter examples (Handlebars, React Email, MJML) without implementing them.
>
> **Complexity:** MEDIUM. Templating mechanics are simple; care is needed for edge cases (missing variables, nested data paths, fallback chain, HTML escape applied to the html body only).
>
> **Critical paths for 100% coverage:** `src/server/providers/default-template-renderer.ts` (update), `src/server/utils/cooldown-helpers.ts` (new).

### 4.1 Refinement of `DefaultTemplateRenderer`

**Objective:** Enhance the Phase 1 renderer with edge cases: missing variables, configurable fallback chain, `text`-only support (no HTML), validation of registered templates in the constructor.

**Files to modify:**

```
src/server/providers/default-template-renderer.ts
```

**Modification — overwrite the Phase 1 minimal implementation:**

```typescript
export interface DefaultTemplateRendererOptions {
  templates?: Record<string, TemplateDefinition>
  fallbackLocales?: readonly string[]    // default ['en']
  onMissingVar?: 'empty' | 'throw'        // default 'empty'
  enableNestedPaths?: boolean             // default false
}

export interface TemplateDefinition { subject: string; html: string; text?: string }

@Injectable()
export class DefaultTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'default-interpolation'
  constructor(options: DefaultTemplateRendererOptions = {})
  // ... validates template shapes at construction (fail fast)
  async hasTemplate(name, locale): Promise<boolean>
  async render(name, data, locale): Promise<RenderedEmail>
}
```

**Implementation algorithm:**

- **Constructor:** validate every template in registry — `Invalid template "${key}" — must have { subject: string, html: string }` if missing
- **`hasTemplate`:** check existence of key `${name}::${locale}` in registry
- **`render`:**
  1. Resolve template via fallback chain `[locale, ...fallbackLocales.filter(l !== locale)]` — first match wins
  2. If no template is found in the entire chain → throw with name + locale + tried list
  3. `fill(str, escape)` replaces `/\{\{\s*([\w.]+)\s*\}\}/g`:
     - Resolve variable: flat key if `!enableNestedPaths`; else `path.split('.').reduce(...)`
     - If value is `undefined`: throw if `onMissingVar === 'throw'`, else return `''`
     - Return `escape ? escapeHtml(String(value)) : String(value)`
  4. Apply `fill(subject, false)`, `fill(html, true)`, `fill(text, false)` — escape ONLY the html body; the subject line and plaintext body are not HTML contexts
- **`escapeHtml`:** standard 5-char escape (`&`, `<`, `>`, `"`, `'`)

**NOT supported by design** (documented in JSDoc): Handlebars `{{#if}}`, `{{#each}}`, partials. Consumer plugs Handlebars/MJML/React Email for those needs.

**Acceptance criteria:**

- [ ] Constructor validates registered templates — an invalid key throws on construction (not at runtime)
- [ ] Fallback chain follows the order `[locale, ...fallbackLocales]`
- [ ] `fallbackLocales: ['pt', 'en']` for locale `pt-BR` results in chain `['pt-BR', 'pt', 'en']`
- [ ] Missing variable with `onMissingVar: 'empty'` renders an empty string
- [ ] Missing variable with `onMissingVar: 'throw'` throws with the variable name
- [ ] `enableNestedPaths: true` resolves `{{user.name}}` when `data = { user: { name: 'X' } }`
- [ ] `enableNestedPaths: false` (default) treats `'user.name'` as a flat key (likely undefined)
- [ ] HTML escape applies to interpolated values **in the html body only** — never the subject/text, never the author's static HTML
- [ ] `text`-only (no HTML) supported — template `{ subject, html: '', text: '...' }` is valid
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/providers/default-template-renderer.spec.ts
```

**Dependencies:** §2.6 (previous minimal version — overwritten here).

**Risks/Notes:**

- ⚠️ Regex `/\{\{\s*([\w.]+)\s*\}\}/g` allows a dot in the path — required for nested paths; also accepts `{{ var }}` with spaces
- ⚠️ `enableNestedPaths` is opt-in to avoid surprise for those who use only flat keys (e.g., `'user.name'` as a literal key)
- ⚠️ Does not support arrays of objects — for that the consumer must plug in Handlebars

### 4.2 Template adapter documentation (not implemented)

**Objective:** Add complete Handlebars, React Email, and MJML adapter examples in `docs/templates/`. Do NOT implement them in the lib — document them for the consumer.

**Files to create:**

```
docs/templates/
├── handlebars-renderer.example.md
├── react-email-renderer.example.md
└── mjml-renderer.example.md
```

**Each `.example.md` file structure (≈3-5 KB):**

- **Title + disclaimer** ("Reference only — copy and adapt to your project")
- **Setup** — `pnpm add` command for the engine's package
- **Implementation** — `IEmailTemplateRenderer` adapter class (constructor compiles templates, `hasTemplate`/`render` methods)
- **Security caveats** — engine-specific (e.g., Handlebars: prefer `{{var}}` over `{{{var}}}`; React Email: escape is automatic)
- **Registration** — code snippet showing how to plug into `BymaxNotificationModule.forRoot({ email: { templateRenderer } })`

Full implementations are derived from the spec's §5.5.2 (Handlebars), §5.5.3 (React Email), and analogous MJML pattern.

**Acceptance criteria:**

- [ ] 3 `.example.md` files created in `docs/templates/`
- [ ] Each example contains: setup (npm install), full code, security caveats, module registration example
- [ ] Examples mentally compile (valid TypeScript) even though they are not tested in CI

### 4.3 Helpers de cooldown (`cooldown-helpers.ts`)

**Objective:** Extract reusable cooldown logic into utilities — useful for consumers that want to expose `GET /otp/status` returning a `Retry-After` header.

**Files to create:**

```
src/server/utils/cooldown-helpers.ts
```

**Skeleton:**

```typescript
/**
 * Helpers around resend cooldown computation. Used by `OtpService` internally
 * and exposed to consumers who want to compute `Retry-After` HTTP headers
 * without re-querying the storage.
 */

/**
 * Compute the HTTP `Retry-After` header value (in seconds).
 *
 * @param remainingSeconds - As returned by `storage.getCooldown()`
 * @returns A string suitable for `res.setHeader('Retry-After', value)`
 */
export function toRetryAfterHeader(remainingSeconds: number): string {
  return String(Math.max(0, Math.ceil(remainingSeconds)))
}

/**
 * Compute a future epoch-ms timestamp when the cooldown will expire.
 *
 * @param remainingSeconds - Current remaining cooldown in seconds
 * @returns Epoch ms when cooldown expires; `Date.now()` if already expired
 */
export function cooldownExpiresAt(remainingSeconds: number): number {
  if (remainingSeconds <= 0) return Date.now()
  return Date.now() + remainingSeconds * 1000
}

/**
 * Human-readable cooldown string for UI ("47s", "2m 5s", "1h 12m 5s").
 * Avoids dependency on date-fns / dayjs.
 */
export function formatCooldown(remainingSeconds: number): string {
  if (remainingSeconds <= 0) return '0s'
  const totalSeconds = Math.ceil(remainingSeconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}
```

**Acceptance criteria:**

- [ ] `toRetryAfterHeader(47)` → `'47'`
- [ ] `toRetryAfterHeader(-5)` → `'0'` (non-negative)
- [ ] `toRetryAfterHeader(47.3)` → `'48'` (ceil)
- [ ] `cooldownExpiresAt(60)` → ~`Date.now() + 60000` (with ±50ms tolerance)
- [ ] `formatCooldown(0)` → `'0s'`
- [ ] `formatCooldown(47)` → `'47s'`
- [ ] `formatCooldown(125)` → `'2m 5s'`
- [ ] `formatCooldown(3725)` → `'1h 2m 5s'`
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/utils/cooldown-helpers.spec.ts
```

**Dependencies:** No (utility puro).

**Risks/Notes:**

- ⚠️ `formatCooldown` is useful but can be replaced by frontend i18n — keep it in `src/server/` for optional use in API responses

### 4.4 Cooldown integration in `OtpService` (refinement)

**Objective:** Add `details.retryAfter` (header value) to cooldown exceptions.

**Modification — `src/server/services/otp.service.ts`:**

Locate the `generate()` block that handles a failed cooldown acquire:

```typescript
const acquired = await this.storage.tryAcquireCooldown(tenantId, recipient, purpose, cfg.resendCooldownSeconds)
if (!acquired) {
  const remaining = await this.storage.getCooldown(tenantId, recipient, purpose)
  await this.auditFireAndForget({ /* verb: 'cooldown_blocked' */ })
  throw new NotificationException('OTP_COOLDOWN_ACTIVE', {
    remainingSeconds: remaining,
    retryAfter: toRetryAfterHeader(remaining),  // ← ADD
    expiresAt: cooldownExpiresAt(remaining),    // ← ADD
  })
}
```

Locate the `max_attempts` branch in `verify()` (the storage already deleted the entry inside `consumeAttempt`):

```typescript
if (result.status === 'max_attempts') {
  await this.auditVerify(input, 'max_attempts_exceeded', { reason: 'max_attempts' })
  // NOTE: max_attempts has no immediate cooldown — the entry is gone, a fresh generate is allowed
  return { valid: false, reason: 'max_attempts' }
}
```

> Note that `max_attempts` **does not** set a cooldown — the entry is deleted, a new generate is allowed (and it itself will apply a new cooldown). To prevent abuse, the consumer can add rate limiting in the controller layer (`@nestjs/throttler`).

**Acceptance criteria:**

- [ ] `OTP_COOLDOWN_ACTIVE` exception carries `details.retryAfter` (string)
- [ ] `OTP_COOLDOWN_ACTIVE` exception carries `details.expiresAt` (number)
- [ ] `otp.service.spec.ts` tests updated to validate `details`

**Validation commands:**

```bash
pnpm test src/server/services/otp.service.spec.ts
```

**Dependencies:** §4.3, §3.5.

### 4.5 Add cooldown-helper exports and the updated renderer types

**Modification — `src/server/index.ts`:**

```typescript
// Cooldown utilities — exported for consumers writing custom Retry-After headers
export {
  toRetryAfterHeader,
  cooldownExpiresAt,
  formatCooldown,
} from './utils/cooldown-helpers'

// Updated renderer type
export type {
  TemplateDefinition,
  DefaultTemplateRendererOptions,
} from './providers/default-template-renderer'
```

### 4.6 Templates documented — naming convention

**Objective:** Document canonical template names in `src/server/constants/canonical-templates.ts`. **Does not embed HTML** — only naming convention + typical variables.

**Files to create:**

```
src/server/constants/canonical-templates.ts
```

**Skeleton:**

```typescript
/**
 * Canonical template names recognized by the library's conventions.
 *
 * The library does NOT ship HTML for these — consumer registers each template
 * in their `IEmailTemplateRenderer`. This object documents the names + the
 * variables each template is expected to receive.
 *
 * Using these constants is OPTIONAL — `emailService.sendTemplate({ template })`
 * accepts any string. The benefit of using these constants is type-safe
 * autocompletion in IDE.
 */
export const CANONICAL_EMAIL_TEMPLATES = {
  /** OTP for email verification — variables: `code`, `expiresInMinutes`, `purpose`, `name`, `appName` */
  OTP_CODE: 'otp_code',
  /** OTP for password reset (distinct copy; may carry a deep link) — variables: `code`, `expiresInMinutes`, `name`, `appName`, `verificationLink` */
  OTP_PASSWORD_RESET: 'otp_password_reset',
  /** OTP resend — same variables as the originating OTP template */
  OTP_RESENT: 'otp_resent',
  /** Welcome after email verification — variables: `name`, `appName`, `appUrl` */
  WELCOME: 'welcome',
  /** Password reset success — variables: `name`, `appName`, `supportEmail` */
  PASSWORD_RESET_SUCCESS: 'password_reset_success',
  /** Trial ending soon — variables: `name`, `appName`, `trialPlanName`, `daysLeft`, `appUrl` */
  TRIAL_EXPIRING: 'trial_expiring',
  /** Trial ended — variables: `name`, `appName`, `trialPlanName`, `durationDays`, `appUrl` */
  TRIAL_EXPIRED: 'trial_expired',
  /** New device login — variables: `device`, `ip`, `timestamp`, `name`, `appName` */
  NEW_LOGIN_ALERT: 'new_login_alert',
  /** MFA enabled — variables: `name`, `appName` */
  MFA_ENABLED: 'mfa_enabled',
  /** MFA disabled — variables: `name`, `appName` */
  MFA_DISABLED: 'mfa_disabled',
} as const

export type CanonicalEmailTemplate =
  (typeof CANONICAL_EMAIL_TEMPLATES)[keyof typeof CANONICAL_EMAIL_TEMPLATES]
```

**Modification — `src/server/index.ts`:**

```typescript
export {
  CANONICAL_EMAIL_TEMPLATES,
  type CanonicalEmailTemplate,
} from './constants/canonical-templates'
```

**Acceptance criteria:**

- [ ] Constants created with JSDoc per template describing the expected variables
- [ ] Type `CanonicalEmailTemplate` infers the correct literals

### 4.7 Tests for Phase 3

**Files to create/expand:**

```
src/server/providers/default-template-renderer.spec.ts      # expandir
src/server/utils/cooldown-helpers.spec.ts                   # new
src/server/services/otp.service.spec.ts                     # expandir (cooldown details)
```

**Test cases (AAA pattern; full implementations in the per-phase task files):**

#### `default-template-renderer.spec.ts` (Phase 3 extensions)

- **Fallback chain:** tries `[locale, ...fallbackLocales]` in order (no duplicates)
- **Missing variables — default empty:** `{{name}}` with no `data.name` renders as an empty string
- **Missing variables — throw mode:** `onMissingVar: 'throw'` raises with variable name
- **Escape scope:** a value containing `<script>` is escaped in the html body but left raw in `subject` and `text`
- **Nested paths:** `{{user.name}}` resolves when `enableNestedPaths: true` and `data = { user: { name: 'X' } }`
- **Nested paths off (default):** `{{user.name}}` treats `'user.name'` as flat key
- **Nested path traverses null:** returns empty string (no exception)
- **Construction validation:** invalid template shape throws at construction time (fail fast)
- **Text body:** `text` template interpolates when present, `undefined` when absent

#### `cooldown-helpers.spec.ts`

- `toRetryAfterHeader(47.3)` → `'48'` (ceil)
- `toRetryAfterHeader(-5)` → `'0'` (clamped non-negative)
- `cooldownExpiresAt(60)` returns `Date.now() + 60000` with ±100ms tolerance
- `cooldownExpiresAt(0)` returns approximately `Date.now()`
- `formatCooldown(0)` → `'0s'`
- `formatCooldown(47)` → `'47s'`
- `formatCooldown(125)` → `'2m 5s'`
- `formatCooldown(120)` → `'2m'` (omits 0s)
- `formatCooldown(3725)` → `'1h 2m 5s'`
- `formatCooldown(3600)` → `'1h'`

#### `otp.service.spec.ts` (Phase 3 extensions)

- `OTP_COOLDOWN_ACTIVE` exception details contain `remainingSeconds: number`, `retryAfter: string`, `expiresAt: number`

**Acceptance criteria:**

- [ ] All listed `.spec.ts` files expanded/created
- [ ] Coverage per file (all **100%**): `default-template-renderer.ts`, `cooldown-helpers.ts`
- [ ] **100% global** coverage
- [ ] Mutation score (run optionally) ≥ 95% (target 100%) in `default-template-renderer.ts`

**Validation commands:**

```bash
pnpm test:cov
```

**Dependencies:** §4.1, §4.3, §4.4.

### 4.8 Phase 3 validation

**Final commands:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size
```

**Smoke test pattern:**

Import `DefaultTemplateRenderer`, `formatCooldown`, `toRetryAfterHeader`, `CANONICAL_EMAIL_TEMPLATES` from `dist/server`. Build a renderer with `enableNestedPaths: true`, `fallbackLocales: ['pt', 'en']`, and two templates (`otp_code::pt-BR` and `otp_code::en`). Validate:

- `render('otp_code', { code: '739204', user: { name: 'Maria' } }, 'pt-BR')` → subject `'Code: 739204'`, HTML contains `'Hello Maria'`
- `render('otp_code', { ... }, 'fr-FR')` falls back to the `en` template
- `formatCooldown(47)` → `'47s'`
- `toRetryAfterHeader(47.3)` → `'48'`

**Done criteria to close Phase 3:**

- [ ] Smoke test passes
- [ ] Coverage gate met (100% per file)
- [ ] Handlebars/React Email/MJML adapters documented in `docs/templates/`
- [ ] PR `phase-3` with `/bymax-quality:code-review` applied

---

## 5. Phase 4 — Multi-tenant + Audit Log

> **Phase objective:** Consolidate multi-tenancy (`tenantIdResolver`, anti-spoofing validation, per-channel isolation) and complete the audit log system (optional `NotificationAuditInterceptor` interceptor, `INotificationLogRepository` integration, Prisma fragment helpers). Add full `forRootAsync()` wiring all providers (Phase 1 left it as a stub).
>
> **Complexity:** MEDIUM. Multi-tenancy via hashing is already implemented in Phases 1-2; here we consolidate with isolation tests and security documentation. Audit log also has a basic integration — here we refine for edge cases (batch failures, selective propagation).
>
> **Critical paths for 100% coverage:** `src/server/utils/hash.ts` (already 100% — confirm), `src/server/interceptors/notification-audit.interceptor.ts` (new), `src/server/services/email.service.ts` and `otp.service.ts` (audit paths).

### 5.1 Strengthened multi-tenant scoping validation

**Objective:** Add specific tests that prove isolation between tenants. Implement a "tenant collision tests" suite as a regression gate.

**Files to create:**

```
test/e2e/tenant-isolation.e2e-spec.ts
```

**Skeleton:**

```typescript
import { Test } from '@nestjs/testing'
import {
  BymaxNotificationModule,
  OtpService,
  EmailService,
  InMemoryOtpStorage,
  NoOpEmailProvider,
  RedisOtpStorage,
} from '../../src/server'
import RedisMock from 'ioredis-mock'

describe('Tenant Isolation — E2E', () => {
  describe('InMemoryOtpStorage', () => {
    let otpService: OtpService
    let storage: InMemoryOtpStorage

    beforeEach(async () => {
      storage = new InMemoryOtpStorage()
      const module = await Test.createTestingModule({
        imports: [
          BymaxNotificationModule.forRoot({
            email: { provider: new NoOpEmailProvider(), defaultFrom: 'a@b.com' },
            otp: { storage },
          }),
        ],
      }).compile()
      otpService = module.get(OtpService)
    })

    it('should not collide OTP between tenants with same recipient', async () => {
      const r1 = await otpService.generate({
        tenantId: 'tenant_a', recipient: 'maria@x.com', purpose: 'email_verification',
        deliverVia: 'manual',
      })
      const r2 = await otpService.generate({
        tenantId: 'tenant_b', recipient: 'maria@x.com', purpose: 'email_verification',
        deliverVia: 'manual',
      })
      // Both should succeed — no cooldown collision across tenants
      expect(r1.expiresAt).toBeGreaterThan(0)
      expect(r2.expiresAt).toBeGreaterThan(0)

      // Different codes
      const e1 = await storage.get('tenant_a', 'maria@x.com', 'email_verification')
      const e2 = await storage.get('tenant_b', 'maria@x.com', 'email_verification')
      expect(e1!.code).not.toBe(e2!.code)
    })

    it('should not leak verification across tenants', async () => {
      await otpService.generate({
        tenantId: 'tenant_a', recipient: 'maria@x.com', purpose: 'p', deliverVia: 'manual',
      })
      const e1 = (await storage.get('tenant_a', 'maria@x.com', 'p'))!

      // tenant_b tries to verify with tenant_a's code
      const result = await otpService.verify({
        tenantId: 'tenant_b', recipient: 'maria@x.com', purpose: 'p', code: e1.code,
      })
      expect(result).toEqual({ valid: false, reason: 'not_found' })
    })
  })

  describe('RedisOtpStorage with sha256 hashing', () => {
    it('keys should be hex-encoded (no PII leakage)', async () => {
      const redis = new RedisMock()
      const storage = new RedisOtpStorage({ redisClient: redis as never })
      await storage.set('tenant_a', 'maria@x.com', 'p', {
        code: '1', expiresAt: Date.now() + 60_000, attempts: 0, maxAttempts: 5,
      })
      const keys = await redis.keys('*')
      // None of the keys should contain the email or tenant ID directly
      for (const key of keys) {
        expect(key).not.toContain('maria@x.com')
        expect(key).not.toContain('tenant_a')
      }
    })
  })
})
```

**Acceptance criteria:**

- [ ] Test suite `tenant-isolation.e2e-spec.ts` created
- [ ] Tests cover: (1) no OTP collision across tenants, (2) no cooldown collision, (3) no cross-tenant verify leak, (4) hex-encoded Redis keys (no PII)
- [ ] Suite passes in CI
- [ ] Coverage unaffected (e2e tests don't count toward unit coverage)

**Validation commands:**

```bash
pnpm test:e2e -- tenant-isolation
```

**Dependencies:** §3.5 (OtpService), §3.3 (RedisOtpStorage), §2.7 (hash).

### 5.2 `NotificationAuditInterceptor`

**Objective:** Optional NestJS interceptor that captures calls to `NotificationService.dispatch()` and creates additional audit logs with `tenantId` resolved via `global.tenantIdResolver` (typed `NotificationRequest`).

**Files to create:**

```
src/server/interceptors/notification-audit.interceptor.ts
```

**Skeleton:**

```typescript
@Injectable()
export class NotificationAuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS) private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY) private readonly auditLog: INotificationLogRepository,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown>
  private recordMeta(ctx, verb, errorMessage?): Promise<void>
  private extractDispatchInput(ctx): DispatchInput | null  // shape match on first arg
  private extractRecipient(input): string
}
```

**Implementation algorithm:**

1. `intercept()` returns `next.handle().pipe(tap(() => recordMeta('sent')), catchError((err) => { recordMeta('failed', err.message); return throwError(() => err) }))`
2. `recordMeta()`:
   - Try-catch wraps everything; swallow on failure per `options.audit?.swallowErrors ?? true`
   - Extract request via `ctx.switchToHttp().getRequest()` (safe-wrapped)
   - Extract dispatch input from `ctx.getArgs()[0]` — verify it has `{ channel, tenantId, payload }` shape
   - **Anti-spoofing:** `tenantId = global.tenantIdResolver ? await tenantIdResolver(req) : input.tenantId` (resolver wins)
   - Build `NotificationLogEntry` with `providerName: '__interceptor__'` and `metadata: { interceptedBy: 'NotificationAuditInterceptor' }`
   - `await auditLog.create(entry)`
3. `extractRecipient`:
   - `channel === 'email'` → `Array.isArray(payload.to) ? payload.to[0] : payload.to`
   - `channel === 'otp'` → `payload.recipient`

**NOT auto-registered** — consumer opts in via `{ provide: APP_INTERCEPTOR, useClass: NotificationAuditInterceptor }`. Document this in README.

**Acceptance criteria:**

- [ ] Interceptor exports the class `NotificationAuditInterceptor`
- [ ] When `dispatch()` resolves, the interceptor creates an audit entry with `verb: 'sent'` + `providerName: '__interceptor__'`
- [ ] When `dispatch()` rejects, the interceptor creates an audit entry with `verb: 'failed'` + `errorMessage`, then re-throws
- [ ] When `global.tenantIdResolver` is set, the interceptor extracts `tenantId` from the request — overriding `payload.tenantId` (anti-spoofing)
- [ ] A failure in the audit interceptor does NOT break the main flow (swallowed by default)
- [ ] The interceptor recognizes the dispatch input by its shape (`channel`, `tenantId`, `payload`)
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/server/interceptors/notification-audit.interceptor.spec.ts
```

**Dependencies:** §3.6 (NotificationService), §2.3 (interfaces).

**Risks/Notes:**

- ⚠️ Interceptor is OPT-IN, not auto-registered — document in the README
- ⚠️ `providerName: '__interceptor__'` is a convention to distinguish interceptor logs from service-level ones
- ⚠️ In tests, mock the `ExecutionContext` (or use `NestApplicationContext`) to avoid full HTTP setup

### 5.3 Complete `forRootAsync()`

**Objective:** Complete `BymaxNotificationModule.forRootAsync()` to wire all async channel providers (left as a stub in Phase 1).

**Files to modify:**

```
src/server/bymax-notification.module.ts
```

**Implementation algorithm:**

1. **`optionsProvider`** — factory that:
   - Resolves raw options via `await asyncOptions.useFactory(...)` (only `useFactory` supported in v0.1)
   - Throws explicit "not yet implemented (planned for v0.2)" if `useClass` or `useExisting` provided
   - Throws "requires `useFactory`" if none provided
   - Calls `validateOptions(raw)` then `resolveOptions(raw)`; result becomes the value of `BYMAX_NOTIFICATION_OPTIONS`

2. **Channel providers (factory-based, depend on `BYMAX_NOTIFICATION_OPTIONS`):**
   - `BYMAX_NOTIFICATION_LOG_REPOSITORY` — `resolved.audit ? instantiate(resolved.audit.repository) : new NoOpNotificationLogRepository()`
   - `BYMAX_NOTIFICATION_EMAIL_PROVIDER` — `resolved.email ? instantiate(resolved.email.provider) : null`
   - `BYMAX_NOTIFICATION_TEMPLATE_RENDERER` — `resolved.email?.templateRenderer ? instantiate(...) : new DefaultTemplateRenderer({})`
   - `BYMAX_NOTIFICATION_OTP_STORAGE` — `resolved.otp ? instantiate(resolved.otp.storage) : null`

3. **Service providers** — always register `EmailService`, `OtpService`, `NotificationService` (they use `@Optional()` for unconfigured channels)

4. **Exports** — all tokens + services

**`instantiate(valueOrClass)` helper** (same heuristic as `resolveAsProvider`):

- `typeof === 'function' && valueOrClass.prototype?.constructor === valueOrClass` → `new valueOrClass()`
- Otherwise → return as-is (already an instance)

> **Trade-off documented:** `useClass`/`useExisting` rejected in v0.1 — implementation deferred to v0.2 when a consumer demonstrates the need. `useFactory` covers 99% of cases.

**Acceptance criteria:**

- [ ] `forRootAsync({ useFactory })` resolves options from another module (e.g., `ConfigService`)
- [ ] `forRootAsync({ useClass })` throws an explicit Error "not yet implemented"
- [ ] Async bootstrap: services inject their providers via tokens correctly
- [ ] `EmailService` injected into a consumer module via DI works
- [ ] `OtpService` likewise
- [ ] Defaults to `NoOpNotificationLogRepository` when the consumer doesn't configure audit
- [ ] Coverage 100% on the `forRootAsync` method (all sub-paths tested)

**Validation commands:**

```bash
pnpm test src/server/bymax-notification.module.spec.ts
```

**Dependencies:** §2.8 (synchronous version), §3.4, §3.5, §3.6.

### 5.4 Schema Prisma fragment for `INotificationLogRepository`

**Objective:** Distribute a Prisma fragment as reference for consumers that want to implement `INotificationLogRepository` with Prisma. NOT imported by the lib.

**Files to create:**

```
docs/schemas/notification-log.prisma
```

**Content:**

```prisma
// Prisma fragment for the @bymax-one/nest-notification audit log.
//
// How to use:
// 1. Copy this model into your schema.prisma
// 2. Run `prisma migrate dev` to create the table
// 3. Implement `INotificationLogRepository` using your `PrismaClient`
//
// IMPORTANT: this fragment is a REFERENCE. The lib `@bymax-one/nest-notification`
// NEVER imports `@prisma/client` directly — all persistence goes through the
// `INotificationLogRepository` interface that YOU implement.

model NotificationLog {
  id            String   @id @default(uuid())
  timestamp     DateTime @default(now())
  tenantId      String
  channel       String   // 'email' | 'otp' | 'sms' | 'push'
  verb          String   // 'sent' | 'generated' | 'verified' | 'failed' | 'cooldown_blocked' | 'max_attempts_exceeded'
  recipient     String
  purpose       String?
  providerName  String
  messageId     String?
  errorMessage  String?  @db.Text
  userId        String?
  metadata      Json?

  @@index([tenantId, timestamp(sort: Desc)])
  @@index([tenantId, channel, verb])
  @@index([userId, timestamp(sort: Desc)])

  @@map("notification_logs")
}
```

**Implementation example (in `docs/schemas/prisma-repository.example.md`):**

```typescript
import { Injectable } from '@nestjs/common'
import type {
  INotificationLogRepository,
  NotificationLogEntry,
} from '@bymax-one/nest-notification'

// CONSUMER CODE — your application
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class PrismaNotificationLogRepository implements INotificationLogRepository {
  readonly name = 'prisma'

  constructor(private readonly prisma: PrismaService) {}

  async create(entry: NotificationLogEntry): Promise<void> {
    await this.prisma.notificationLog.create({
      data: {
        timestamp: new Date(entry.timestamp),
        tenantId: entry.tenantId,
        channel: entry.channel,
        verb: entry.verb,
        recipient: entry.recipient,
        purpose: entry.purpose,
        providerName: entry.providerName,
        messageId: entry.messageId,
        errorMessage: entry.errorMessage,
        userId: entry.userId,
        metadata: entry.metadata ?? undefined,
      },
    })
  }
}
```

**Acceptance criteria:**

- [ ] File `docs/schemas/notification-log.prisma` created
- [ ] Schema covers all fields of `NotificationLogEntry`
- [ ] Appropriate indexes for common queries (`tenantId+timestamp`, `tenantId+channel+verb`, `userId+timestamp`)
- [ ] The fragment comment warns that the lib does NOT import Prisma
- [ ] Implementation example documented

### 5.5 Multi-tenant security documentation in README

**Objective:** Add a dedicated section to the README on multi-tenant security — explain the rationale for hashing, the use of `tenantIdResolver`, anti-spoofing.

**README section "Multi-tenant Security" (draft — finalized in the Release phase):**

Recommended coverage:

1. **Why SHA-256 on Redis keys**
   - Without hashing: `notification:otp:email_verification:tenant_a:maria@example.com` — Redis operators could enumerate who has a pending OTP
   - With hashing: `notification:otp:email_verification:7f3d8c91...64chars` — opaque
   - Solves: (1) privacy against leaked Redis credentials / leaked backups; (2) multi-tenancy via preimage resistance (cross-tenant collision mathematically negligible)

2. **Why `tenantIdResolver`**
   - Tenant spoofing: an attacker in `tenant_b` sends a payload `{ "tenantId": "tenant_a", ... }` to verify someone else's OTP
   - Mitigation: the resolver reads `tenantId` from a trusted source (JWT claim, subdomain, header verified by middleware)
   - Example: `tenantIdResolver: (req) => req.hostname?.split('.')[0] ?? 'default'` (subdomain-based; `req` typed `NotificationRequest`)
   - `NotificationAuditInterceptor` uses the resolver as the source of truth — `payload.tenantId` becomes a mere suggestion

3. **Principle of least privilege in logs**
   - Lib NEVER logs OTP codes in audit log (verified by test gate in §5.6)
   - Audit format: `{ verb: 'generated', tenantId, recipient, purpose, providerName }` — without `code`
   - Codes live only in Redis (with TTL) + local process memory during the request

**Acceptance criteria:**

- [ ] Security section documented in the README (draft — finalized in Phase 5)
- [ ] Example of `tenantIdResolver` by subdomain + by JWT claim included
- [ ] Clear explanation of the "PII in keys" vs "hashing" trade-off

### 5.6 Phase 4 Tests

**Files to create/expand:**

```
src/server/interceptors/notification-audit.interceptor.spec.ts    # new
test/e2e/tenant-isolation.e2e-spec.ts                              # new (§5.1)
test/e2e/audit-log.e2e-spec.ts                                     # new
src/server/bymax-notification.module.spec.ts                       # expandir (forRootAsync)
```

**Test cases (full implementations in the per-phase task files):**

#### `notification-audit.interceptor.spec.ts` — required cases

- Logs `verb: 'sent'` + `providerName: '__interceptor__'` when `dispatch` resolves
- Prefers `tenantId` from `tenantIdResolver(req)` over payload's `tenantId` (anti-spoofing gate)
- Logs `verb: 'failed'` + `errorMessage` when `dispatch` rejects, then re-throws
- Swallows audit log errors by default (`swallowErrors: true`)
- Propagates audit log errors when `swallowErrors: false`

Mock `ExecutionContext` via lightweight helper `buildContext(args, httpReq)`.

#### `audit-log.e2e-spec.ts` — required cases

- Logs both `generated` (OtpService) and `sent` (EmailService) for OTP via email
- Logs `cooldown_blocked` when generate within cooldown
- **Security gate:** OTP code NEVER appears in any audit entry (verify via `JSON.stringify(entry).includes(realCode)` returns false)
- Logs `max_attempts_exceeded` after exhausting attempts

**Acceptance criteria:**

- [ ] All listed `.spec.ts` files created
- [ ] `pnpm test:cov` reports **100% global** coverage
- [ ] Coverage per file (**100%**): `notification-audit.interceptor.ts`
- [ ] `pnpm test:e2e` zero failures
- [ ] "Never log OTP code" test passes — security gate

**Validation commands:**

```bash
pnpm test:cov
pnpm test:e2e
```

**Dependencies:** §5.1, §5.2, §5.3.

### 5.7 Update `src/server/index.ts`

```typescript
// Interceptors
export { NotificationAuditInterceptor } from './interceptors/notification-audit.interceptor'
```

### 5.8 Phase 4 validation

**Final commands:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm test:e2e && pnpm build && pnpm size
```

**Smoke test pattern:**

Spin up a NestJS fixture with `BymaxNotificationModule.forRootAsync({ useFactory: () => ({ global: { tenantIdResolver: (req) => req.headers['x-tenant-id'] as string }, email: { provider: new ResendEmailProvider({ apiKey }), defaultFrom, templateRenderer }, otp: { storage: new RedisOtpStorage({ redisClient }) }, audit: { repository: new MemoryAuditRepo(), swallowErrors: true } }) })`.

Validate:
- `module.module.name === 'BymaxNotificationModule'`
- Provider count matches the expectation (1 options + 1 audit + 1 email + 1 renderer + 1 storage + 3 services = 8)
- The audit repo receives entries when services are exercised via supertest (HTTP-level)

**Done criteria to close Phase 4:**

- [ ] Smoke test passes
- [ ] Coverage gate met (100% per file)
- [ ] E2E tests `tenant-isolation` and `audit-log` pass
- [ ] `forRootAsync()` validated in a fixture with `ConfigModule`
- [ ] Prisma schema fragment + example documented
- [ ] PR `phase-4` with `/bymax-quality:code-review` applied

---

## 6. Phase 5 — Frontend (`./react`)

> **Phase objective:** Implement the `./react` subpath with the `useOtpInput` and `useOtpCountdown` hooks plus their RTL tests. Release (Phase 6) follows.
>
> **Complexity:** MEDIUM. React hooks are simple state logic — `useState` + `useRef`. The risk lies in UX details (paste handler, auto-focus, Backspace navigation).
>
> **Critical paths for 100% coverage:** `src/react/useOtpInput.ts`, `src/react/useOtpCountdown.ts`.

### 6.1 `useOtpInput` hook

**Objective:** Hook that manages state for N 1-digit inputs, with auto-focus, paste handler, Backspace/Arrow navigation.

**Files to create:**

```
src/react/
├── useOtpInput.ts
├── types.ts
└── index.ts          # empty until §6.3
```

**Skeleton — `src/react/types.ts`:**

```typescript
export type OtpInputType = 'numeric' | 'alpha' | 'alphanumeric'

export interface UseOtpInputOptions {
  length?: number              // default 6
  type?: OtpInputType          // default 'numeric'
  onComplete?: (code: string) => void | Promise<void>
  autoSubmit?: boolean         // default true
  sanitizeOnPaste?: boolean    // default true (strip spaces/dashes)
}

export interface UseOtpInputState {
  values: string[]
  setValue: (index, value) => void
  onChange: (index) => (e: ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (index) => (e: KeyboardEvent<HTMLInputElement>) => void
  onPaste: (e: ClipboardEvent<HTMLInputElement>) => void  // attach to FIRST input only
  refs: ReadonlyArray<RefObject<HTMLInputElement>>
  reset: () => void
  code: string                  // joined values
  isComplete: boolean           // all slots filled
}

export interface UseOtpCountdownOptions {
  expiresAt: number | null      // null disables countdown
  tickIntervalMs?: number       // default 1000
  onExpired?: () => void
}

export interface UseOtpCountdownState {
  remainingSeconds: number      // >= 0
  expired: boolean              // remaining <= 0
  formatted: string             // 'MM:SS' or 'HH:MM:SS'
}
```

**Skeleton:**

```typescript
const VALIDATORS = {
  numeric: /^[0-9]$/,
  alpha: /^[A-Za-z]$/,
  alphanumeric: /^[A-Za-z0-9]$/,
}

export function useOtpInput(options: UseOtpInputOptions = {}): UseOtpInputState {
  // useState for values; useMemo for refs (stable identity)
  // useRef for onComplete callback (avoids stale closure)
  // useCallback for onChange/onKeyDown/onPaste/reset/setValue
}
```

**Implementation algorithm:**

- **State:**
  - `values: string[]` — initialized as `new Array(length).fill('')`
  - `refs: ReadonlyArray<RefObject<HTMLInputElement>>` — built via `useMemo(() => Array.from({ length }, () => ({ current: null })), [length])`
  - `onCompleteRef = useRef(options.onComplete)` — updated each render to avoid stale closure

- **`focus(index)`** — `if (index in bounds) refs[index]?.current?.focus()`

- **`onChange(index)(e)`:**
  - If `raw.length > 1` → return (mobile Safari fires paste through onChange)
  - If `raw && !validator.test(raw)` → return (reject invalid)
  - `upper = type === 'numeric' ? raw : raw.toUpperCase()`
  - Update slot, focus next if filled and not last
  - Trigger `onComplete` if all filled (via microtask `Promise.resolve().then(...)` so React commits state first)

- **`onKeyDown(index)(e)`:**
  - `Backspace` + current empty + index > 0 → clear previous slot + focus previous
  - `ArrowLeft` + index > 0 → focus previous
  - `ArrowRight` + index < length - 1 → focus next

- **`onPaste(e)`:**
  - `text = e.clipboardData.getData('text')`
  - If `sanitizeOnPaste` → `text.replace(/[\s-]+/g, '')`
  - Filter via validator; `slice(0, length)`
  - Uppercase non-numeric mode
  - Distribute across slots; focus last filled
  - Trigger `onComplete` if all filled

- **`reset()`** — `setValues(new Array(length).fill(''))` + `focus(0)`

- **Derived:** `code = values.join('')`, `isComplete = values.every(v => v !== '')`

**Acceptance criteria:**

- [ ] `useOtpInput({ length: 6 })` returns a `values` array of 6 empty strings initially
- [ ] `onChange` on an empty slot with a valid char fills the slot and focuses the next
- [ ] `onChange` on a slot with an invalid char does NOT change the value
- [ ] `onChange` with an alpha char in `numeric` mode is rejected
- [ ] `onChange` in `alpha`/`alphanumeric` mode uppercases the input
- [ ] `onKeyDown` Backspace on an empty slot clears the previous slot and focuses it
- [ ] `onKeyDown` ArrowLeft/ArrowRight navigates slots
- [ ] `onPaste` distributes clipboard chars across slots
- [ ] `onPaste` sanitizes spaces and hyphens when `sanitizeOnPaste: true`
- [ ] `onPaste` filters chars that don't pass the validator
- [ ] `onComplete` called when all slots are filled AND `autoSubmit: true`
- [ ] `reset()` clears all slots and focuses slot 0
- [ ] `code` returns the joined slots
- [ ] `isComplete` returns `true` when all slots are filled
- [ ] Coverage 100%

**Validation commands:**

```bash
pnpm test src/react/useOtpInput.spec.tsx
```

**Dependencies:** §2.1 (`react` peer dep).

**Risks/Notes:**

- ⚠️ `useMemo` for refs guarantees same identity — without it, new refs on each render would break `focus()`
- ⚠️ `onComplete` in a microtask avoids the "state not yet committed" issue when the consumer does `fetch` in the callback
- ⚠️ Mobile Safari fires `onChange` with the entire pasted string — hence the early-return on `raw.length > 1`

### 6.2 `useOtpCountdown` hook

**Objective:** Reactive hook that returns seconds remaining until `expiresAt`, with MM:SS formatting.

**Files to create:**

```
src/react/useOtpCountdown.ts
```

**Skeleton:**

```typescript
export function useOtpCountdown(options: UseOtpCountdownOptions): UseOtpCountdownState {
  // useState(remainingSeconds), useEffect(setInterval), useRef(onExpired)
}

function computeRemaining(expiresAt: number | null): number
function formatTime(totalSeconds: number): string
```

**Implementation algorithm:**

- `tickIntervalMs = options.tickIntervalMs ?? 1000`
- `remainingSeconds` state initialized via `computeRemaining(options.expiresAt)`
- `onExpiredRef = useRef(options.onExpired)`; refresh each render
- `useEffect([options.expiresAt, tickIntervalMs])`:
  - If `expiresAt === null` → `setRemainingSeconds(0)`; return (no interval)
  - Otherwise: immediate `setRemainingSeconds(computeRemaining(expiresAt))` (avoid wait for first tick)
  - `setInterval` ticks every `tickIntervalMs`:
    - `remaining = computeRemaining(expiresAt)`
    - `setRemainingSeconds(remaining)`
    - If `remaining === 0`: `clearInterval(interval); onExpiredRef.current?.()`
  - Cleanup: `() => clearInterval(interval)`
- Return `{ remainingSeconds, expired: remainingSeconds === 0, formatted: formatTime(remainingSeconds) }`

**Helpers:**

- `computeRemaining(expiresAt)` — `null` → 0; else `Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))`
- `formatTime(totalSeconds)` — `<= 0` → `'00:00'`; else `pad(minutes):pad(seconds)`; with hours if `>= 3600`

**Acceptance criteria:**

- [ ] `useOtpCountdown({ expiresAt: null })` returns `{ remainingSeconds: 0, expired: true, formatted: '00:00' }`
- [ ] `useOtpCountdown({ expiresAt: Date.now() + 60_000 })` returns `remainingSeconds: ~60` initially
- [ ] After tick, `remainingSeconds` decrements
- [ ] `onExpired` called when atinge 0
- [ ] After expiry, `interval` is cleared (`clearInterval` called)
- [ ] `formatted` is `'MM:SS'` for < 1h, `'HH:MM:SS'` for >= 1h
- [ ] Cleanup on unmount removes the interval
- [ ] Re-render with new `expiresAt` updates countdown immediately
- [ ] Coverage 100% (using `jest.useFakeTimers()`)

**Validation commands:**

```bash
pnpm test src/react/useOtpCountdown.spec.tsx
```

**Dependencies:** §2.1.

**Risks/Notes:**

- ⚠️ `setInterval` in tests — use `jest.useFakeTimers()` + `jest.advanceTimersByTime()`
- ⚠️ `onExpiredRef` avoids stale closure when consumer recria a callback on each render
- ⚠️ In production, a 1000ms interval is fine; advanced consumers can reduce to 100ms for smoother UX

### 6.3 Barrel export `./react`

**Files to modify:**

```
src/react/index.ts
```

**Skeleton:**

```typescript
export { useOtpInput } from './useOtpInput'
export { useOtpCountdown } from './useOtpCountdown'
export type {
  OtpInputType,
  UseOtpInputOptions,
  UseOtpInputState,
  UseOtpCountdownOptions,
  UseOtpCountdownState,
} from './types'
```

### 6.4 Testes do subpath React

**Files to create:**

```
src/react/
├── useOtpInput.spec.tsx
└── useOtpCountdown.spec.tsx
```

**Tooling:**

- `jest-environment-jsdom` for DOM virtual
- `@testing-library/react` for `renderHook`, `act`

**Test cases (use `@testing-library/react` `renderHook` + `act`; full implementations in the per-phase task files):**

#### `useOtpInput.spec.tsx` — required cases

- Initializes with empty values array of `length` strings
- Accepts valid digit, focuses next slot
- Rejects invalid character in `numeric` mode (slot stays empty)
- Uppercases input in `alphanumeric` / `alpha` mode
- Backspace in empty slot clears previous + moves focus back
- Backspace in filled slot only clears current
- ArrowLeft / ArrowRight navigate slots
- Paste distributes chars across slots (e.g., `'123-456'` → `['1','2','3','4','5','6']`)
- Paste sanitizes whitespace and dashes when `sanitizeOnPaste: true`
- Paste filters invalid chars per validator
- `onComplete` called with joined code when all slots filled (microtask deferred)
- `reset()` zeros all slots and focuses slot 0
- `code` returns joined values; `isComplete` returns boolean

#### `useOtpCountdown.spec.tsx` — required cases

Use `jest.useFakeTimers()` + `jest.advanceTimersByTime()`.

- `expiresAt: null` → `{ remainingSeconds: 0, expired: true, formatted: '00:00' }`
- Computes initial `remainingSeconds` correctly
- Decrements on each tick
- Calls `onExpired` exactly once when reaches 0
- Clears interval after expiry (no zombie callbacks)
- Formats `< 1h` as `MM:SS`; `>= 1h` as `HH:MM:SS`
- Cleans up interval on unmount
- Re-render with new `expiresAt` resets countdown immediately

**Acceptance criteria:**

- [ ] Coverage 100% in both hooks
- [ ] Tests use `jest-environment-jsdom`
- [ ] `pnpm test` zero failures

**Validation commands:**

```bash
pnpm test src/react/
```

**Dependencies:** §6.1, §6.2.

### 6.5 Phase 5 validation

**Final commands:**

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size
```

**Done criteria to close Phase 5:**

- [ ] `useOtpInput` and `useOtpCountdown` implemented with 100% coverage
- [ ] `./react` barrel exports both hooks + their types
- [ ] `pnpm build` emits `dist/react/index.{mjs,cjs,d.ts}` with `react` marked external
- [ ] Bundle `dist/react/index.mjs` < 8 KB brotli
- [ ] PR `phase-5` with `/bymax-quality:code-review` applied

---

## 7. Phase 6 — Release v0.1.0

> **Phase objective:** Finalize documentation (README, CHANGELOG, SECURITY.md, CLAUDE.md, AGENTS.md) and the release surface (the CI/CodeQL/Scorecard/Release workflows already exist and have gated every phase since §2.1 — here we add the dogfood smoke + verify badges/Scorecard), validate bundle budgets, run end-to-end mutation testing, then tag + publish v0.1.0 — the dogfood smoke (§7.3) is the consumer validation that gates the release.
>
> **Complexity:** MEDIUM. Mechanical but requires attention (provenance, scorecard, mutation gate).

### 7.1 README end

**Objective:** Complete README, mirroring the `nest-auth/README.md` structure. Includes badges, quick start, examples, subpath table, multi-tenant security.

**Files to create:**

```
README.md
```

**Structure (≈12-18 KB; mirrors `bymax-one/nest-auth/README.md`):**

```
<badges row>
<title + tagline>

## Overview                  — 3-4 paragraphs elevator pitch
## Features                  — bullets: channels, providers, multi-tenant, audit
## Subpath Exports           — table (`.`, `./shared`, `./react`)
## Quick Start               — 3 complete copy-pasteable scenarios:
                               (1) Dev (NoOp + InMemory)
                               (2) Production (Resend + Redis)
                               (3) With audit log (Prisma example)
## Configuration             — link to spec §4 + table of main options
## Bring Your Own Provider   — IEmailProvider and IOtpStorage; link for docs/templates/
## Multi-tenant Security     — copy from §5.5 of this plan
## Templates                 — IEmailTemplateRenderer + CANONICAL_EMAIL_TEMPLATES
## Testing                   — coverage targets, as run
## Roadmap                   — v0.2 (SMS, Push), v0.3 (failover)
## Contributing
## License (MIT)
```

**Acceptance criteria:**

- [ ] 3 complete copy-pasteable scenarios
- [ ] Badges: npm version, CI status, coverage, mutation, scorecard, license
- [ ] Links for SECURITY.md, CHANGELOG.md, spec, plan
- [ ] Table de subpaths
- [ ] Multi-tenant Security section
- [ ] Table with examples de providers (Resend / SendGrid / SES / Mailgun) and where encontrar adapter examples (em `docs/templates/`)
- [ ] Disclaimer "SMS + Push v0.2"
- [ ] Size ~12-18 KB

### 7.2 CHANGELOG, SECURITY, CLAUDE, AGENTS

**Files to create:**

```
CHANGELOG.md
SECURITY.md
CLAUDE.md
AGENTS.md
LICENSE
```

**Structure of each (each file ≈ 5-20 KB; mirror `nest-auth`):**

- **`CHANGELOG.md`** — Keep a Changelog format. `[0.1.0]` entry lists all `Added` items (module, services, providers, interfaces, hooks, multi-tenant, audit, adapter examples) and `Deferred (v0.2)` items (SMS, Push, `forRootAsync` `useClass`/`useExisting`).

- **`SECURITY.md`** — Supported versions table; reporting via `security@bymax.one`; scope in/out (in: OTP gen, timing-safe compare, multi-tenant isolation, audit leakage, tenant spoofing | out: provider issues, consumer misuse).

- **`CLAUDE.md`** — Mirror nest-auth's CLAUDE.md structure (under 110 lines). Critical rules section enumerates: (1) npm library not app + NEVER `@prisma/client`, (2) English only, (3) Zero `any`, (4) Security (`node:crypto.randomInt`, `timingSafeEqual`, never log codes, sha256 hashing), (5) NestJS patterns (conditional provider registration, `Symbol()` tokens, `@Optional()`), (6) Code style, (7) TDD 80%+/95%, (8) tsup 3 subpaths. Plus subpaths table + verification command.

- **`AGENTS.md`** — ≈ 20 KB. Full architecture deep-dive: layered diagram, conditional registration mechanics, multi-tenant security model, audit fire-and-forget pattern, provider implementation guide, peer dep matrix.

- **`LICENSE`** — MIT, identical to nest-auth.

**Acceptance criteria:**

- [ ] All 5 files created
- [ ] CHANGELOG follows Keep a Changelog
- [ ] SECURITY.md has PGP/email + scope
- [ ] CLAUDE.md mirrors estrutura do nest-auth
- [ ] LICENSE is MIT

### 7.3 CI/release finalization

> **The four workflows are created in Phase 1 (§2.1), not here.** Because the whole library is built 100% by agents, CI must gate every PR from the very first one — so `.github/workflows/{ci,codeql,scorecard,release}.yml` ship in the foundation task and are designed **incremental-safe** (see §2.1). This sub-step only finalizes the release surface.

**The CI established in Phase 1 (gold-standard mirror of `bymax-one/nest-cache`):**

- `ci.yml` — `verify` job on Node 24 / pnpm 10.8.1, least-privilege `permissions: contents: read`, `concurrency` cancel-in-progress: `typecheck` · `lint` · `check:no-prisma` · `test:cov` · `test:e2e` · `build` · build-output integrity (server/shared/react × mjs/cjs/d.ts) · `size` · coverage artifact · PR dependency-review (non-blocking). **No mutation step** (pre-release only).
- `codeql.yml` — javascript-typescript, `security-extended`, push/PR/weekly.
- `scorecard.yml` — push + weekly, SARIF upload + `publish_results`.
- `release.yml` — tag `v*.*.*`-driven only: `npm-publish` environment, tag↔version guard, `prepublishOnly`, release-shape gates (`size` + dogfood smoke), OIDC `pnpm publish --provenance`, CHANGELOG-extract + `gh release create`.

**Incremental-safety (why it passes at every phase):** jest `passWithNoTests: true`; coverage enforced only over implemented files; build-output integrity tolerates the empty `react` subpath; size budgets pass on small bundles; e2e specs first appear in Phase 4 (pass-with-no-tests before that); mutation and publish are out of the per-PR path.

**This sub-step (finalization) creates:**

- `scripts/dogfood-smoke-test.mjs` — the release-shape smoke `release.yml` invokes (imports all 3 subpaths, runs a minimal `forRoot` + hook smoke).

**Acceptance criteria:**

- [ ] The 4 workflows already exist (from Phase 1) and `ci.yml` has been green across every phase
- [ ] `scripts/dogfood-smoke-test.mjs` passes
- [ ] `release.yml` tag-gated with `--provenance`; Scorecard ≥ 7.0 (weekly cron); CodeQL clean

### 7.4 Bundle size budgets

**Modification — `scripts/check-size.mjs`:**

```javascript
const BUDGETS = [
  {
    name: 'server (NestJS module + services + providers)',
    path: 'dist/server/index.mjs',
    brotli: 30_000,  // ~30 KB brotli
  },
  {
    name: 'shared (types + constants)',
    path: 'dist/shared/index.mjs',
    brotli: 4_000,   // ~4 KB brotli
  },
  {
    name: 'react (hooks)',
    path: 'dist/react/index.mjs',
    brotli: 8_000,   // ~8 KB brotli
  },
]
```

**Acceptance criteria:**

- [ ] `pnpm size` shows `server` < 30KB, `shared` < 4KB, `react` < 8KB brotli
- [ ] CI roda `pnpm size` in the `ci.yml`

### 7.5 Mutation testing end

```bash
pnpm mutation:dry-run  # ensure config ok
pnpm mutation           # full run (~15 min)
```

**Acceptance criteria:**

- [ ] Mutation score ≥ 95% global, driven as close to 100% as achievable (Stryker break 95)
- [ ] Mutation score 100% on critical paths: `code-generator.ts`, `timing-safe-compare.ts`, `hash.ts`, `redis-otp.storage.ts`, `otp.service.ts` (no surviving non-equivalent mutants)
- [ ] Update `docs/mutation_testing_results.md` with timestamp + score
- [ ] Equivalent mutants documented inline with `// Stryker disable next-line <Mutator>: <reason>`

### 7.6 Final validation + tag + publish

**Commands:**

```bash
# 1. Full quality gate
pnpm prepublishOnly

# 2. Confirm version bump
pnpm version 0.1.0

# 3. Push tag — release.yml fires
git push --follow-tags

# 4. Verify on npm
npm view @bymax-one/nest-notification@0.1.0
```

**Acceptance criteria:**

- [ ] Tag `v0.1.0` created
- [ ] Workflow `release.yml` verde
- [ ] Pacote in `https://www.npmjs.com/package/@bymax-one/nest-notification`
- [ ] Badge "Provenance" aparece in the npm
- [ ] OpenSSF Scorecard ≥ 7.0
- [ ] CHANGELOG `0.1.0` entry with timestamp

### 7.7 Release notes — v0.1.0

> **Released:** [date]
>
> **Highlights:**
> - Multi-channel notification library for NestJS
> - Email + OTP channels GA
> - Multi-tenant ready
> - Pluggable providers and storage
> - Zero direct dependencies (everything peer dep)
> - 100% Prisma-free (interface-based persistence)
>
> **Deferred to v0.2:**
> - SMS channel (interfaces ready, services not implemented)
> - Push channel (interfaces ready, services not implemented)
> - `forRootAsync` `useClass` / `useExisting`
> - Multi-provider failover

**Done criteria to close Phase 6:**

- [ ] Coverage 100% (release gate)
- [ ] Bundle within budgets
- [ ] Mutation score ≥ 95%, as close to 100% as achievable (Stryker break 95)
- [ ] E2E suite passes
- [ ] README + CHANGELOG + SECURITY + CLAUDE + AGENTS published
- [ ] Tag `v0.1.0` + npm publish
- [ ] Release notes posted

---

## Appendix A — Dependency Graph

```
                  Phase 1 — Foundation
                          │
                          ▼
            ┌─────────────────────────────────┐
            │  IEmailProvider                  │ ← §2.3
            │  IOtpStorage (Prisma DISSOLVED)  │ ← §2.3
            │  IEmailTemplateRenderer          │ ← §2.3
            │  INotificationLogRepository      │ ← §2.3
            │  ISmsProvider (v0.2 sketch)      │ ← §2.3
            │  IPushProvider (v0.2 sketch)     │ ← §2.3
            │  NotificationException + codes   │ ← §2.4
            │  BymaxNotificationModule (stub)  │ ← §2.8
            └─────────┬───────────────────────┘
                      │
                      ▼
                  Phase 2 — Services + Providers
                      │
            ┌─────────────────────────────────┐
            │  ResendEmailProvider (Resend)   │ ← §3.1
            │  RedisOtpStorage (hash keys)    │ ← §3.3
            │  InMemoryOtpStorage             │ ← §3.2
            │  EmailService                   │ ← §3.4
            │  OtpService                     │ ← §3.5
            │  NotificationService            │ ← §3.6
            └─────────┬───────────────────────┘
                      │
                      ▼
                  Phase 3 — Templating + Rate Limiting
                      │
            ┌─────────────────────────────────┐
            │  DefaultTemplateRenderer (full) │ ← §4.1
            │  cooldown-helpers               │ ← §4.3
            │  CANONICAL_EMAIL_TEMPLATES      │ ← §4.6
            └─────────┬───────────────────────┘
                      │
                      ▼
                  Phase 4 — Multi-tenant + Audit
                      │
            ┌─────────────────────────────────┐
            │  Tenant isolation tests         │ ← §5.1
            │  NotificationAuditInterceptor   │ ← §5.2
            │  forRootAsync (full)            │ ← §5.3
            │  Prisma fragment + example      │ ← §5.4
            └─────────┬───────────────────────┘
                      │
                      ▼
                  Phase 5 — Frontend (./react)
                      │
            ┌─────────────────────────────────┐
            │  useOtpInput (./react)          │ ← §6.1
            │  useOtpCountdown (./react)      │ ← §6.2
            └─────────┬───────────────────────┘
                      │
                      ▼
                  Phase 6 — Release v0.1.0
                      │
            ┌─────────────────────────────────┐
            │  README + CHANGELOG + CI        │ ← §7.1-7.3
            │  Bundle budgets + mutation 95   │ ← §7.4-7.5
            │  Tag v0.1.0 + publish           │ ← §7.6
            └─────────────────────────────────┘
```

---

## Appendix B — Complexity Matrix

| Phase | Sub-step | Est. LoC | Complexity | Main risk |
|---|---|---|---|---|
| 1 | 2.1 Scaffold + complete CI (4 workflows, incremental-safe) | ~30 LoC + configs + ~300 LoC YAML | MEDIUM | CI must pass at every phase (passWithNoTests, coverage on implemented files, empty-react integrity) |
| 1 | 2.2 Shared types | ~70 LoC | LOW | — |
| 1 | 2.3 Interfaces (7 files) | ~250 LoC | MEDIUM | Document Prisma decoupling in IOtpStorage |
| 1 | 2.4 Constants + tokens + error codes + exception | ~280 LoC | MEDIUM | Sync between server and shared error codes |
| 1 | 2.5 validateOptions + resolveOptions | ~200 LoC | MEDIUM | Validation edge cases; deep freeze |
| 1 | 2.6 No-op providers + default renderer (minimum) | ~150 LoC | LOW | Correct HTML escape |
| 1 | 2.7 hash + code-generator + timing-safe-compare | ~80 LoC | MEDIUM | 100% required coverage; safe crypto |
| 1 | 2.8 BymaxNotificationModule.forRoot | ~200 LoC | MEDIUM | Conditional registration without leaking tokens |
| 1 | 2.9 Barrel exports | ~50 LoC | LOW | — |
| 1 | 2.10 Tests Phase 1 | ~900 LoC | MEDIUM | Mock chains de NestJS testing |
| 2 | 3.1 ResendEmailProvider | ~120 LoC | MEDIUM | Lazy import de `resend` |
| 2 | 3.2 InMemoryOtpStorage | ~90 LoC | LOW | Self-eviction in get |
| 2 | 3.3 RedisOtpStorage | ~150 LoC | HIGH | `SET XX EX` correct; hashing applied |
| 2 | 3.4 EmailService | ~200 LoC | HIGH | Fire-and-forget audit; optional rendering |
| 2 | 3.5 OtpService | ~300 LoC | HIGH | Atomic increment attempts; timing-safe verification |
| 2 | 3.6 NotificationService | ~140 LoC | MEDIUM | Discriminated dispatch input |
| 2 | 3.7 Wiring in the module | ~30 LoC modification | LOW | — |
| 2 | 3.8 Barrel updated | ~30 LoC | LOW | — |
| 2 | 3.9 Tests Phase 2 | ~1400 LoC | HIGH | Cover all branches of the services |
| 3 | 4.1 DefaultTemplateRenderer refinement | ~180 LoC | MEDIUM | Nested paths; fallback chain |
| 3 | 4.2 Docs templates (3 adapters) | doc-only | LOW | — |
| 3 | 4.3 cooldown-helpers | ~50 LoC | LOW | — |
| 3 | 4.4 OtpService cooldown details | ~10 LoC modification | LOW | — |
| 3 | 4.5 Exports atualizados | ~10 LoC | LOW | — |
| 3 | 4.6 CANONICAL_EMAIL_TEMPLATES | ~30 LoC | LOW | — |
| 3 | 4.7 Tests Phase 3 | ~400 LoC | MEDIUM | — |
| 4 | 5.1 Tenant isolation e2e | ~150 LoC | MEDIUM | Mock Redis with ioredis-mock |
| 4 | 5.2 NotificationAuditInterceptor | ~150 LoC | MEDIUM | ExecutionContext mock |
| 4 | 5.3 forRootAsync complete | ~150 LoC modification | HIGH | Async wiring without losing lazy resolution |
| 4 | 5.4 Prisma fragment + example | doc-only | LOW | — |
| 4 | 5.5 README security section | doc-only | LOW | — |
| 4 | 5.6 Tests Phase 4 | ~400 LoC | MEDIUM | — |
| 4 | 5.7 Exports atualizados | ~5 LoC | LOW | — |
| 5 | 6.1 useOtpInput | ~200 LoC | MEDIUM | Refs identity, paste edge cases |
| 5 | 6.2 useOtpCountdown | ~80 LoC | LOW | jest fake timers |
| 5 | 6.3 Barrel ./react | ~10 LoC | LOW | — |
| 5 | 6.4 Tests React | ~500 LoC | MEDIUM | renderHook + act setup |
| 6 | 7.1 README | doc | LOW | — |
| 6 | 7.2 CHANGELOG + SECURITY + CLAUDE + AGENTS | doc | LOW | — |
| 6 | 7.3 CI/release finalization (dogfood smoke; workflows from §2.1) | ~40 LoC | LOW | — |
| 6 | 7.4 Bundle budgets | ~30 LoC | LOW | — |
| 6 | 7.5 Mutation testing | manual | MEDIUM | Equivalent mutants; break 95 |
| 6 | 7.6 Tag + publish | manual | LOW | Provenance OIDC works |

**Total estimated LoC (source + tests):** ~7,000 LoC (lib).

---

## Appendix C — Reference Configs

> Source repo: `~/Documents/MyApps/bymax-one/nest-auth` (the canonical TS lib template). Paths below are relative to it.

| File | Source to copy (and adapt) |
|---|---|
| `tsconfig.json` | `bymax-one/nest-auth/tsconfig.json` — switch path aliases to the 3 subpaths |
| `tsconfig.build.json` | `bymax-one/nest-auth/tsconfig.build.json` (identical) |
| `tsconfig.server.json` | `bymax-one/nest-auth/tsconfig.server.json` |
| `tsconfig.e2e.json` | `bymax-one/nest-auth/tsconfig.e2e.json` |
| `tsconfig.jest.json` | `bymax-one/nest-auth/tsconfig.jest.json` |
| `jest.config.ts` | `bymax-one/nest-auth/jest.config.ts` — adapt `moduleNameMapper` for 3 subpaths; add `jest-environment-jsdom` for `react/*` |
| `jest.coverage.config.ts` | `bymax-one/nest-auth/jest.coverage.config.ts` |
| `jest.e2e.config.ts` | `bymax-one/nest-auth/jest.e2e.config.ts` |
| `jest.stryker.config.ts` | `bymax-one/nest-auth/jest.stryker.config.ts` |
| `stryker.config.json` | `bymax-one/nest-auth/stryker.config.json` — thresholds (high 100, low 95, break 95) |
| `eslint.config.mjs` | `bymax-one/nest-auth/eslint.config.mjs` — remove crypto/oauth rules; keep the security plugin |
| `.prettierrc` | `bymax-one/nest-auth/.prettierrc` |
| `.gitignore` | `bymax-one/nest-auth/.gitignore` |
| `scripts/check-size.mjs` | `bymax-one/nest-auth/scripts/check-size.mjs` — adapt BUDGETS for 3 entries |
| `.github/workflows/*.yml` | `bymax-one/nest-auth/.github/workflows/*.yml` — add a `pnpm check:no-prisma` step in `ci.yml` |
| `tsup.config.ts` | **Custom — 3 entries** (do not copy nest-auth's, which has 5) |

---

## Appendix D — Glossary

| Term | Meaning in this plan |
|---|---|
| **Phase** | A cohesive block of functionality delivering a vertical slice of the lib |
| **Sub-step** | §N.M within a phase — atomic enough to become 1+ tasks in `docs/tasks/phase-NN-<slug>.md` |
| **Acceptance criteria** | Binary (yes/no) checklist for closing a sub-step |
| **Validation command** | Exact command to run to validate acceptance |
| **Done criteria** | Aggregated set of gates to close an entire phase |
| **AAA pattern** | Arrange/Act/Assert — test convention |
| **TDD red-green-refactor** | Write failing test → implement minimal → refactor |
| **Mutation score** | % of mutations detected by tests (Stryker); release gate ≥ 95%, driven to 100% (break 95) |
| **Coverage gate** | Coverage floor per file / global — 100% on this lib |
| **`consumeAttempt`** | Atomic `IOtpStorage` verify primitive (Redis Lua / single Map op) — lookup + attempt increment in one step |
| **`tryAcquireCooldown`** | Atomic cooldown acquire (`SET NX EX`) used as a short-lived lock around generate/resend |
| **Discriminated union** | TS pattern (e.g., `OtpVerifyResult`) where the `valid: true/false` field narrows the type |
| **Prisma decoupling** | Central principle: the lib NEVER imports `@prisma/client`. Persistence via `IOtpStorage` and `INotificationLogRepository` |
| **Tenant scoping** | Isolation between tenants via `(tenantId, recipient, purpose)` in all keys |
| **sha256 hashing** | `sha256(tenantId:recipient)` applied to Redis keys for privacy + multi-tenancy |
| **Cooldown** | Minimum time between OTP resends — anti-brute-force |
| **Audit fire-and-forget** | Audit log is recorded but failures do not propagate to the caller (controlled by `swallowErrors`) |
| **`OTP_INVALID_LENGTH` on generation** | Preventive validation in `code-generator` when length is outside [1, 32] |
| **Timing-safe compare** | Length-guarded `crypto.timingSafeEqual` (`safeCompare`) — guards against timing-oracle attacks |
| **Channel opt-in** | A channel is registered in the DI container only if configured in `forRoot()` |
| **`OtpVerifyResult.reason`** | Discriminator in the `valid: false` branch — `'not_found' \| 'max_attempts' \| 'invalid_code'` (expired is reported as `not_found`) |
| **MVP scoping** | Decision of which features enter v0.1 vs v0.2 (SMS/Push deferred) |

---

## Appendix E — Redis Key Strategy

> **Inspired by Appendix §12.3 of the nest-auth plan.** This table is the reference for ALL Redis keys used by the lib when the consumer adopts `RedisOtpStorage` (default).

### E.1 Key schema

All keys follow the format: `{namespace}:{prefix}:{purpose}:{identifier}`

| Component | Meaning | Default |
|---|---|---|
| `namespace` | Prefix configurable via `global.redisNamespace` | `'notification'` |
| `prefix` | Key type — `'otp'` or `'otp_cd'` | hardcoded |
| `purpose` | OTP purpose (`email_verification`, `password_reset`, etc.) | consumer string |
| `identifier` | `sha256(tenantId:recipient)` hex-encoded (64 chars) | calculated |

### E.2 Complete keys table

| Prefix | Full key pattern | Stored value | TTL | Operations | Purpose |
|---|---|---|---|---|---|
| `otp` | `notification:otp:{purpose}:{sha256(tid+':'+rcpt)}` | JSON: `{ code: string, expiresAt: number, attempts: number, maxAttempts: number, validated?: boolean, metadata?: object }` | `ttlSeconds` per purpose (default 600s) | `SETEX` on set; `EVAL` (Lua `consumeAttempt`) on verify; `SET ... KEEPTTL XX` on update; `GET` on get; `DEL` on delete | OTP entry. Stores code in plaintext (compared in constant time), attempt counter, validation flag. We hash `(tenantId, recipient)` for privacy. |
| `otp_cd` | `notification:otp_cd:{purpose}:{sha256(tid+':'+rcpt)}` | `'1'` (sentinel) | `resendCooldownSeconds` (default 60s) | `SET ... NX EX` in tryAcquireCooldown; `TTL` in getCooldown; `DEL` in clearCooldown | Cooldown lock between resends. Acquired atomically with `NX`; key existence indicates active cooldown; the TTL is the relevant data. |

### E.3 Exemplo concrete

Consumer call:

```typescript
await otpService.generate({
  tenantId: 'tenant_acme',
  recipient: 'maria@example.com',
  purpose: 'email_verification',
})
```

Result in Redis:

```
SET   notification:otp_cd:email_verification:7f3d8c91a2b4...c2a0  '1'  NX EX 60     # atomic cooldown acquire (first)
SETEX notification:otp:email_verification:7f3d8c91a2b4...c2a0  3600  '{"code":"739204","expiresAt":1716816000000,"attempts":0,"maxAttempts":5}'
```

Where `7f3d8c91a2b4...c2a0` is `sha256("tenant_acme:maria@example.com")`.

### E.4 Redis operations per flow

#### `generate` flow

```
1. SET notification:otp_cd:{purpose}:{h} '1' NX EX {cooldownTtl}   → atomic cooldown acquire
       If reply != 'OK':
         remaining = TTL notification:otp_cd:{purpose}:{h}
         throw NotificationException OTP_COOLDOWN_ACTIVE { remainingSeconds: remaining }
         (audit: verb='cooldown_blocked')

2. (generate code via the crypto-secure generator — digit-by-digit)

3. SETEX notification:otp:{purpose}:{h} {ttl} {json}
       Creates/overwrites entry. TTL = ttlSeconds from config.

4. (if deliverVia='email') emailService.sendTemplate(template='otp_code', data={code,...})
       On send failure → DEL both keys, audit verb='failed', rethrow (no lockout, no orphan)

5. audit: verb='generated' (no code in metadata)
```

#### `verify` flow

```
1. EVAL consumeAttempt.lua 1 notification:otp:{purpose}:{h} {now}   → ATOMIC
       Inside the script (indivisible): GET → if missing/expired DEL + {status:'not_found'};
       if attempts >= maxAttempts DEL + {status:'max_attempts'};
       else attempts++ and SET ... PX {PTTL}; return {status:'ok', entry}.

2. status 'not_found'    → { valid: false, reason: 'not_found' }   (audit: verb='failed' reason='not_found'; expired collapses here)
   status 'max_attempts' → { valid: false, reason: 'max_attempts' } (audit: verb='max_attempts_exceeded')

3. (constant-time compare entry.code vs input.code via safeCompare — length-guarded)
       If it doesn't match:
         returns { valid: false, reason: 'invalid_code', remainingAttempts }
         (audit: verb='failed' reason='invalid_code')

4. (success)
       If consumeOnVerify === true:
         DEL notification:otp:{purpose}:{h}; DEL notification:otp_cd:{purpose}:{h}
       Otherwise:
         SET notification:otp:{purpose}:{h} {validatedJson} KEEPTTL XX

5. returns { valid: true }
   (audit: verb='verified')
```

#### `consume` flow

```
1. DEL notification:otp:{purpose}:{h}
2. DEL notification:otp_cd:{purpose}:{h}
       Idempotent. Clearing the cooldown lets a cancelled/completed flow
       restart immediately (e.g. resend with a corrected email).
```

### E.5 Hashing rationale — security analysis

**Attack 1 — Enumeration via `KEYS notification:otp:*`:**

Without hashing, Redis operators with read access can enumerate emails in OTP flows, cross-reference `(tenantId, recipient)` to identify accounts, and infer which tenants exist. With `sha256(tenantId:recipient)` hex, all keys become opaque — preimage resistance (≈ 2^256 operations) prevents reversing the hash; a rainbow table covering all possible tuples is infeasible.

**Attack 2 — Tenant collision via the `:` separator:**

Without hashing, if `tenantId` allows `:` in values (e.g., `tenant_a:b`), the format `tenant_a:b:foo@x.com` ambiguously collides between `(tenantId='tenant_a:b', recipient='foo@x.com')` and `(tenantId='tenant_a', recipient='b:foo@x.com')` — risk of mixed OTPs. SHA-256 eliminates this ambiguity: the hash depends on the full concatenated string; there is no interpretable delimiter.

### E.6 Performance trade-offs

| Operation | Cost | Comment |
|---|---|---|
| `sha256(string)` on CPU | < 1 µs for strings < 1 KB | Local, synchronous hashing — negligible |
| `SETEX` | O(1) | fast |
| `GET` | O(1) | fast |
| `EVAL` (consumeAttempt Lua) | O(1) | single-key script; runs atomically server-side |
| `SET ... KEEPTTL XX` / `SET ... NX EX` | O(1) | fast; the XX/NX check is local |
| `DEL` / `TTL` / `PTTL` | O(1) | fast |

**Expected throughput:** > 50k ops/s per Redis instance. At larger volumes (e.g., 100k concurrent OTPs per second), the consumer can:
- Partition by tenantId across multiple Redis instances
- Implement `IOtpStorage` with additional Lua scripts for batch operations
- Migrate to DynamoDB with native TTL

### E.7 Comparison with nest-auth §12.3

`@bymax-one/nest-auth` uses a similar key hashing strategy for sessions, brute-force counters, and refresh tokens. Naming conventions are consistent:

| Lib | Prefix | Strategy |
|---|---|---|
| nest-auth | `auth:session:`, `auth:bf:`, `auth:refresh:` | sha256(token) or sha256(userId+ip) in keys |
| nest-notification | `notification:otp:`, `notification:otp_cd:` | sha256(tenantId+recipient) in keys |

A consumer using BOTH libs can share the same Redis instance without collision thanks to the distinct namespaces.

### E.8 Resumo executivo

> The lib uses **2 Redis key prefixes** (`otp` and `otp_cd`), always prefixed by `{namespace}:`, always with identifier `sha256(tenantId:recipient)`. All operations are O(1). TTL is Redis's responsibility (no manual GC). Hashing protects privacy (PII outside keys) and eliminates delimiter ambiguity. A consumer that needs non-Redis storage implements `IOtpStorage` with its own key strategy — just preserve the invariant: keys must isolate by `(tenantId, recipient, purpose)` and ideally not expose PII.

---

> **Layer 3 (tasks):** the executable per-phase task files live in [`docs/tasks/`](./tasks/) — one file per phase (`phase-01..07-<slug>.md`) plus a [`README`](./tasks/README.md) index/dashboard. They are derived from this plan and follow the Bymax one-file-per-phase task convention (same pattern as `bymax-one/rust-auth`).
