# @bymax-one/nest-notification — Agent Specification

Architecture deep-dive for agents and contributors. For the quick rules, see
[CLAUDE.md](./CLAUDE.md). For consumer usage, see [README.md](./README.md).

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Backend Patterns](#3-backend-patterns)
4. [Multi-tenant Security Model](#4-multi-tenant-security-model)
5. [Audit Log — Fire-and-Forget](#5-audit-log--fire-and-forget)
6. [Provider Implementation Guide](#6-provider-implementation-guide)
7. [Frontend (`./react`)](#7-frontend-react)
8. [Testing Strategy](#8-testing-strategy)
9. [Build and Publish](#9-build-and-publish)
10. [Common Pitfalls](#10-common-pitfalls)

---

## 1. Project Overview

A transactional notification library for **NestJS 11**. v0.1 ships **email** and **OTP**
channels. The defining constraint is decoupling: every external boundary — email
transport, OTP store, template renderer, audit sink — is a TypeScript **interface** the
consumer implements or picks from the bundled reference adapters. The library ships
`"dependencies": {}`; NestJS, the email SDK, the Redis client, and React are all peer
dependencies. OTP cryptography uses `node:crypto` exclusively.

`ISmsProvider` and `IPushProvider` are declared for v0.2 but their services are not
implemented; configuring the `sms` / `push` channels is rejected at startup.

## 2. Architecture

### Layered structure

```
src/
├── server/                         layer: api / domain / infra
│   ├── bymax-notification.module.ts   dynamic module — conditional registration
│   ├── services/                      EmailService · OtpService · NotificationService
│   ├── providers/                     Resend · Redis · InMemory · NoOp · DefaultRenderer
│   ├── interfaces/                    IEmailProvider · IOtpStorage · IEmailTemplateRenderer · INotificationLogRepository (+ SMS/Push sketches)
│   ├── interceptors/                  NotificationAuditInterceptor
│   ├── config/                        validate-options · resolve-options (deep-frozen)
│   ├── errors/                        NotificationException + error catalog
│   ├── constants/                     purposes · canonical templates · defaults
│   └── utils/                         hash · code-generator · timing-safe-compare · cooldown-helpers
├── shared/                         zero-dep types + constants (importable anywhere)
└── react/                          useOtpInput · useOtpCountdown (UX/state only)
```

### Conditional provider registration

The dynamic module registers **only the channels you configure**. The synchronous
`forRoot` resolves options eagerly and registers a channel's service only when that
channel is present. The async `forRootAsync` cannot know the configured channels until the
factory runs, so it registers every channel **token** (an absent channel resolves to
`null` via a factory) and registers the channel **service** unconditionally; the service's
`isConfigured()` reflects whether its backing token is present. `NotificationService` is
always registered and injects the channel services with `@Optional()`.

Injection tokens are `Symbol()` (collision-proof, exported for advanced override):
`BYMAX_NOTIFICATION_OPTIONS`, `…_EMAIL_PROVIDER`, `…_OTP_STORAGE`, `…_TEMPLATE_RENDERER`,
`…_LOG_REPOSITORY`, `…_SMS_PROVIDER`, `…_PUSH_PROVIDER`.

### Options validation and resolution

`validateOptions` runs first — it rejects an empty config (no channel), a missing required
field, an out-of-range OTP length, and the `sms` / `push` channels (with an explicit
"planned for v0.2" message). `resolveOptions` then merges consumer values over defaults,
attaches a `resolveForPurpose(purpose)` helper to the OTP section, and **deep-freezes** the
result so nothing mutates it after bootstrap.

## 3. Backend Patterns

### Service method structure

A service method validates input, calls the configured interface(s), maps any thrown
provider error to a `NotificationException`, writes a fire-and-forget audit entry, and
returns a typed result. Codes never appear in a log line or audit entry.

### Error response format

`NotificationException extends HttpException`. The body is always:

```json
{ "error": { "code": "notification.otp_invalid_code", "message": "Invalid OTP code", "details": null } }
```

Consumers match on the stable `code`. The catalog (`NOTIFICATION_ERROR_DEFINITIONS`) maps
each key to a `code`, an HTTP status, and a default English message; `shared` re-exports
the codes (byte-identical) so the frontend can match without importing the server bundle.

### OTP store key patterns (RedisOtpStorage)

```
{namespace}:otp:{purpose}:{sha256(tenantId:recipient)}        # the OTP entry (TTL = ttlSeconds)
{namespace}:cooldown:{purpose}:{sha256(tenantId:recipient)}   # the resend lock (TTL = cooldownSeconds)
```

`namespace` defaults to `notification`. The recipient and tenant never appear in plaintext.

### Atomicity (the core invariant)

- **Attempt counting** — `consumeAttempt` does lookup + increment in **one** indivisible
  step (Redis Lua script; in-memory single synchronous read-modify-write). A service-side
  `get` + `update` races and lets `maxAttempts` be bypassed under concurrency.
- **Resend cooldown** — `tryAcquireCooldown` is `SET … NX EX` (atomic check-and-set), so two
  concurrent generate/resend calls cannot both pass. The lock is released
  (`clearCooldown`) when delivery fails, so a transient provider error does not lock the
  user out for the full cooldown window.

## 4. Multi-tenant Security Model

1. **SHA-256 store keys** — `sha256(tenantId:recipient)`. Privacy (no recipient
   enumeration from `KEYS`) + isolation (cross-tenant collision is preimage-infeasible).
2. **`tenantIdResolver`** — reads the tenant from a trusted source (verified JWT claim,
   subdomain, gateway-checked header). The `NotificationAuditInterceptor` uses it as the
   source of truth, so a `tenantId` forged in the request body cannot operate on another
   tenant's OTPs. Service methods still take an explicit `tenantId` argument — resolve it
   in the controller and pass it down.
3. **Never-log-codes** — codes are never written to any audit entry, console line, or
   `errorMessage`. A regression test asserts
   `JSON.stringify(auditEntry).includes(realCode) === false`. `audit.maskRecipient`
   minimizes recipient PII before persistence.

## 5. Audit Log — Fire-and-Forget

Audit is opt-in via `audit.repository` (any `INotificationLogRepository`). When not
configured, a `NoOpNotificationLogRepository` silently discards entries. By default
(`swallowErrors: true`) a failing audit write is logged at meta-level but **never**
propagated — the audit sink can never crash the notification flow. Set
`swallowErrors: false` to surface audit failures (e.g. when audit is compliance-critical).
The `NotificationAuditInterceptor` captures HTTP-level `sent` / `failed` verbs; the
services themselves record `generated`, `verified`, `cooldown_blocked`, and
`max_attempts_exceeded`.

## 6. Provider Implementation Guide

Implement the interface, then pass an instance (or class) to `forRoot`.

- **`IEmailProvider`** — `send(options): Promise<{ messageId }>`, `isConfigured()`,
  `readonly name`. Throw a plain `Error` on failure; `EmailService` maps it to
  `EMAIL_SEND_FAILED`. Never log the body or leak credentials.
- **`IOtpStorage`** — `set` / `get` / `consumeAttempt` / `update` / `delete` /
  `tryAcquireCooldown` / `getCooldown` / `clearCooldown` / `isConfigured` / `name`.
  `consumeAttempt` and `tryAcquireCooldown` **MUST be atomic** (see §3). Honor TTL — an
  entry past `expiresAt` returns `null` / `not_found`. `update` must not resurrect an
  expired entry (Redis: `SET … KEEPTTL XX`). Never log codes.
- **`IEmailTemplateRenderer`** — `render(name, data, locale)` / `hasTemplate(name, locale)`
  / `name`. Escape variables in HTML contexts.
- **`INotificationLogRepository`** — `create(entry)` / `name`. `errorMessage` is the
  message only — never a stack trace.

Adapter examples (Handlebars, MJML, React Email, Prisma repository) live under
`docs/templates/` and `docs/schemas/` — they are not imported by the library.

### Peer-dependency matrix

| Channel / feature | Peer dep(s)                                 |
| ----------------- | ------------------------------------------- |
| NestJS module     | `@nestjs/common`, `@nestjs/core`, `reflect-metadata`, `rxjs` |
| Resend email      | `resend`                                    |
| Redis OTP store   | `ioredis`                                   |
| React hooks       | `react ^19`                                 |
| `./shared`        | none                                        |

All optional peers are marked `{ "optional": true }` so a consumer pulls in only what it uses.

## 7. Frontend (`./react`)

`useOtpInput` manages N single-character slots (auto-focus, paste distribution, Backspace
clear, Arrow navigation) and exposes `values` / `code` / `isComplete` / handlers / `refs`.
`useOtpCountdown` derives `remainingSeconds` / `expired` / `formatted` (`MM:SS` or
`HH:MM:SS`) from an `expiresAt` epoch. These are **UX/state only** — verifying a code is
the consumer's job (call the backend). No HTTP client, no Node builtins; `react` is an
external peer in the published bundle.

## 8. Testing Strategy

- **100% coverage** (statements / branches / functions / lines) per file, enforced by
  `jest.coverage.config.ts` (`pnpm test:cov:all`). A pre-publish gate, not a target.
- **Mutation testing** (Stryker, `break: 95`) is the deeper gate against weak tests; score
  driven toward 100%, with critical paths (`code-generator`, `timing-safe-compare`, `hash`,
  `redis-otp.storage`, `otp.service`) at 100%. Runs automatically post-merge on `main` via the shared reusable (`bymaxone/.github` → node-lib-ci), never on PRs; plus an optional manual `pnpm mutation`.
- **Mocking** — never real Redis or a real email API in unit tests (`ioredis-mock` and
  in-memory fakes). E2E specs in `test/e2e/` cover tenant isolation and audit behavior.
- **Security gate test** — the never-log-codes invariant is asserted directly against a
  serialized audit entry.

## 9. Build and Publish

- **tsup** builds 3 subpaths → ESM (`.mjs`) + CJS (`.cjs`) + `.d.ts`; `sideEffects: false`;
  peer deps always external. The `.mjs` ships unminified (readable stack traces inside a
  consumer's `node_modules`).
- **Bundle budgets** (`pnpm size`, brotli): server < 30 KB, shared < 4 KB, react < 8 KB.
- **CI** — `ci.yml` runs typecheck · lint · `check:no-prisma` · `test:cov` · `test:e2e` ·
  build · build-output integrity · `size` on every PR. `codeql.yml` and `scorecard.yml`
  run on push + weekly. `release.yml` is **tag-driven only** (`v*.*.*`): it runs
  `prepublishOnly`, the dogfood smoke, then `pnpm publish --provenance` via OIDC.
- **Provenance** — published with npm provenance so consumers can `npm audit signatures`.

## 10. Common Pitfalls

- ❌ Importing `@prisma/client` (or any ORM) anywhere in `src/` — the `check:no-prisma`
  gate fails the build. Persistence is interface-only.
- ❌ A service-side `get` + `update` for attempts or cooldown — non-atomic, bypassable.
- ❌ Logging a code (audit, console, error message) — breaks the never-log-codes invariant.
- ❌ Using the plaintext recipient or tenant in a store key — defeats privacy + isolation.
- ❌ Trusting `tenantId` from the request body — always resolve it from a trusted source.
- ❌ Adding a runtime `dependency` — everything is a peer dep or a `node:` builtin.
- ❌ Adding mutation testing to `prepublishOnly` / per-PR CI — it runs automatically post-merge on `main` via the shared reusable (`bymaxone/.github` → node-lib-ci), never on PRs.
- ❌ A function over 50 lines or a file over 800 — split by responsibility.
