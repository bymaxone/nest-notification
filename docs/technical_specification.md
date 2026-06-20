# @bymax-one/nest-notification — Complete Technical Specification

> **Spec revision:** 1.1.0 (post-audit) — target package version `0.1.0`
> **Last updated:** 2026-06-20
> **Status:** Audited — ready for implementation
> **Type:** Public npm package (`@bymax-one/nest-notification`)

---

## Table of Contents

1. [Vision and Value Proposition](#1-vision-and-value-proposition)
2. [Architecture](#2-architecture)
3. [Package Structure](#3-package-structure)
4. [Configuration API](#4-configuration-api)
5. [Provider Contracts](#5-provider-contracts)
6. [Services](#6-services)
7. [Multi-tenant](#7-multi-tenant)
8. [Rate Limiting (Resend Cooldown)](#8-rate-limiting-resend-cooldown)
9. [Templating](#9-templating)
10. [Redis Strategy](#10-redis-strategy)
11. [Error Codes Catalog](#11-error-codes-catalog)
12. [What Is NOT In the Package](#12-what-is-not-in-the-package)
13. [Dependencies](#13-dependencies)
14. [Implementation Phases](#14-implementation-phases)
15. [Known Limitations](#15-known-limitations)
16. [Frontend Integration](#16-frontend-integration)
17. [Integrated Example: Complete Registration + OTP Flow](#17-integrated-example-complete-registration--otp-flow)

---

## 1. Vision and Value Proposition

### 1.1 What is `@bymax-one/nest-notification`

`@bymax-one/nest-notification` is a **multi-channel** and **multi-tenant** npm library for sending notifications from NestJS applications. It encapsulates four distinct channels behind strict TypeScript interfaces — email, OTP, SMS, and push — and allows each channel to be plugged into any external provider (Resend, SendGrid, AWS SES, Mailgun, NodeMailer, Twilio, AWS SNS, FCM, APN, Web Push), as well as any storage (Redis, DynamoDB, Memcached, in-memory for dev).

The library generalizes the hand-rolled notification module a typical NestJS app ships, with three critical architectural corrections:

1. **Zero Prisma coupling** — a hand-rolled email-verification service typically imports a Prisma client directly. In this lib, **all OTP storage goes behind the `IOtpStorage` interface** (default `RedisOtpStorage`), and email verification becomes **a use case of the OTP channel**, not a service coupled to the user schema.
2. **Pluggable templates** — hand-rolled email services tend to hardcode branded HTML. In this lib, **rendering goes through `IEmailTemplateRenderer`** (default: simple interpolation; consumers can plug in Handlebars/MJML/React Email).
3. **Injectable email provider** — the original imported `resend` as a direct dependency. In the new lib, **Resend is just the default reference `IEmailProvider`**; the consumer chooses.

### 1.2 Why it exists

In a multi-tenant SaaS architecture, all applications need to send:

- OTP codes (email verification, password reset, out-of-band MFA, magic link)
- Transactional emails (welcome, invoice, password recovery, alerts)
- SMS notifications (2FA, critical alerts)
- Push notifications (mobile, web)

Rewriting this pipeline in each service is wasteful; and each rewrite tends to forget critical details: OTP rate limiting (resend anti-spam), attempt tracking (anti brute-force), correct TTL, tenant scoping, audit logging, fallback to different providers during disaster.

`@bymax-one/nest-notification` centralizes these patterns in a single auditable package.

### 1.3 Who uses it

- **NestJS backends** that need to send transactional emails, OTPs, or SMS/push notifications
- **`@bymax-one/nest-auth`** consumes this lib via the email/OTP channel — registering it as `IEmailProvider` in the auth config
- **Multi-tenant applications** that need to isolate rate limit counters and audit logs per tenant
- **Applications that want to switch providers** (e.g., migrate from Resend to SES) without rewriting business code

### 1.4 Distribution model

| Aspect | Detail |
|---|---|
| Registry | public npm (`@bymax-one/nest-notification`) |
| Cost | Zero — open source |
| License | MIT |
| Runtime | Node.js 24+ |
| Framework | NestJS 11+ (server); React 19+ (subpath `./react`, optional) |
| Subpaths | `.` (server), `./shared` (types/constants), `./react` (`useOtpInput` hook) |

### 1.5 Design principles

1. **Channel abstraction** — each channel (email, OTP, SMS, push) has its own `IXxxProvider` or `IXxxStorage` interface. Adding a new channel does not affect existing ones.
2. **Zero opinion on persistence** — all persistence (OTP, audit log) goes through TypeScript interfaces. The lib never imports Prisma, TypeORM, Drizzle, ioredis (directly), or Mongoose.
3. **Zero opinion on providers** — Resend, Twilio, FCM, etc. are reference adapters. The lib does not have `resend`/`twilio`/`firebase-admin` as a direct dependency — everything is an optional peer dep, provided by the consumer.
4. **Configuration over convention** — everything configurable via `forRoot()`/`forRootAsync()`. Sensible defaults where applicable (e.g., 6-digit OTP, 10-minute TTL, 60s cooldown).
5. **Opt-in features** — only configured channels are registered as providers in the NestJS container. Enabling SMS without configuring `ISmsProvider` is an initialization error.
6. **Native multi-tenant** — every operation accepts `tenantId` and scopes rate limits, logs, and counters per tenant. No tenant can read or interfere with another tenant's OTPs, cooldowns, or logs.
7. **Pluggable templating** — email rendering is also an interface. Default is simple string interpolation; consumers can plug in Handlebars/MJML/React Email without forking.
8. **Auditable by default** — `INotificationLogRepository` (optional) allows recording each delivery for compliance/audit.
9. **Security by default** — OTP codes generated via `crypto.randomInt`; never log plaintext OTP codes; mandatory rate limit on resend.

### 1.6 Module categorization

The library organizes its functionality into four categories with distinct activation levels:

#### Core (always active)

| Module | Responsibility |
|---|---|
| `NotificationService` | Orchestrator — receives generic requests and dispatches to the correct channel |
| `NotificationRedisService` | Redis wrapper for cooldown and rate limit keys (if `Redis` configured) |
| Base configuration | Option validation, default resolution |

#### Channels (opt-in by configuration)

| Channel | Activation | Responsibility |
|---|---|---|
| **Email** | `email: { provider: ... }` | `EmailService` + `IEmailProvider` |
| **OTP** | `otp: { storage: ... }` | `OtpService` + `IOtpStorage` + (optional) `IEmailProvider` for delivery |
| **SMS** | `sms: { provider: ... }` (v0.2) | `SmsService` + `ISmsProvider` |
| **Push** | `push: { provider: ... }` (v0.2) | `PushService` + `IPushProvider` |

#### Persistence (opt-in by configuration)

| Module | Activation | Responsibility |
|---|---|---|
| Audit log | `audit: { repository: ... }` | Persists every send to `INotificationLogRepository` |

#### Templating (opt-in by configuration)

| Module | Activation | Responsibility |
|---|---|---|
| Template renderer | `email.templateRenderer: ...` | Renders HTML/text via `IEmailTemplateRenderer` |

When a channel is not configured, its services are **not registered** in the NestJS container — zero overhead, zero unnecessary peer deps.

### 1.7 MVP (v0.1) vs Deferred (v0.2+)

| Channel/Feature | v0.1 (MVP) | v0.2 | Justification |
|---|---|---|---|
| Email channel + `IEmailProvider` | Yes | — | Needed for integration with `@bymax-one/nest-auth` |
| OTP channel + `IOtpStorage` | Yes | — | Needed for email verification and password reset |
| Default `RedisOtpStorage` | Yes | — | Multi-instance ready |
| `InMemoryOtpStorage` (dev) | Yes | — | Useful for tests and local dev without Redis |
| `ResendProvider` (reference) | Yes | — | Demonstrates the pattern with a popular provider |
| Resend cooldown (60s) | Yes | — | Essential anti-brute-force |
| `IEmailTemplateRenderer` + default | Yes | — | Replaces hardcoded HTML in the consumer |
| Notification audit log | Yes | — | Needed in production from day 1 |
| Multi-tenant scoping | Yes | — | Without this the lib does not serve SaaS |
| `./react` `useOtpInput` hook | Yes | — | Complete OTP UX is essential |
| **SMS channel + `ISmsProvider`** | — | Yes | No use case today (v0.1 delivers OTP by email only) |
| **Push channel + `IPushProvider`** | — | Yes | No push-notification use case in v0.1 |
| Multi-provider fallback (e.g., SES → SendGrid on disaster) | — | Yes (v0.3) | High complexity; "nice to have" feature |
| In-app inbox / preferences UI | Never | — | This is an application feature, not a lib feature |

**v0.1 end scope:** Email (1 channel) + OTP (1 channel) + Audit log + Templating + Multi-tenant + React hook. Everything a consumer needs to replace a hand-rolled notification module.

**Behavior to account for when migrating off a hand-rolled module:**
- **Resend cooldown** — the FE "resend" button must handle `OTP_COOLDOWN_ACTIVE` (429 + `remainingSeconds`).
- **Recipient normalization** — this lib does not lowercase, so the host must pass `email.trim().toLowerCase()` as `recipient`.
- **Stricter errors** — a missing email provider throws `EMAIL_PROVIDER_NOT_CONFIGURED` instead of silently logging and returning (use `NoOpEmailProvider` in dev).

---

## 2. Architecture

### 2.1 NestJS Dynamic Module pattern

`@bymax-one/nest-notification` uses the NestJS Dynamic Module pattern. It is not a separate service — it runs **inside each consumer application** as an imported module:

```
┌─────────────────────────────────────────────────────────┐
│                Host Application (NestJS)                 │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │      @bymax-one/nest-notification module           │ │
│  │                                                    │ │
│  │  NotificationService (orchestrator)                │ │
│  │       ↓                                            │ │
│  │  ┌────────────┬────────────┬────────────┐          │ │
│  │  │EmailService│ OtpService │ SmsService │ ...      │ │
│  │  └─────┬──────┴─────┬──────┴─────┬──────┘          │ │
│  │        ↓            ↓            ↓                 │ │
│  └────────┼────────────┼────────────┼────────────────┘ │
│           │            │            │                   │
│   ┌───────▼────┐  ┌────▼─────┐ ┌────▼─────┐             │
│   │ IEmail     │  │ IOtp     │ │ ISms     │             │
│   │ Provider   │  │ Storage  │ │ Provider │             │
│   │ (Resend)   │  │ (Redis)  │ │ (Twilio) │             │
│   └────────────┘  └──────────┘ └──────────┘             │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Initialization flow

1. Host application calls `BymaxNotificationModule.forRootAsync({ ... })`
2. The module resolves options via `ConfigService` or factory
3. For each configured channel, validates that the provider/storage is present
4. Registers only the services for the enabled channels
5. If `audit.repository` is configured, registers `NotificationAuditInterceptor`
6. Module ready to receive calls

### 2.3 OTP send flow

```
HostApp (controller)
    │
    ▼
otpService.generate({ tenantId, recipient, purpose, deliverVia, emailTemplate, emailData, locale })
    │
    ├─ 1. Atomically claims the cooldown slot:
    │       storage.tryAcquireCooldown(tenantId, recipient, purpose, cooldownSeconds) → boolean
    │     Implemented as a single `SET key '1' NX EX <cooldown>`. Returns false if a cooldown is
    │     already active. If false → throws NotificationException OTP_COOLDOWN_ACTIVE { remainingSeconds }.
    │     The NX makes check-and-set one indivisible step, so two concurrent generate/resend calls
    │     cannot both pass and both reset the attempt counter (see §8.2).
    │
    ├─ 2. Generates code via the crypto-secure generator (see §6.2.1 — built digit-by-digit, so
    │     numeric codes do NOT overflow `randomInt`/`Number` for long lengths).
    │
    ├─ 3. storage.set(tenantId, recipient, purpose, { code, attempts: 0, maxAttempts, expiresAt })
    │     Overwrites any previous entry (resetting attempts) — this is exactly why step 1 gates it.
    │
    ├─ 4. If deliverVia === 'email':
    │       Requires EmailService to be configured, else throws OTP_EMAIL_DELIVERY_NOT_CONFIGURED.
    │       emailService.sendTemplate({ tenantId, to: recipient, template: emailTemplate ?? 'otp_code',
    │                                   data: { code, expiresInMinutes, purpose, ...emailData },
    │                                   locale, userId })
    │       On delivery failure → storage.clearCooldown(...) + storage.delete(...), audit 'failed',
    │       then rethrow. The cooldown is released so a failed send never locks the user out, and the
    │       orphan OTP is removed so the next attempt starts clean.
    │
    ├─ 5. (optional) auditLog.create({ channel: 'otp', verb: 'generated', tenantId, recipient, purpose })
    │       + (if delivered) auditLog.create({ channel: 'email', verb: 'sent', ... })
    │
    ▼
Returns { expiresAt: number, cooldownSeconds: number }
```

> **Why claim the cooldown first (and release on failure) instead of writing it last?** Setting the
> cooldown *after* a successful send (the obvious order) leaves a race window where two concurrent
> requests both generate and both reset `attempts`. Claiming it up front with `NX` turns the cooldown
> key into a lightweight lock; releasing it on delivery failure preserves the "a bounced email must
> not lock me out for 60s" UX. `deliverVia: 'manual'` skips step 4 entirely and the cooldown stays.

### 2.4 OTP verification flow

```
otpService.verify({ tenantId, recipient, purpose, code })
    │
    ├─ 1. result = storage.consumeAttempt(tenantId, recipient, purpose)
    │     ATOMIC — a single Redis Lua script (or a single synchronous Map op for InMemory). In one
    │     indivisible step it looks up the entry and either rejects or increments `attempts` by one:
    │       • { status: 'not_found' }      → entry missing or TTL-expired
    │       • { status: 'max_attempts' }   → attempts already == maxAttempts (entry deleted)
    │       • { status: 'ok', entry }      → attempts incremented by exactly 1, updated entry returned
    │     Folding the read-modify-write into the storage layer is what makes the maxAttempts limit
    │     hold under concurrency. A plain get()+update() in the service would race (see §5.2, §10.4).
    │
    ├─ 2. status 'not_found'    → returns { valid: false, reason: 'not_found' }
    │     status 'max_attempts' → returns { valid: false, reason: 'max_attempts' }
    │
    ├─ 3. Constant-time compare: safeCompare(entry.code, code)  (see §6.2.2)
    │     safeCompare returns false (never throws) when the lengths differ — crypto.timingSafeEqual
    │     itself throws RangeError on unequal-length buffers, so the wrapper length-checks first.
    │     If not equal → returns { valid: false, reason: 'invalid_code',
    │                              remainingAttempts: entry.maxAttempts - entry.attempts }
    │
    ├─ 4. Success:
    │       • default            → mark entry.validated = true via storage.update(...) (no delete)
    │       • consumeOnVerify    → storage.delete(...) + storage.clearCooldown(...)
    │
    ├─ 5. (optional) auditLog.create({ channel: 'otp', verb: 'verified', ... })
    │
    ▼
Returns { valid: true }
```

> **Why not delete immediately?** In password reset flows, the client needs to verify the OTP once (display "valid code — set new password" UI) and then explicitly consume via `otpService.consume(...)`. Separating `verify` and `consume` enables two-step UX. In simple flows (e.g., one-click email verification), set `otp.consumeOnVerify: true` or call `consume` after `verify`.
>
> **Replay caveat (two-step mode):** while `validated: true` and the entry still lives, repeating `verify` with the correct code keeps returning `{ valid: true }` until `consume()` or TTL. Consumers MUST call `consume()` immediately after the dependent operation (e.g., right after the password is changed). For one-shot flows prefer `consumeOnVerify: true`.

### 2.5 Transactional email send flow

```
HostApp (any service)
    │
    ▼
emailService.send({ tenantId, to, template, data, locale })
    │
    ├─ 1. (optional) templateRenderer.render(template, data, locale) → { subject, html, text }
    │     If no renderer is configured, the caller must already pass { subject, html, text } directly
    │
    ├─ 2. emailProvider.send({ to, subject, html, text, tags, replyTo, cc, bcc })
    │     Throws NotificationException EMAIL_SEND_FAILED on provider failure
    │
    ├─ 3. (optional) auditLog.create({ channel: 'email', tenantId, recipient: to, status: 'sent', tags })
    │
    ▼
Returns void
```

### 2.6 Audit flow

When `audit: { repository: ... }` is configured, **every successful call and every failure** is recorded via `auditLogRepository.create()`. The repository is at the consumer's discretion — Prisma, TypeORM, Drizzle, Mongo, ClickHouse, BigQuery: any one, as long as it implements `INotificationLogRepository`.

---

## 3. Package Structure

### 3.1 Complete directory tree

The library is organized into 3 subpaths with distinct responsibilities:

```
@bymax-one/nest-notification/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── tsconfig.server.json
├── tsup.config.ts
├── src/
│   ├── server/                                # Main NestJS entry
│   │   ├── index.ts                           # Barrel export (server)
│   │   ├── bymax-notification.module.ts       # Root dynamic module
│   │   ├── bymax-notification.constants.ts    # Injection tokens
│   │   ├── interfaces/
│   │   │   ├── notification-module-options.interface.ts
│   │   │   ├── email-provider.interface.ts
│   │   │   ├── otp-storage.interface.ts
│   │   │   ├── push-provider.interface.ts            # v0.2
│   │   │   ├── sms-provider.interface.ts             # v0.2
│   │   │   ├── email-template-renderer.interface.ts
│   │   │   ├── notification-log-repository.interface.ts
│   │   │   └── index.ts
│   │   ├── config/
│   │   │   ├── default-options.ts
│   │   │   └── resolved-options.ts
│   │   ├── services/
│   │   │   ├── notification.service.ts        # Orchestrator
│   │   │   ├── email.service.ts
│   │   │   ├── otp.service.ts
│   │   │   ├── sms.service.ts                 # v0.2
│   │   │   └── push.service.ts                # v0.2
│   │   ├── providers/                          # Reference providers (default)
│   │   │   ├── resend-email.provider.ts       # Resend adapter (reference)
│   │   │   ├── no-op-email.provider.ts        # For dev/test
│   │   │   ├── redis-otp.storage.ts           # Default Redis storage
│   │   │   ├── in-memory-otp.storage.ts       # In-memory storage (dev/test)
│   │   │   ├── default-template-renderer.ts   # Simple interpolation
│   │   │   └── no-op-notification-log.repository.ts
│   │   ├── interceptors/
│   │   │   └── notification-audit.interceptor.ts
│   │   ├── constants/
│   │   │   ├── error-codes.ts
│   │   │   ├── notification-purposes.ts
│   │   │   └── default-templates.ts           # Default templates (optional)
│   │   ├── errors/
│   │   │   ├── notification-error-codes.ts
│   │   │   └── notification-exception.ts
│   │   ├── utils/
│   │   │   ├── code-generator.ts              # randomInt-based, supports alpha/numeric/alphanumeric
│   │   │   ├── hash.ts                        # sha256 wrapper
│   │   │   └── timing-safe-compare.ts         # crypto.timingSafeEqual wrapper
│   │   └── dto/                                # In case the consumer wants ready-made controllers
│   │       ├── send-email.dto.ts
│   │       ├── generate-otp.dto.ts
│   │       └── verify-otp.dto.ts
│   │
│   ├── shared/                                 # Zero-dep types + constants
│   │   ├── index.ts
│   │   ├── types/
│   │   │   ├── otp-purpose.types.ts
│   │   │   ├── notification-channel.types.ts
│   │   │   └── notification-error.types.ts
│   │   └── constants/
│   │       ├── error-codes.ts
│   │       └── default-ttls.ts
│   │
│   └── react/                                  # Hook for OTP input
│       ├── index.ts
│       ├── useOtpInput.ts                      # Complete input state
│       ├── useOtpCountdown.ts                  # Countdown timer
│       └── types.ts
│
├── test/                                       # e2e tests
├── docs/
│   ├── technical_specification.md              # This file
│   ├── development_plan.md                     # Phased roadmap
│   ├── tasks/                                  # Task breakdown — one file per phase (phase-01..07-*.md)
│   ├── schemas/
│   │   └── notification-log.prisma             # Prisma fragment (reference)
│   └── templates/                              # Canonical template examples (HTML/MJML, reference only)
├── .github/workflows/
│   ├── ci.yml
│   ├── codeql.yml
│   ├── release.yml
│   └── scorecard.yml
├── scripts/
│   └── check-size.mjs
├── eslint.config.mjs
├── .prettierrc
├── .gitignore
├── jest.config.ts
├── jest.coverage.config.ts
├── jest.e2e.config.ts
├── jest.stryker.config.ts
├── stryker.config.json
├── AGENTS.md
├── CLAUDE.md
├── CHANGELOG.md
├── LICENSE
├── README.md
└── SECURITY.md
```

**Dependency graph between subpaths:**

```
   shared (zero deps — types + constants)
      ↑
   server (depends on shared)
   react (depends on shared, peerDep: react)
```

### 3.2 Subpath exports

The lib uses `exports` in `package.json` to expose 3 entry points with automatic tree-shaking:

| Subpath | Entry point | Description | Dependencies |
|---|---|---|---|
| `.` (server) | `dist/server/index.mjs` | NestJS module, services, providers, interfaces | NestJS 11, ioredis (optional) |
| `./shared` | `dist/shared/index.mjs` | Types, constants, error codes | Zero |
| `./react` | `dist/react/index.mjs` | Hook `useOtpInput`, `useOtpCountdown` | react ^19 |

```json
{
  "exports": {
    ".": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.mjs",
      "require": "./dist/server/index.cjs"
    },
    "./shared": {
      "types": "./dist/shared/index.d.ts",
      "import": "./dist/shared/index.mjs",
      "require": "./dist/shared/index.cjs"
    },
    "./react": {
      "types": "./dist/react/index.d.ts",
      "import": "./dist/react/index.mjs",
      "require": "./dist/react/index.cjs"
    }
  }
}
```

### 3.3 Exports per subpath

**Server (`@bymax-one/nest-notification`):**

```typescript
// Main module
export { BymaxNotificationModule } from './bymax-notification.module'

// Injection constants
export {
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_EMAIL_PROVIDER,
  BYMAX_NOTIFICATION_OTP_STORAGE,
  BYMAX_NOTIFICATION_SMS_PROVIDER,
  BYMAX_NOTIFICATION_PUSH_PROVIDER,
  BYMAX_NOTIFICATION_TEMPLATE_RENDERER,
  BYMAX_NOTIFICATION_LOG_REPOSITORY,
} from './bymax-notification.constants'

// Interfaces (types)
export type {
  BymaxNotificationModuleOptions,
  IEmailProvider,
  IOtpStorage,
  ISmsProvider,
  IPushProvider,
  IEmailTemplateRenderer,
  INotificationLogRepository,
  EmailSendOptions,
  OtpEntry,
  OtpVerifyResult,
  OtpGenerateOptions,
  OtpVerifyOptions,
  SmsSendOptions,
  PushSendOptions,
  RenderedEmail,
  NotificationLogEntry,
} from './interfaces'

// Services (public API)
export { NotificationService } from './services/notification.service'
export { EmailService } from './services/email.service'
export { OtpService } from './services/otp.service'

// Reference providers (consumer can use or extend)
export { ResendEmailProvider } from './providers/resend-email.provider'
export { NoOpEmailProvider } from './providers/no-op-email.provider'
export { RedisOtpStorage } from './providers/redis-otp.storage'
export { InMemoryOtpStorage } from './providers/in-memory-otp.storage'
export { DefaultTemplateRenderer } from './providers/default-template-renderer'
export { NoOpNotificationLogRepository } from './providers/no-op-notification-log.repository'

// Errors & Exception
export {
  NotificationException,
  NOTIFICATION_ERROR_CODES,
} from './errors'

// Public constants
export { NOTIFICATION_PURPOSES } from './constants/notification-purposes'
```

**Shared (`@bymax-one/nest-notification/shared`):**

```typescript
// Types (zero deps)
export type {
  OtpPurpose,
  NotificationChannel,
  NotificationErrorResponse,
} from './types'

// Constants
export { NOTIFICATION_ERROR_CODES } from './constants/error-codes'
export { DEFAULT_TTLS } from './constants/default-ttls'
```

**React (`@bymax-one/nest-notification/react`):**

```typescript
export { useOtpInput } from './useOtpInput'
export { useOtpCountdown } from './useOtpCountdown'
export type { UseOtpInputOptions, UseOtpInputState, UseOtpCountdownOptions, UseOtpCountdownState } from './types'
```

> **Public vs internal API:** Only the symbols above are exported for direct use by the consumer application. Internal implementations (interceptors, crypto utils, dto) are considered internal and may change between patch versions.

---

## 4. Configuration API

### 4.1 `BymaxNotificationModuleOptions` interface

This is the main interface that controls all module behavior. The host application provides these options when registering the module.

```typescript
export interface BymaxNotificationModuleOptions {
  /**
   * Global library configuration.
   * Applies to all channels unless overridden specifically.
   */
  global?: {
    /**
     * Namespace for Redis keys. Default: 'notification'
     * All keys will be prefixed with this namespace.
     */
    redisNamespace?: string

    /**
     * Default locale for templates when the caller does not specify.
     * Default: 'en'
     */
    defaultLocale?: string

    /**
     * Optional function to resolve the tenantId from a `Request`.
     * When provided, the module prefers this source over the tenantId
     * passed in the body/argument — prevents tenant spoofing.
     *
     * Examples:
     * - By subdomain: (req) => req.hostname?.split('.')[0] ?? 'default'
     * - By header: (req) => req.headers['x-tenant-id'] as string
     */
    tenantIdResolver?: (req: NotificationRequest) => string | Promise<string>
  }

  /**
   * Email channel configuration.
   * If omitted, EmailService is not registered.
   */
  email?: {
    /**
     * Email send provider — IEmailProvider implementation.
     * REQUIRED if `email` is present.
     */
    provider: IEmailProvider | (new (...args: unknown[]) => IEmailProvider)

    /**
     * Default "from" address (e.g., 'noreply@example.com').
     * REQUIRED.
     */
    defaultFrom: string

    /**
     * Default sender name (e.g., 'My App').
     * Recommended. Default: derived from defaultFrom.
     */
    defaultFromName?: string

    /**
     * Template renderer. Default: DefaultTemplateRenderer
     * ({{var}} string interpolation). Consumer can plug in
     * Handlebars/MJML/React Email by implementing IEmailTemplateRenderer.
     */
    templateRenderer?: IEmailTemplateRenderer | (new (...args: unknown[]) => IEmailTemplateRenderer)

    /**
     * Default reply-to address. Optional.
     */
    defaultReplyTo?: string

    /**
     * Default tags attached to all emails (for tracking/analytics
     * on the provider). Optional.
     */
    defaultTags?: Array<{ name: string; value: string }>

    /**
     * Maximum total attachment size in bytes. EmailService sums attachment byte lengths before
     * calling the provider and throws EMAIL_ATTACHMENTS_TOO_LARGE if exceeded.
     * Default: 10_485_760 (10 MiB) — a safe floor below most providers' hard limits.
     */
    maxAttachmentBytes?: number
  }

  /**
   * OTP channel configuration.
   * If omitted, OtpService is not registered.
   */
  otp?: {
    /**
     * Storage backend for OTP — IOtpStorage implementation.
     * REQUIRED if `otp` is present. Recommended default: RedisOtpStorage.
     */
    storage: IOtpStorage | (new (...args: unknown[]) => IOtpStorage)

    /**
     * Default OTP code length. Default: 6
     */
    defaultLength?: number

    /**
     * Default code type. Default: 'numeric'
     * - 'numeric': digits 0-9
     * - 'alpha': uppercase letters A-Z
     * - 'alphanumeric': digits + uppercase letters (excludes 0/O and 1/I for legibility)
     */
    defaultCodeType?: 'numeric' | 'alpha' | 'alphanumeric'

    /**
     * Default OTP TTL in seconds. Default: 600 (10 min)
     */
    defaultTtlSeconds?: number

    /**
     * Maximum verification attempts before invalidating.
     * Default: 5
     */
    defaultMaxAttempts?: number

    /**
     * Cooldown time between resends of the same OTP (same
     * tenantId + recipient + purpose).
     * Default: 60 seconds.
     */
    resendCooldownSeconds?: number

    /**
     * When true, `OtpService.verify()` automatically consumes
     * (deletes) the OTP after a successful verification.
     * Default: false (caller calls `consume()` explicitly).
     */
    consumeOnVerify?: boolean

    /**
     * Per-purpose configurations. Each purpose can override
     * the global defaults (length, codeType, ttlSeconds, maxAttempts,
     * resendCooldownSeconds).
     *
     * Example:
     * ```ts
     * perPurpose: {
     *   email_verification: { ttlSeconds: 3600 }, // 1 hour
     *   password_reset: { ttlSeconds: 600 },      // 10 min
     *   mfa_oob: { length: 8, ttlSeconds: 300 },  // 5 min, longer code
     * }
     * ```
     */
    perPurpose?: Record<string, Partial<OtpPurposeConfig>>
  }

  /**
   * SMS channel configuration (v0.2).
   * If omitted, SmsService is not registered.
   */
  sms?: {
    provider: ISmsProvider | (new (...args: unknown[]) => ISmsProvider)
    defaultFrom?: string                              // E.164 or alphanumeric sender ID
    resendCooldownSeconds?: number                    // Default: 60
  }

  /**
   * Push channel configuration (v0.2).
   * If omitted, PushService is not registered.
   */
  push?: {
    provider: IPushProvider | (new (...args: unknown[]) => IPushProvider)
    defaultTtlSeconds?: number                        // Default: 86400 (24h)
  }

  /**
   * Audit log configuration.
   * If omitted, no audit log is persisted.
   */
  audit?: {
    /**
     * Log repository — INotificationLogRepository implementation.
     * REQUIRED if `audit` is present.
     */
    repository: INotificationLogRepository | (new (...args: unknown[]) => INotificationLogRepository)

    /**
     * If true, audit log failures do NOT propagate error to the caller.
     * Default: true (audit log is fire-and-forget).
     */
    swallowErrors?: boolean

    /**
     * Transforms the recipient before it is written to NotificationLogEntry.recipient — for PII
     * minimization (e.g. 'jane@acme.com' -> 'j***@acme.com'). When `to` is an array, the mask is
     * applied to each element and the results are joined with ', '.
     * Default: identity (recipient stored verbatim). Provide a masker to comply with privacy policy.
     */
    maskRecipient?: (recipient: string) => string
  }
}

/**
 * Configuration of a specific OTP purpose.
 */
export interface OtpPurposeConfig {
  length: number
  codeType: 'numeric' | 'alpha' | 'alphanumeric'
  ttlSeconds: number
  maxAttempts: number
  resendCooldownSeconds: number
}

/**
 * Minimal, framework-agnostic request shape used by `global.tenantIdResolver`.
 * Compatible with both Express and Fastify request objects (both expose `headers`; `hostname`
 * is present on Express and on Fastify >= 4). Cast to your framework's type inside the resolver.
 */
export interface NotificationRequest {
  headers: Record<string, string | string[] | undefined>
  hostname?: string
}
```

### 4.2 Options table with defaults

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `global.redisNamespace` | `string` | No | `'notification'` | Redis key prefix |
| `global.defaultLocale` | `string` | No | `'en'` | Default locale for templates |
| `global.tenantIdResolver` | `function` | No | `undefined` | tenantId resolver from Request |
| `email.provider` | `IEmailProvider` | Yes (if `email` defined) | — | Email send adapter |
| `email.defaultFrom` | `string` | Yes (if `email` defined) | — | Default from address |
| `email.defaultFromName` | `string` | No | derived | Sender name |
| `email.templateRenderer` | `IEmailTemplateRenderer` | No | `DefaultTemplateRenderer` | Template renderer |
| `email.defaultReplyTo` | `string` | No | `undefined` | Default reply-to |
| `email.defaultTags` | `Array<{...}>` | No | `[]` | Default tags |
| `email.maxAttachmentBytes` | `number` | No | `10485760` | Max total attachment size (10 MiB) |
| `otp.storage` | `IOtpStorage` | Yes (if `otp` defined) | — | Storage backend |
| `otp.defaultLength` | `number` | No | `6` | Default code length |
| `otp.defaultCodeType` | `'numeric' \| 'alpha' \| 'alphanumeric'` | No | `'numeric'` | Code type |
| `otp.defaultTtlSeconds` | `number` | No | `600` | OTP TTL (10 min) |
| `otp.defaultMaxAttempts` | `number` | No | `5` | Maximum attempts |
| `otp.resendCooldownSeconds` | `number` | No | `60` | Cooldown between resends |
| `otp.consumeOnVerify` | `boolean` | No | `false` | Auto-consumes OTP on verify |
| `otp.perPurpose` | `Record<...>` | No | `{}` | Overrides per purpose |
| `sms.provider` | `ISmsProvider` | v0.2 | — | SMS adapter |
| `push.provider` | `IPushProvider` | v0.2 | — | Push adapter |
| `audit.repository` | `INotificationLogRepository` | Yes (if `audit` defined) | — | Log repository |
| `audit.swallowErrors` | `boolean` | No | `true` | Does not propagate audit errors |
| `audit.maskRecipient` | `(s: string) => string` | No | identity | Masks recipient before audit write (PII) |

### 4.3 Registration example with `forRootAsync`

```typescript
// app.module.ts
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import {
  BymaxNotificationModule,
  BYMAX_NOTIFICATION_EMAIL_PROVIDER,
  BYMAX_NOTIFICATION_OTP_STORAGE,
  BYMAX_NOTIFICATION_LOG_REPOSITORY,
  ResendEmailProvider,
  RedisOtpStorage,
} from '@bymax-one/nest-notification'

import { PrismaNotificationLogRepository } from './notification/prisma-notification-log.repository'
import { RedisService } from './redis/redis.service'

@Module({
  imports: [
    ConfigModule.forRoot(),

    BymaxNotificationModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) => ({
        global: {
          redisNamespace: 'notification',
          defaultLocale: 'pt-BR',
          tenantIdResolver: (req) => req.headers['x-tenant-id'] as string,
        },
        email: {
          provider: new ResendEmailProvider({
            apiKey: config.getOrThrow('RESEND_API_KEY'),
          }),
          defaultFrom: config.getOrThrow('EMAIL_FROM'),
          defaultFromName: 'My SaaS App',
          defaultReplyTo: 'support@example.com',
          defaultTags: [{ name: 'env', value: config.get('NODE_ENV', 'dev') }],
        },
        otp: {
          storage: new RedisOtpStorage({
            redisClient: redis.getClient(),
            namespace: 'notification',
          }),
          defaultLength: 6,
          defaultCodeType: 'numeric',
          defaultTtlSeconds: 600,
          defaultMaxAttempts: 5,
          resendCooldownSeconds: 60,
          perPurpose: {
            email_verification: { ttlSeconds: 3600 },  // 1 hour
            password_reset: { ttlSeconds: 600 },       // 10 min
            mfa_oob: { length: 8, ttlSeconds: 300 },   // 5 min
          },
        },
        audit: {
          repository: new PrismaNotificationLogRepository(),
          swallowErrors: true,
        },
      }),
    }),
  ],
})
export class AppModule {}
```

### 4.4 Injection tokens

```typescript
// bymax-notification.constants.ts

/** Token for resolved module options */
export const BYMAX_NOTIFICATION_OPTIONS = Symbol('BYMAX_NOTIFICATION_OPTIONS')

/** Token for email provider — registered if email.provider defined */
export const BYMAX_NOTIFICATION_EMAIL_PROVIDER = Symbol('BYMAX_NOTIFICATION_EMAIL_PROVIDER')

/** Token for OTP storage — registered if otp.storage defined */
export const BYMAX_NOTIFICATION_OTP_STORAGE = Symbol('BYMAX_NOTIFICATION_OTP_STORAGE')

/** Token for SMS provider (v0.2) */
export const BYMAX_NOTIFICATION_SMS_PROVIDER = Symbol('BYMAX_NOTIFICATION_SMS_PROVIDER')

/** Token for Push provider (v0.2) */
export const BYMAX_NOTIFICATION_PUSH_PROVIDER = Symbol('BYMAX_NOTIFICATION_PUSH_PROVIDER')

/** Token for template renderer — always registered when email enabled */
export const BYMAX_NOTIFICATION_TEMPLATE_RENDERER = Symbol('BYMAX_NOTIFICATION_TEMPLATE_RENDERER')

/** Token for audit log repository — registered if audit.repository defined */
export const BYMAX_NOTIFICATION_LOG_REPOSITORY = Symbol('BYMAX_NOTIFICATION_LOG_REPOSITORY')
```

**Summary of mandatory vs optional providers:**

| Token | Interface | Required | Description |
|---|---|---|---|
| `BYMAX_NOTIFICATION_EMAIL_PROVIDER` | `IEmailProvider` | Yes (if email channel enabled) | Email send adapter |
| `BYMAX_NOTIFICATION_OTP_STORAGE` | `IOtpStorage` | Yes (if OTP channel enabled) | Storage for OTPs |
| `BYMAX_NOTIFICATION_SMS_PROVIDER` | `ISmsProvider` | v0.2 | SMS adapter |
| `BYMAX_NOTIFICATION_PUSH_PROVIDER` | `IPushProvider` | v0.2 | Push adapter |
| `BYMAX_NOTIFICATION_TEMPLATE_RENDERER` | `IEmailTemplateRenderer` | No (default provided) | Template renderer |
| `BYMAX_NOTIFICATION_LOG_REPOSITORY` | `INotificationLogRepository` | No | Audit log |

### 4.5 Resolved options (`ResolvedNotificationOptions`)

`forRoot()` / `forRootAsync()` merge the user-supplied `BymaxNotificationModuleOptions` with the
defaults from §4.2 and publish the result under the `BYMAX_NOTIFICATION_OPTIONS` token — this is the
value every service injects (`@Inject(BYMAX_NOTIFICATION_OPTIONS)`). It is the *resolved* shape:
every default applied, every channel either present-and-complete or absent.

```typescript
export interface ResolvedNotificationOptions {
  global: {
    redisNamespace: string
    defaultLocale: string
    tenantIdResolver?: (req: NotificationRequest) => string | Promise<string>
  }
  email?: {
    defaultFrom: string
    defaultFromName?: string
    defaultReplyTo?: string
    defaultTags: Array<{ name: string; value: string }>
    maxAttachmentBytes: number
  }
  otp?: {
    defaultLength: number
    defaultCodeType: 'numeric' | 'alpha' | 'alphanumeric'
    defaultTtlSeconds: number
    defaultMaxAttempts: number
    resendCooldownSeconds: number
    consumeOnVerify: boolean
    /** Per-purpose overrides, fully resolved (every field present). */
    perPurpose: Record<string, OtpPurposeConfig>
    /** Effective config for a purpose: perPurpose[purpose] ?? the otp defaults above. */
    resolveForPurpose(purpose: string): OtpPurposeConfig
  }
  sms?: { defaultFrom?: string; resendCooldownSeconds: number }   // v0.2
  push?: { defaultTtlSeconds: number }                            // v0.2
  audit: { swallowErrors: boolean; maskRecipient: (recipient: string) => string }
}
```

> The provider/storage/renderer/repository instances are injected under their own tokens (§4.4),
> never nested in this object. `ResolvedNotificationOptions` carries scalar config + the
> `resolveForPurpose` helper only, so services stay decoupled from how providers were constructed.

### 4.6 `forRoot` (sync) and how `provider` / `storage` are resolved

Both entry points exist:

```typescript
static forRoot(options: BymaxNotificationModuleOptions): DynamicModule
static forRootAsync(options: BymaxNotificationModuleAsyncOptions): DynamicModule

export interface BymaxNotificationModuleAsyncOptions {
  imports?: ModuleMetadata['imports']
  inject?: FactoryProvider['inject']
  useFactory: (...args: any[]) => BymaxNotificationModuleOptions | Promise<BymaxNotificationModuleOptions>
}
```

`forRoot` is for fully static configuration (tests, or env read at import time). `forRootAsync` is the
common path — it resolves Redis / `ConfigService` through DI (used in §4.3 and §17).

**`provider` / `storage` accept either an instance or a class — the rule:**

| Form | When to use | How the module wires it |
|---|---|---|
| **Instance** (`new ResendEmailProvider({ apiKey })`) | Any adapter that needs runtime config (API keys, clients). **All examples use this.** | `useValue` — used as-is |
| **Class** (`InMemoryOtpStorage`) | Only zero-config adapters with a no-arg or fully DI-resolvable constructor | `useClass` — Nest instantiates it |

> A class whose constructor needs values Nest cannot resolve (an API key, a Redis client) MUST be
> passed as an instance — otherwise initialization fails. When in doubt, pass an instance.

---

## 5. Provider Contracts

### 5.1 `IEmailProvider`

The central interface of the email channel. Defines **what** to send — not how.

```typescript
/**
 * Email send provider.
 *
 * Implementations must ensure:
 * - Do not log email body in plaintext (privacy)
 * - Do not leak credentials (api keys) in error messages
 * - Throw error with useful message on failure (it will be captured by EmailService)
 */
export interface IEmailProvider {
  /**
   * Sends a transactional email.
   *
   * @param options - Send options
   * @throws Error if the send fails — EmailService converts to NotificationException
   */
  send(options: EmailSendOptions): Promise<EmailSendResult>

  /**
   * Indicates whether the provider is configured and ready to send.
   * Used by EmailService for startup validation (e.g., warn if credentials are missing).
   */
  isConfigured(): boolean

  /**
   * Provider name (e.g., 'resend', 'sendgrid', 'ses'). Used in logs and audit.
   */
  readonly name: string
}

/**
 * Email send options.
 */
export interface EmailSendOptions {
  /** Recipient email(s) */
  to: string | string[]

  /** Sender email (override of config's defaultFrom) */
  from?: string

  /** Sender name */
  fromName?: string

  /** Subject */
  subject: string

  /** HTML body */
  html: string

  /** Plain text body (recommended for deliverability) */
  text?: string

  /** Reply-to address */
  replyTo?: string

  /** CC */
  cc?: string | string[]

  /** BCC */
  bcc?: string | string[]

  /** Tags for tracking on the provider (e.g., Resend tags, SES tags) */
  tags?: Array<{ name: string; value: string }>

  /** Custom headers */
  headers?: Record<string, string>

  /** Attachments (base64 or Buffer) */
  attachments?: Array<{
    filename: string
    content: Buffer | string  // Buffer or base64 string
    contentType?: string
  }>
}

/**
 * Send result.
 * The `messageId` is provider-specific; useful for audit log correlation.
 */
export interface EmailSendResult {
  messageId: string
}
```

#### 5.1.1 Reference implementation: `ResendProvider`

```typescript
import { Injectable } from '@nestjs/common'
import { Resend } from 'resend'
import type { IEmailProvider, EmailSendOptions, EmailSendResult } from '@bymax-one/nest-notification'

export interface ResendProviderOptions {
  apiKey: string
}

@Injectable()
export class ResendEmailProvider implements IEmailProvider {
  readonly name = 'resend'
  private readonly client: Resend | null

  constructor(options: ResendProviderOptions) {
    // Lazy-load Resend so the lib does not require it as a direct dep
    this.client = options.apiKey ? new Resend(options.apiKey) : null
  }

  isConfigured(): boolean {
    return this.client !== null
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    if (!this.client) {
      throw new Error('ResendEmailProvider: missing API key')
    }

    const from = options.fromName
      ? `${options.fromName} <${options.from}>`
      : options.from ?? ''

    const result = await this.client.emails.send({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      cc: options.cc,
      bcc: options.bcc,
      tags: options.tags,
      headers: options.headers,
      attachments: options.attachments,
    })

    if (result.error) {
      throw new Error(`Resend send failed: ${result.error.message}`)
    }

    return { messageId: result.data?.id ?? '' }
  }
}
```

> **Note:** `resend` is an **optional** peer dep — only needed if the consumer instantiates `ResendEmailProvider`. Whoever uses another provider does not need to install it.

#### 5.1.2 Example adapter: SendGrid

```typescript
import sgMail from '@sendgrid/mail'
import type { IEmailProvider, EmailSendOptions, EmailSendResult } from '@bymax-one/nest-notification'

export class SendGridEmailProvider implements IEmailProvider {
  readonly name = 'sendgrid'

  constructor(apiKey: string) {
    sgMail.setApiKey(apiKey)
  }

  isConfigured(): boolean {
    return true  // Caller guarantees apiKey is valid
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const [response] = await sgMail.send({
      to: options.to,
      from: options.from ?? '',
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      cc: options.cc,
      bcc: options.bcc,
      customArgs: Object.fromEntries(
        (options.tags ?? []).map(t => [t.name, t.value])
      ),
      headers: options.headers,
    })

    return { messageId: response.headers['x-message-id'] }
  }
}
```

#### 5.1.3 Example adapter: AWS SES

```typescript
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses'
import type { IEmailProvider, EmailSendOptions, EmailSendResult } from '@bymax-one/nest-notification'

export class SesEmailProvider implements IEmailProvider {
  readonly name = 'ses'

  constructor(private readonly ses: SESClient) {}

  isConfigured(): boolean {
    return true
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const cmd = new SendEmailCommand({
      Source: options.from,
      Destination: {
        ToAddresses: Array.isArray(options.to) ? options.to : [options.to],
        CcAddresses: options.cc ? (Array.isArray(options.cc) ? options.cc : [options.cc]) : undefined,
        BccAddresses: options.bcc ? (Array.isArray(options.bcc) ? options.bcc : [options.bcc]) : undefined,
      },
      Message: {
        Subject: { Data: options.subject, Charset: 'UTF-8' },
        Body: {
          Html: { Data: options.html, Charset: 'UTF-8' },
          ...(options.text ? { Text: { Data: options.text, Charset: 'UTF-8' } } : {}),
        },
      },
      ReplyToAddresses: options.replyTo ? [options.replyTo] : undefined,
      Tags: options.tags?.map(t => ({ Name: t.name, Value: t.value })),
    })

    const result = await this.ses.send(cmd)
    return { messageId: result.MessageId ?? '' }
  }
}
```

#### 5.1.4 Example adapter: Mailgun

```typescript
import formData from 'form-data'
import Mailgun from 'mailgun.js'
import type { IEmailProvider, EmailSendOptions, EmailSendResult } from '@bymax-one/nest-notification'

export class MailgunEmailProvider implements IEmailProvider {
  readonly name = 'mailgun'
  private readonly client: ReturnType<Mailgun['client']>

  constructor(apiKey: string, private readonly domain: string) {
    const mg = new Mailgun(formData)
    this.client = mg.client({ username: 'api', key: apiKey })
  }

  isConfigured(): boolean {
    return Boolean(this.client && this.domain)
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const result = await this.client.messages.create(this.domain, {
      from: options.fromName ? `${options.fromName} <${options.from}>` : options.from,
      to: Array.isArray(options.to) ? options.to : [options.to],
      subject: options.subject,
      html: options.html,
      text: options.text,
      'h:Reply-To': options.replyTo,
      cc: options.cc,
      bcc: options.bcc,
      'o:tag': options.tags?.map(t => `${t.name}:${t.value}`),
    })

    return { messageId: result.id ?? '' }
  }
}
```

#### 5.1.5 Example adapter: NodeMailer SMTP

```typescript
import nodemailer from 'nodemailer'
import type { IEmailProvider, EmailSendOptions, EmailSendResult } from '@bymax-one/nest-notification'

export interface NodemailerSmtpOptions {
  host: string
  port: number
  secure?: boolean
  auth?: { user: string; pass: string }
}

export class NodemailerSmtpProvider implements IEmailProvider {
  readonly name = 'smtp'
  private readonly transporter: nodemailer.Transporter

  constructor(options: NodemailerSmtpOptions) {
    this.transporter = nodemailer.createTransport(options)
  }

  isConfigured(): boolean {
    return Boolean(this.transporter)
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    const info = await this.transporter.sendMail({
      from: options.fromName ? `${options.fromName} <${options.from}>` : options.from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      cc: options.cc,
      bcc: options.bcc,
      headers: options.headers,
      attachments: options.attachments,
    })

    return { messageId: info.messageId }
  }
}
```

#### 5.1.6 Development provider: `NoOpEmailProvider`

```typescript
import { Logger } from '@nestjs/common'
import type { IEmailProvider, EmailSendOptions, EmailSendResult } from '@bymax-one/nest-notification'

/**
 * Provider that does not send emails — only logs.
 * Useful for local development without SMTP credentials.
 *
 * DO NOT USE IN PRODUCTION.
 */
export class NoOpEmailProvider implements IEmailProvider {
  readonly name = 'noop'
  private readonly logger = new Logger(NoOpEmailProvider.name)

  isConfigured(): boolean {
    return true
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    // Logs subject and to — but NEVER the body (may contain PII/OTP)
    this.logger.debug(
      `[NoOpEmail] to=${Array.isArray(options.to) ? options.to.join(',') : options.to} subject="${options.subject}"`
    )
    return { messageId: `noop-${Date.now()}` }
  }
}
```

### 5.2 `IOtpStorage`

The key interface to solve the **Prisma coupling** a hand-rolled OTP store would otherwise impose. All OTP persistence goes through here.

```typescript
/**
 * OTP storage.
 *
 * Implementations MUST:
 * - Make `consumeAttempt` atomic — the lookup + attempt increment is a single indivisible
 *   operation, otherwise concurrent verify calls race and the `maxAttempts` brute-force limit
 *   can be bypassed (Redis: Lua script; in-memory: a single synchronous read-modify-write).
 * - Make `tryAcquireCooldown` atomic — check-and-set in one step (Redis: `SET NX EX`), so two
 *   concurrent generate/resend calls cannot both pass the cooldown gate.
 * - Apply TTL — expired entries must not be returned by `get`/`consumeAttempt`.
 * - Scope keys by (tenantId, recipient, purpose) without collision across tenants.
 * - Never expose OTP codes in plaintext logs.
 *
 * Note on recipient normalization: the lib does NOT normalize `recipient`. Callers must pass a
 * canonical value (e.g. `email.trim().toLowerCase()`); 'A@x.com' and 'a@x.com' map to different keys.
 */
export interface IOtpStorage {
  /**
   * Creates or replaces an OTP entry.
   *
   * @param tenantId - Tenant ID (isolation scope)
   * @param recipient - Recipient identifier (email, phone, userId — caller decides; pre-normalized)
   * @param purpose - OTP purpose (e.g., 'email_verification', 'password_reset')
   * @param entry - Entry data: code, attempts, maxAttempts, expiresAt
   */
  set(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void>

  /**
   * Retrieves an OTP entry. Returns null if it does not exist or expired.
   * Read-only — used by `getStatus()`. Verification MUST go through `consumeAttempt`.
   */
  get(tenantId: string, recipient: string, purpose: string): Promise<OtpEntry | null>

  /**
   * ATOMIC verification primitive. In one indivisible step:
   * - if no entry (or TTL-expired) → `{ status: 'not_found' }`
   * - if `attempts >= maxAttempts` → deletes the entry, returns `{ status: 'max_attempts' }`
   * - otherwise → increments `attempts` by 1, persists (preserving the original TTL),
   *   returns `{ status: 'ok', entry }` with the updated entry (including the stored `code`).
   *
   * The caller then constant-time-compares the code against `entry.code`. This split keeps the
   * contended counter atomic while leaving the (read-only) code comparison in the service.
   */
  consumeAttempt(
    tenantId: string,
    recipient: string,
    purpose: string,
  ): Promise<
    | { status: 'not_found' }
    | { status: 'max_attempts' }
    | { status: 'ok'; entry: OtpEntry }
  >

  /**
   * Updates an existing entry, preserving its remaining TTL. No-op if the entry does not exist
   * (TTL may have expired). Used to mark `validated` / write `metadata` after a successful verify.
   * Not used for the attempt counter — that goes through `consumeAttempt`.
   */
  update(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void>

  /**
   * Removes the OTP entry. Idempotent.
   */
  delete(tenantId: string, recipient: string, purpose: string): Promise<void>

  /**
   * ATOMIC cooldown acquire for (tenant, recipient, purpose). Sets the cooldown key only if it
   * does not already exist (Redis: `SET NX EX`). Returns true if acquired, false if a cooldown is
   * already active. Acts as a short-lived lock around generate/resend.
   *
   * @param ttlSeconds - Cooldown duration in seconds
   */
  tryAcquireCooldown(tenantId: string, recipient: string, purpose: string, ttlSeconds: number): Promise<boolean>

  /**
   * Returns the remaining cooldown time in seconds, or 0 if there is no active cooldown.
   */
  getCooldown(tenantId: string, recipient: string, purpose: string): Promise<number>

  /**
   * Clears the cooldown for (tenant, recipient, purpose). Idempotent. Called when a delivery fails
   * (so the user is not locked out) and on `consume()` (so a cancelled flow can restart immediately).
   */
  clearCooldown(tenantId: string, recipient: string, purpose: string): Promise<void>

  /**
   * Indicates whether the storage is configured and ready to use.
   * Used in module initialization for validation.
   */
  isConfigured(): boolean

  /**
   * Storage name (e.g., 'redis', 'memory', 'dynamodb').
   */
  readonly name: string
}

/**
 * Stored OTP entry.
 */
export interface OtpEntry {
  /** Plaintext OTP code */
  code: string

  /** Unix timestamp (ms) of expiration */
  expiresAt: number

  /** Number of verification attempts so far */
  attempts: number

  /** Maximum attempts before invalidating */
  maxAttempts: number

  /** If the OTP has already been successfully verified (not yet deleted) */
  validated?: boolean

  /** Optional metadata for the caller — ignored by the lib */
  metadata?: Record<string, unknown>
}
```

#### 5.2.1 Default implementation: `RedisOtpStorage`

```typescript
import type { Redis } from 'ioredis'
import { createHash } from 'node:crypto'
import type { IOtpStorage, OtpEntry } from '@bymax-one/nest-notification'

export interface RedisOtpStorageOptions {
  /** ioredis client provided by the consumer */
  redisClient: Redis
  /** Key namespace. Default: 'notification' */
  namespace?: string
}

/**
 * Redis-based OTP storage.
 *
 * Key structure:
 * - {ns}:otp:{purpose}:{sha256(tenantId+':'+recipient)} → JSON of OtpEntry
 * - {ns}:otp_cd:{purpose}:{sha256(tenantId+':'+recipient)} → '1' with TTL = cooldown
 *
 * We hash (tenantId, recipient) to avoid leaking email/phone via Redis key inspection.
 */
export class RedisOtpStorage implements IOtpStorage {
  readonly name = 'redis'
  private readonly redis: Redis
  private readonly namespace: string

  constructor(options: RedisOtpStorageOptions) {
    this.redis = options.redisClient
    this.namespace = options.namespace ?? 'notification'
  }

  isConfigured(): boolean {
    return Boolean(this.redis)
  }

  private otpKey(tenantId: string, recipient: string, purpose: string): string {
    const h = createHash('sha256').update(`${tenantId}:${recipient}`).digest('hex')
    return `${this.namespace}:otp:${purpose}:${h}`
  }

  private cooldownKey(tenantId: string, recipient: string, purpose: string): string {
    const h = createHash('sha256').update(`${tenantId}:${recipient}`).digest('hex')
    return `${this.namespace}:otp_cd:${purpose}:${h}`
  }

  async set(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void> {
    const ttlSec = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / 1000))
    await this.redis.setex(this.otpKey(tenantId, recipient, purpose), ttlSec, JSON.stringify(entry))
  }

  async get(tenantId: string, recipient: string, purpose: string): Promise<OtpEntry | null> {
    const raw = await this.redis.get(this.otpKey(tenantId, recipient, purpose))
    if (!raw) return null
    try {
      return JSON.parse(raw) as OtpEntry
    } catch {
      await this.delete(tenantId, recipient, purpose)
      return null
    }
  }

  /**
   * Atomic verify primitive. The whole "read → expiry/max check → increment → write" sequence
   * runs inside a single Lua script, so concurrent verify calls cannot interleave and overshoot
   * `maxAttempts`. PTTL is read inside the script to preserve the original expiry on rewrite.
   */
  private static readonly CONSUME_ATTEMPT_LUA = `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return cjson.encode({ status = 'not_found' }) end
    local entry = cjson.decode(raw)
    if entry.expiresAt and tonumber(entry.expiresAt) < tonumber(ARGV[1]) then
      redis.call('DEL', KEYS[1])
      return cjson.encode({ status = 'not_found' })
    end
    if entry.attempts >= entry.maxAttempts then
      redis.call('DEL', KEYS[1])
      return cjson.encode({ status = 'max_attempts' })
    end
    entry.attempts = entry.attempts + 1
    local ttl = redis.call('PTTL', KEYS[1])
    if ttl and ttl > 0 then
      redis.call('SET', KEYS[1], cjson.encode(entry), 'PX', ttl)
    else
      redis.call('SET', KEYS[1], cjson.encode(entry))
    end
    return cjson.encode({ status = 'ok', entry = entry })
  `

  async consumeAttempt(
    tenantId: string,
    recipient: string,
    purpose: string,
  ): Promise<
    | { status: 'not_found' }
    | { status: 'max_attempts' }
    | { status: 'ok'; entry: OtpEntry }
  > {
    const raw = (await this.redis.eval(
      RedisOtpStorage.CONSUME_ATTEMPT_LUA,
      1,
      this.otpKey(tenantId, recipient, purpose),
      Date.now().toString(),
    )) as string
    return JSON.parse(raw)
  }

  async update(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void> {
    // KEEPTTL preserves the original expiry; XX avoids resurrecting an entry that already expired.
    await this.redis.set(this.otpKey(tenantId, recipient, purpose), JSON.stringify(entry), 'KEEPTTL', 'XX')
  }

  async delete(tenantId: string, recipient: string, purpose: string): Promise<void> {
    await this.redis.del(this.otpKey(tenantId, recipient, purpose))
  }

  async tryAcquireCooldown(tenantId: string, recipient: string, purpose: string, ttlSeconds: number): Promise<boolean> {
    // SET NX EX is a single atomic check-and-set: only the first concurrent caller wins.
    const res = await this.redis.set(this.cooldownKey(tenantId, recipient, purpose), '1', 'EX', ttlSeconds, 'NX')
    return res === 'OK'
  }

  async getCooldown(tenantId: string, recipient: string, purpose: string): Promise<number> {
    const ttl = await this.redis.ttl(this.cooldownKey(tenantId, recipient, purpose))
    return ttl > 0 ? ttl : 0
  }

  async clearCooldown(tenantId: string, recipient: string, purpose: string): Promise<void> {
    await this.redis.del(this.cooldownKey(tenantId, recipient, purpose))
  }
}
```

#### 5.2.2 Alternative implementation: `InMemoryOtpStorage`

```typescript
import type { IOtpStorage, OtpEntry } from '@bymax-one/nest-notification'

/**
 * In-memory OTP storage (native Map).
 *
 * Useful for:
 * - Unit tests
 * - Local development without Redis
 *
 * DO NOT USE IN MULTI-INSTANCE PRODUCTION — entries are local to the process.
 */
export class InMemoryOtpStorage implements IOtpStorage {
  readonly name = 'memory'
  private readonly store = new Map<string, OtpEntry>()
  private readonly cooldowns = new Map<string, number>()

  isConfigured(): boolean {
    return true
  }

  private key(tenantId: string, recipient: string, purpose: string): string {
    return `${tenantId}::${recipient}::${purpose}`
  }

  async set(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void> {
    this.store.set(this.key(tenantId, recipient, purpose), entry)
  }

  async get(tenantId: string, recipient: string, purpose: string): Promise<OtpEntry | null> {
    const entry = this.store.get(this.key(tenantId, recipient, purpose))
    if (!entry) return null
    if (entry.expiresAt < Date.now()) {
      this.store.delete(this.key(tenantId, recipient, purpose))
      return null
    }
    return entry
  }

  // Atomic by construction: no `await` between read and write, so the single-threaded event loop
  // cannot interleave two consumeAttempt calls.
  async consumeAttempt(
    tenantId: string,
    recipient: string,
    purpose: string,
  ): Promise<
    | { status: 'not_found' }
    | { status: 'max_attempts' }
    | { status: 'ok'; entry: OtpEntry }
  > {
    const key = this.key(tenantId, recipient, purpose)
    const entry = this.store.get(key)
    if (!entry) return { status: 'not_found' }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return { status: 'not_found' }
    }
    if (entry.attempts >= entry.maxAttempts) {
      this.store.delete(key)
      return { status: 'max_attempts' }
    }
    entry.attempts += 1
    this.store.set(key, entry)
    return { status: 'ok', entry }
  }

  async update(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void> {
    const key = this.key(tenantId, recipient, purpose)
    if (this.store.has(key)) {
      this.store.set(key, entry)
    }
  }

  async delete(tenantId: string, recipient: string, purpose: string): Promise<void> {
    this.store.delete(this.key(tenantId, recipient, purpose))
  }

  async tryAcquireCooldown(tenantId: string, recipient: string, purpose: string, ttlSeconds: number): Promise<boolean> {
    const key = this.key(tenantId, recipient, purpose)
    const existing = this.cooldowns.get(key)
    if (existing && existing > Date.now()) return false
    this.cooldowns.set(key, Date.now() + ttlSeconds * 1000)
    return true
  }

  async getCooldown(tenantId: string, recipient: string, purpose: string): Promise<number> {
    const expiry = this.cooldowns.get(this.key(tenantId, recipient, purpose))
    if (!expiry) return 0
    const remaining = Math.ceil((expiry - Date.now()) / 1000)
    if (remaining <= 0) {
      this.cooldowns.delete(this.key(tenantId, recipient, purpose))
      return 0
    }
    return remaining
  }

  async clearCooldown(tenantId: string, recipient: string, purpose: string): Promise<void> {
    this.cooldowns.delete(this.key(tenantId, recipient, purpose))
  }
}
```

#### 5.2.3 Example adapter: DynamoDB

```typescript
import { DynamoDBClient, GetItemCommand, PutItemCommand, DeleteItemCommand } from '@aws-sdk/client-dynamodb'
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb'
import type { IOtpStorage, OtpEntry } from '@bymax-one/nest-notification'

export class DynamoDbOtpStorage implements IOtpStorage {
  readonly name = 'dynamodb'

  constructor(
    private readonly ddb: DynamoDBClient,
    private readonly tableName: string
  ) {}

  isConfigured(): boolean {
    return Boolean(this.ddb && this.tableName)
  }

  private pk(tenantId: string, recipient: string, purpose: string): string {
    return `${tenantId}#${recipient}#${purpose}`
  }

  async set(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void> {
    await this.ddb.send(new PutItemCommand({
      TableName: this.tableName,
      Item: marshall({
        pk: this.pk(tenantId, recipient, purpose),
        sk: 'otp',
        ...entry,
        ttl: Math.floor(entry.expiresAt / 1000),  // DynamoDB TTL is in Unix seconds
      }),
    }))
  }

  // get/update/delete are analogous. The atomic methods map to DynamoDB conditional writes:
  // - consumeAttempt    → UpdateItem "SET attempts = attempts + :one"
  //                       ConditionExpression "attribute_exists(pk) AND attempts < maxAttempts",
  //                       ReturnValues: ALL_NEW; translate ConditionalCheckFailedException into
  //                       { status: 'max_attempts' } (or { status: 'not_found' } if the item is gone).
  // - tryAcquireCooldown→ PutItem with ConditionExpression "attribute_not_exists(pk)" (false on failure).
  // - clearCooldown     → DeleteItem.  getCooldown → GetItem + compute remaining from the ttl attribute.
}
```

### 5.3 `IPushProvider` (v0.2 — deferred)

```typescript
/**
 * Push notifications provider.
 * Implementations: FCM (Firebase), APN (Apple), Web Push (VAPID).
 */
export interface IPushProvider {
  readonly name: string
  isConfigured(): boolean
  send(options: PushSendOptions): Promise<PushSendResult>
}

export interface PushSendOptions {
  /** Device token(s). */
  tokens: string | string[]

  /** Notification title */
  title: string

  /** Body */
  body: string

  /** Arbitrary data (attached to the payload, read by the mobile client) */
  data?: Record<string, string>

  /** Image (URL) */
  imageUrl?: string

  /** Sound (e.g., 'default', 'custom.caf') */
  sound?: string

  /** Badge count (iOS) */
  badge?: number

  /** TTL in seconds */
  ttlSeconds?: number

  /** Priority ('high' | 'normal') */
  priority?: 'high' | 'normal'
}

export interface PushSendResult {
  /** Message IDs returned by the provider, per token */
  results: Array<{ token: string; messageId?: string; error?: string }>
}
```

#### 5.3.1 Example adapter: FCM (Firebase Cloud Messaging)

```typescript
import { messaging } from 'firebase-admin'
import type { IPushProvider, PushSendOptions, PushSendResult } from '@bymax-one/nest-notification'

export class FcmPushProvider implements IPushProvider {
  readonly name = 'fcm'
  constructor(private readonly fcm: messaging.Messaging) {}

  isConfigured(): boolean {
    return Boolean(this.fcm)
  }

  async send(options: PushSendOptions): Promise<PushSendResult> {
    const tokens = Array.isArray(options.tokens) ? options.tokens : [options.tokens]
    const response = await this.fcm.sendEachForMulticast({
      tokens,
      notification: { title: options.title, body: options.body, imageUrl: options.imageUrl },
      data: options.data,
      android: { priority: options.priority === 'high' ? 'high' : 'normal' },
      apns: {
        payload: {
          aps: {
            sound: options.sound ?? 'default',
            badge: options.badge,
          },
        },
      },
    })

    return {
      results: response.responses.map((r, i) => ({
        token: tokens[i],
        messageId: r.messageId,
        error: r.error?.message,
      })),
    }
  }
}
```

### 5.4 `ISmsProvider` (v0.2 — deferred)

```typescript
/**
 * SMS provider.
 * Implementations: Twilio, AWS SNS, MessageBird, Vonage.
 */
export interface ISmsProvider {
  readonly name: string
  isConfigured(): boolean
  send(options: SmsSendOptions): Promise<SmsSendResult>
}

export interface SmsSendOptions {
  /** Recipient in E.164 format (e.g., '+5511999998888') */
  to: string

  /** Sender (E.164 or alphanumeric sender ID) */
  from?: string

  /** Body */
  body: string

  /** Tags for tracking (not supported by all providers) */
  tags?: Array<{ name: string; value: string }>
}

export interface SmsSendResult {
  messageId: string
}
```

#### 5.4.1 Example adapter: Twilio

```typescript
import twilio from 'twilio'
import type { ISmsProvider, SmsSendOptions, SmsSendResult } from '@bymax-one/nest-notification'

export class TwilioSmsProvider implements ISmsProvider {
  readonly name = 'twilio'
  private readonly client: ReturnType<typeof twilio>

  constructor(accountSid: string, authToken: string) {
    this.client = twilio(accountSid, authToken)
  }

  isConfigured(): boolean {
    return Boolean(this.client)
  }

  async send(options: SmsSendOptions): Promise<SmsSendResult> {
    const message = await this.client.messages.create({
      to: options.to,
      from: options.from ?? '',
      body: options.body,
    })
    return { messageId: message.sid }
  }
}
```

#### 5.4.2 Example adapter: AWS SNS

```typescript
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
import type { ISmsProvider, SmsSendOptions, SmsSendResult } from '@bymax-one/nest-notification'

export class SnsSmsProvider implements ISmsProvider {
  readonly name = 'sns'

  constructor(private readonly sns: SNSClient) {}

  isConfigured(): boolean {
    return true
  }

  async send(options: SmsSendOptions): Promise<SmsSendResult> {
    const result = await this.sns.send(new PublishCommand({
      PhoneNumber: options.to,
      Message: options.body,
      MessageAttributes: options.from
        ? { 'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: options.from } }
        : undefined,
    }))
    return { messageId: result.MessageId ?? '' }
  }
}
```

### 5.5 `IEmailTemplateRenderer`

Solves the problem of **hardcoded HTML** that a hand-rolled `EmailService` typically bakes in.

```typescript
/**
 * Email template renderer.
 *
 * Allows plugging in different engines: simple interpolation (default),
 * Handlebars, MJML, React Email, etc.
 */
export interface IEmailTemplateRenderer {
  /**
   * Renders a template to HTML, optionally text and subject.
   *
   * @param templateName - Template name (e.g., 'otp_code', 'welcome', 'password_reset_success')
   * @param data - Variables to interpolate
   * @param locale - Locale ('en', 'pt-BR', etc.)
   */
  render(templateName: string, data: Record<string, unknown>, locale: string): Promise<RenderedEmail>

  /**
   * Indicates whether the renderer has the template registered.
   * Allows EmailService to fail early if a template is missing.
   */
  hasTemplate(templateName: string, locale: string): Promise<boolean>

  readonly name: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text?: string
}
```

#### 5.5.1 Default implementation: `DefaultTemplateRenderer`

```typescript
import type { IEmailTemplateRenderer, RenderedEmail } from '@bymax-one/nest-notification'

export interface DefaultTemplateRendererOptions {
  /**
   * Registered templates. Keyed by `${templateName}::${locale}`.
   * Value is the template with `{{varName}}` placeholders.
   */
  templates: Record<string, { subject: string; html: string; text?: string }>
}

/**
 * Simple renderer based on `{{var}}` interpolation.
 * No conditional logic, no helpers, no partials.
 *
 * For something more elaborate, plug in Handlebars/MJML/React Email
 * by implementing IEmailTemplateRenderer.
 */
export class DefaultTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'default-interpolation'
  private readonly templates: DefaultTemplateRendererOptions['templates']

  constructor(options: DefaultTemplateRendererOptions) {
    this.templates = options.templates
  }

  private key(templateName: string, locale: string): string {
    return `${templateName}::${locale}`
  }

  async hasTemplate(templateName: string, locale: string): Promise<boolean> {
    return Boolean(this.templates[this.key(templateName, locale)])
  }

  async render(templateName: string, data: Record<string, unknown>, locale: string): Promise<RenderedEmail> {
    const tpl = this.templates[this.key(templateName, locale)]
      ?? this.templates[this.key(templateName, 'en')]
      ?? null

    if (!tpl) {
      throw new Error(`Template not found: ${templateName} (locale=${locale})`)
    }

    // HTML-escape substituted variables ONLY in the html body (prevents XSS). The subject line and
    // the plain-text body are not HTML contexts — escaping them would surface literal "&amp;"/"&lt;".
    const fill = (str: string, escape: boolean): string =>
      str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, varName) => {
        const value = String(data[varName] ?? '')
        return escape ? this.escapeHtml(value) : value
      })

    return {
      subject: fill(tpl.subject, false),
      html: fill(tpl.html, true),
      text: tpl.text ? fill(tpl.text, false) : undefined,
    }
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }
}
```

#### 5.5.2 Example adapter: Handlebars

```typescript
import Handlebars from 'handlebars'
import type { IEmailTemplateRenderer, RenderedEmail } from '@bymax-one/nest-notification'

export class HandlebarsTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'handlebars'
  private readonly compiledTemplates: Record<string, { subject: HandlebarsTemplateDelegate; html: HandlebarsTemplateDelegate; text?: HandlebarsTemplateDelegate }> = {}

  constructor(templates: Record<string, { subject: string; html: string; text?: string }>) {
    for (const [key, tpl] of Object.entries(templates)) {
      this.compiledTemplates[key] = {
        subject: Handlebars.compile(tpl.subject),
        html: Handlebars.compile(tpl.html),
        text: tpl.text ? Handlebars.compile(tpl.text) : undefined,
      }
    }
  }

  async hasTemplate(templateName: string, locale: string): Promise<boolean> {
    return Boolean(this.compiledTemplates[`${templateName}::${locale}`])
  }

  async render(templateName: string, data: Record<string, unknown>, locale: string): Promise<RenderedEmail> {
    const tpl = this.compiledTemplates[`${templateName}::${locale}`]
      ?? this.compiledTemplates[`${templateName}::en`]
    if (!tpl) throw new Error(`Template not found: ${templateName} (${locale})`)
    return {
      subject: tpl.subject(data),
      html: tpl.html(data),
      text: tpl.text?.(data),
    }
  }
}
```

#### 5.5.3 Example adapter: React Email

```typescript
import { render } from '@react-email/render'
import type { ComponentType } from 'react'
import type { IEmailTemplateRenderer, RenderedEmail } from '@bymax-one/nest-notification'

export class ReactEmailTemplateRenderer implements IEmailTemplateRenderer {
  readonly name = 'react-email'

  constructor(
    private readonly templates: Record<string, {
      subject: (data: Record<string, unknown>) => string
      component: ComponentType<Record<string, unknown>>
    }>
  ) {}

  async hasTemplate(templateName: string, locale: string): Promise<boolean> {
    return Boolean(this.templates[`${templateName}::${locale}`])
  }

  async render(templateName: string, data: Record<string, unknown>, locale: string): Promise<RenderedEmail> {
    const tpl = this.templates[`${templateName}::${locale}`]
      ?? this.templates[`${templateName}::en`]
    if (!tpl) throw new Error(`Template not found: ${templateName} (${locale})`)
    const Component = tpl.component
    const html = await render(Component(data) as JSX.Element)
    return { subject: tpl.subject(data), html }
  }
}
```

### 5.6 `INotificationLogRepository` (optional)

Audit log for compliance — completely optional.

```typescript
/**
 * Notification log repository.
 *
 * When configured, the module records:
 * - Every successful send/generate/verify call
 * - Every failure (with error message — in the stack to avoid leakage)
 *
 * The consumer implements persistence (Postgres, Mongo, ClickHouse, BigQuery, etc.).
 */
export interface INotificationLogRepository {
  /**
   * Creates a log entry.
   * This operation is fire-and-forget — it does not block the main flow
   * (controlled by config's `audit.swallowErrors`).
   */
  create(entry: NotificationLogEntry): Promise<void>

  readonly name: string
}

/**
 * Notification log entry.
 */
export interface NotificationLogEntry {
  /** Unix timestamp (ms) of the event */
  timestamp: number

  /** Tenant ID */
  tenantId: string

  /** Channel used */
  channel: 'email' | 'otp' | 'sms' | 'push'

  /** Event verb */
  verb: 'sent' | 'generated' | 'verified' | 'failed' | 'cooldown_blocked' | 'max_attempts_exceeded'

  /** Recipient identifier (email/phone/userId — masked if PII) */
  recipient: string

  /** Purpose (for OTP) or template name (for email) */
  purpose?: string

  /** Provider name used (resend, sendgrid, twilio, fcm, ...) */
  providerName: string

  /** Message ID returned by the provider (for correlation) */
  messageId?: string

  /** Error message (if verb='failed') — in the stack trace */
  errorMessage?: string

  /** Associated user ID, if known (from consumer's `req.user`) */
  userId?: string

  /** Arbitrary caller metadata */
  metadata?: Record<string, unknown>
}
```

#### 5.6.1 No-op implementation

```typescript
import type { INotificationLogRepository, NotificationLogEntry } from '@bymax-one/nest-notification'

/**
 * Repository that discards logs. Default when audit is not configured.
 */
export class NoOpNotificationLogRepository implements INotificationLogRepository {
  readonly name = 'noop'
  async create(_entry: NotificationLogEntry): Promise<void> {
    // discards silently
  }
}
```

#### 5.6.2 Reference Prisma schema

For consumers using Prisma, this lib distributes a fragment in `docs/schemas/notification-log.prisma`:

```prisma
// Prisma fragment for notification audit log.
// Copy to your schema.prisma if you want to use Prisma as persistence.

model NotificationLog {
  id            String   @id @default(uuid())
  timestamp     DateTime @default(now())
  tenantId      String
  channel       String   // 'email' | 'otp' | 'sms' | 'push'
  verb          String   // 'sent' | 'generated' | 'verified' | 'failed' | ...
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
}
```

---

## 6. Services

### 6.1 `EmailService`

Public email send service. Wraps the `IEmailProvider`, adding audit logging, attachment-size enforcement, and optional template rendering (HTML escaping is applied by the renderer during `sendTemplate`, not on raw `send`).

```typescript
@Injectable()
export class EmailService {
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS) private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_EMAIL_PROVIDER) private readonly provider: IEmailProvider,
    @Inject(BYMAX_NOTIFICATION_TEMPLATE_RENDERER) private readonly renderer: IEmailTemplateRenderer,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY) private readonly auditLog: INotificationLogRepository,
  ) {}

  /**
   * Sends an email with raw body (subject/html/text provided by the caller).
   *
   * @param input.tenantId - Tenant ID (scopes audit log)
   * @param input.to - Recipient(s)
   * @param input.subject - Subject
   * @param input.html - HTML body
   * @param input.text - Text body (optional)
   * @throws NotificationException EMAIL_SEND_FAILED on provider failure
   * @throws NotificationException EMAIL_ATTACHMENTS_TOO_LARGE if total attachment bytes exceed email.maxAttachmentBytes
   */
  async send(input: {
    tenantId: string
    to: string | string[]
    subject: string
    html: string
    text?: string
    from?: string
    fromName?: string
    replyTo?: string
    cc?: string | string[]
    bcc?: string | string[]
    tags?: Array<{ name: string; value: string }>
    attachments?: EmailSendOptions['attachments']
    userId?: string                  // For audit log
  }): Promise<{ messageId: string }>

  /**
   * Sends an email rendering a template.
   *
   * @param input.template - Name of the template registered in the renderer
   * @param input.data - Variables for interpolation
   * @param input.locale - Template locale (default: options.global.defaultLocale)
   */
  async sendTemplate(input: {
    tenantId: string
    to: string | string[]
    template: string
    data: Record<string, unknown>
    locale?: string
    from?: string
    fromName?: string
    replyTo?: string
    tags?: Array<{ name: string; value: string }>
    userId?: string
  }): Promise<{ messageId: string }>

  /**
   * Indicates whether the email channel is configured.
   */
  isConfigured(): boolean
}
```

### 6.2 `OtpService`

Public OTP service. Replaces a hand-rolled OTP service, Redis store, and email-verification service.

```typescript
@Injectable()
export class OtpService {
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS) private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_OTP_STORAGE) private readonly storage: IOtpStorage,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY) private readonly auditLog: INotificationLogRepository,
    // Present only when the email channel is also configured. `deliverVia: 'email'` delegates
    // rendering + sending to EmailService (which owns the template renderer, HTML escaping and audit).
    // OtpService never touches the raw IEmailProvider directly — that interface cannot render templates.
    @Optional() private readonly emailService?: EmailService,
  ) {}

  /**
   * Generates, persists, and (optionally) sends an OTP by email.
   *
   * @param input.tenantId - Tenant ID
   * @param input.recipient - Recipient email or phone
   * @param input.purpose - Purpose (e.g., 'email_verification', 'password_reset')
   * @param input.deliverVia - 'email' | 'manual' (caller sends the code by other means)
   * @param input.emailTemplate - Template for the email (default: 'otp_code')
   * @param input.emailData - Extra data for the template
   * @param input.locale - Email locale
   *
   * When `deliverVia: 'email'`, the code is delivered through EmailService.sendTemplate(), which
   * renders `emailTemplate` (default `'otp_code'`) with `{ code, expiresInMinutes, purpose, ...emailData }`.
   * The lib injects `code` and `expiresInMinutes` automatically — the caller only adds extras
   * (e.g. `name`, `appName`, or a `verificationLink` for OTP-plus-deep-link emails).
   *
   * @throws NotificationException OTP_COOLDOWN_ACTIVE — if cooldown active
   * @throws NotificationException OTP_EMAIL_DELIVERY_NOT_CONFIGURED — `deliverVia: 'email'` but no email channel configured
   *
   * @returns { expiresAt: number, cooldownSeconds: number }
   */
  async generate(input: {
    tenantId: string
    recipient: string
    purpose: string
    deliverVia?: 'email' | 'manual'
    emailTemplate?: string
    emailData?: Record<string, unknown>
    locale?: string
    userId?: string
  }): Promise<{ expiresAt: number; cooldownSeconds: number }>

  /**
   * Verifies an OTP code.
   *
   * By default, does NOT consume (delete) the OTP — the caller must call `consume()`
   * after a successful subsequent operation (e.g., password reset).
   * Can be configured to auto-consume via `otp.consumeOnVerify: true`.
   *
   * @returns OtpVerifyResult — discriminated union
   */
  async verify(input: {
    tenantId: string
    recipient: string
    purpose: string
    code: string
    userId?: string
  }): Promise<OtpVerifyResult>

  /**
   * Consumes (deletes) an OTP and clears its resend cooldown. Idempotent.
   * Call after the dependent operation completes (e.g. right after the password is changed),
   * or to cancel an in-flight OTP so the user can restart immediately with a different recipient.
   */
  async consume(input: {
    tenantId: string
    recipient: string
    purpose: string
    userId?: string
  }): Promise<void>

  /**
   * Explicit resend (generates new code, replaces the previous one).
   * Subject to cooldown via `otp.resendCooldownSeconds`.
   *
   * Convenient shortcut for `generate(...)` with clear "resend" semantics.
   */
  async resend(input: {
    tenantId: string
    recipient: string
    purpose: string
    deliverVia?: 'email' | 'manual'
    emailTemplate?: string
    emailData?: Record<string, unknown>
    locale?: string
    userId?: string
  }): Promise<{ expiresAt: number; cooldownSeconds: number }>

  /**
   * Returns information about active OTP (if exists).
   * Does NOT return the code in plaintext.
   */
  async getStatus(input: {
    tenantId: string
    recipient: string
    purpose: string
  }): Promise<{
    exists: boolean
    expiresAt?: number
    attempts?: number
    maxAttempts?: number
    cooldownSeconds: number
    validated?: boolean
  }>

  /**
   * Indicates whether the OTP channel is configured.
   */
  isConfigured(): boolean
}

/**
 * OTP verification result — discriminated union.
 *
 * Note: an expired entry is reported as `not_found`. Once a code's TTL lapses the entry is gone, so
 * "missing" and "expired" are indistinguishable at the storage layer — and §11.5 recommends not
 * leaking the difference to the client anyway.
 */
export type OtpVerifyResult =
  | { valid: true }
  | { valid: false; reason: 'not_found' }
  | { valid: false; reason: 'max_attempts' }
  | { valid: false; reason: 'invalid_code'; remainingAttempts: number }

/** Input accepted by OtpService.generate() and .resend(). */
export interface OtpGenerateOptions {
  tenantId: string
  recipient: string
  purpose: string
  deliverVia?: 'email' | 'manual'   // default 'email' when the email channel is configured, else 'manual'
  emailTemplate?: string            // default 'otp_code'
  emailData?: Record<string, unknown>
  locale?: string
  userId?: string
}

/** Input accepted by OtpService.verify(). */
export interface OtpVerifyOptions {
  tenantId: string
  recipient: string
  purpose: string
  code: string
  userId?: string
}
```

#### 6.2.1 Code generation — `code-generator.ts`

```typescript
import { randomInt } from 'node:crypto'

/**
 * Generates a crypto-secure OTP code.
 *
 * @param length - Code length (1-32)
 * @param type - 'numeric' | 'alpha' | 'alphanumeric'
 */
export function generateOtpCode(length: number, type: 'numeric' | 'alpha' | 'alphanumeric'): string {
  if (!Number.isInteger(length) || length < 1 || length > 32) {
    throw new Error(`Invalid OTP length: ${length} (must be an integer in [1, 32])`)
  }

  // Every type is generated character-by-character from a charset. The numeric path deliberately
  // does NOT use randomInt(0, 10 ** length): for length >= 15 that exceeds randomInt's 2**48 ceiling
  // and loses integer precision (length >= 16 > Number.MAX_SAFE_INTEGER). Per-digit randomInt(0, 10)
  // is unbiased and works for any length, with leading zeros preserved naturally.
  const NUMERIC = '0123456789'
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ'              // excludes I, O
  const ALPHANUMERIC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'  // excludes 0, 1, I, O
  const charset = type === 'numeric' ? NUMERIC : type === 'alpha' ? ALPHA : ALPHANUMERIC

  let code = ''
  for (let i = 0; i < length; i++) {
    code += charset[randomInt(0, charset.length)]
  }
  return code
}
```

#### 6.2.2 Constant-time comparison — `timing-safe-compare.ts`

```typescript
import { timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison used by OtpService.verify().
 *
 * crypto.timingSafeEqual throws a RangeError when the two buffers differ in length — so a
 * wrong-length OTP guess would crash with a 500 instead of failing closed. We length-check first
 * and return false. For fixed-length OTPs this leaks only the (already public) expected length,
 * never the contents; the byte comparison itself stays constant-time.
 */
export function safeCompare(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(actual, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
```

### 6.3 `SmsService` (v0.2)

```typescript
@Injectable()
export class SmsService {
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS) private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_SMS_PROVIDER) private readonly provider: ISmsProvider,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY) private readonly auditLog: INotificationLogRepository,
  ) {}

  async send(input: {
    tenantId: string
    to: string
    body: string
    from?: string
    tags?: Array<{ name: string; value: string }>
    userId?: string
  }): Promise<{ messageId: string }>

  isConfigured(): boolean
}
```

### 6.4 `PushService` (v0.2)

```typescript
@Injectable()
export class PushService {
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS) private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_PUSH_PROVIDER) private readonly provider: IPushProvider,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY) private readonly auditLog: INotificationLogRepository,
  ) {}

  async send(input: {
    tenantId: string
    tokens: string | string[]
    title: string
    body: string
    data?: Record<string, string>
    imageUrl?: string
    sound?: string
    badge?: number
    priority?: 'high' | 'normal'
    userId?: string
  }): Promise<PushSendResult>

  isConfigured(): boolean
}
```

### 6.5 `NotificationService` (orchestrator)

Unified service for consumers who want a uniform API across channels.

```typescript
@Injectable()
export class NotificationService {
  constructor(
    @Optional() private readonly email?: EmailService,
    @Optional() private readonly otp?: OtpService,
    @Optional() private readonly sms?: SmsService,        // v0.2
    @Optional() private readonly push?: PushService,      // v0.2
  ) {}

  /**
   * Dispatches a notification to the specified channel.
   *
   * Caller must ensure the channel is enabled — check with `isChannelEnabled()`.
   *
   * @example
   * ```ts
   * await notification.dispatch({
   *   channel: 'email',
   *   tenantId: 'tenant_123',
   *   payload: {
   *     to: 'user@example.com',
   *     template: 'welcome',
   *     data: { name: 'Maria' },
   *   },
   * })
   * ```
   */
  async dispatch(input: DispatchInput): Promise<DispatchResult>

  /**
   * Returns which channels are configured.
   */
  getEnabledChannels(): NotificationChannel[]

  /**
   * Shortcut to directly access EmailService.
   * Throws if email channel not enabled.
   */
  getEmail(): EmailService

  /**
   * Shortcut to OtpService.
   */
  getOtp(): OtpService

  // ...sms, push in v0.2
}

export type DispatchInput =
  | { channel: 'email'; tenantId: string; payload: EmailDispatchPayload }
  | { channel: 'otp'; tenantId: string; payload: OtpDispatchPayload }
  | { channel: 'sms'; tenantId: string; payload: SmsDispatchPayload }      // v0.2
  | { channel: 'push'; tenantId: string; payload: PushDispatchPayload }    // v0.2

export interface EmailDispatchPayload {
  to: string | string[]
  /** Either a registered template name… */
  template?: string
  data?: Record<string, unknown>
  locale?: string
  /** …or a raw body (subject + html required when no template is given). */
  subject?: string
  html?: string
  text?: string
  from?: string
  fromName?: string
  replyTo?: string
  tags?: Array<{ name: string; value: string }>
  userId?: string
}

export interface OtpDispatchPayload {
  recipient: string
  purpose: string
  /** 'generate' (default) issues a code; 'verify' checks one; 'consume' deletes one. */
  action?: 'generate' | 'verify' | 'consume'
  code?: string                 // required when action === 'verify'
  deliverVia?: 'email' | 'manual'
  emailTemplate?: string
  emailData?: Record<string, unknown>
  locale?: string
  userId?: string
}

export interface SmsDispatchPayload {            // v0.2
  to: string
  body: string
  from?: string
  tags?: Array<{ name: string; value: string }>
  userId?: string
}

export interface PushDispatchPayload {           // v0.2
  tokens: string | string[]
  title: string
  body: string
  data?: Record<string, string>
  imageUrl?: string
  sound?: string
  badge?: number
  priority?: 'high' | 'normal'
  userId?: string
}

/**
 * Result of dispatch(), discriminated by channel.
 */
export type DispatchResult =
  | { channel: 'email'; messageId: string }
  | { channel: 'otp'; result: { expiresAt: number; cooldownSeconds: number } | OtpVerifyResult | void }
  | { channel: 'sms'; messageId: string }       // v0.2
  | { channel: 'push'; result: PushSendResult } // v0.2
```

---

## 7. Multi-tenant

### 7.1 Model

All methods of `EmailService`, `OtpService`, `SmsService`, `PushService`, and `NotificationService` **require `tenantId`**. Without `tenantId`, the call is rejected (single-tenant consumers pass a constant such as `'default'`).

### 7.2 Isolation

| Resource | How it is isolated |
|---|---|
| **OTP entries** | Redis key includes sha256(`{tenantId}:{recipient}:{purpose}`) — in the collision between tenants |
| **Cooldown** | Same key scope — one tenant's cooldown does not block another |
| **Audit log** | Indexed `tenantId` column — queries filter by tenant |
| **Templates** | Templates are **not** isolated by tenant in the lib — if you need per-tenant templates, do this in your `IEmailTemplateRenderer` (use `data.tenantId` if passed) |

### 7.3 tenantId resolver (anti-spoofing)

When the lib is exposed via custom HTTP controllers of the consumer, the consumer can pass `req.headers['x-tenant-id']` as tenantId — but this is vulnerable to spoofing.

The lib offers `global.tenantIdResolver` so the application can centralize tenantId resolution from the Request (e.g., extract from JWT, subdomain, etc.). When configured, the `NotificationAuditInterceptor` (if active) uses this resolver as the source of truth.

> **Important:** The `tenantIdResolver` is a convenience for the audit interceptor. The service methods still require explicit `tenantId` — there is no magic that overrides the parameter behind the scenes. Use the resolver to extract the tenantId in the controller and pass it explicitly to the service.

---

## 8. Rate Limiting (Resend Cooldown)

### 8.1 Model

The lib applies **cooldown** between resends of OTP/SMS per (tenantId, recipient, purpose). This is different from global rate limit (which is the responsibility of the consumer's `@nestjs/throttler`).

**Objective:** prevent an attacker from using repeated "resend OTP" calls to reset the attempt counter, in practice circumventing the `maxAttempts` protection.

### 8.2 Mechanics

```
Call to `otp.generate()` / `otp.resend()`
    │
    ├─ acquired = storage.tryAcquireCooldown(tenant, recipient, purpose, resendCooldownSeconds)
    │     Atomic SET NX EX — only the first concurrent caller acquires.
    │     │
    │     ├─ false → remaining = storage.getCooldown(...);
    │     │           throws NotificationException OTP_COOLDOWN_ACTIVE { remainingSeconds: remaining }
    │     │
    │     └─ true → continues (cooldown now held as a short-lived lock)
    │
    ├─ Generates new OTP, replaces the previous one (resets attempts to 0)
    │
    ├─ Delivers (if deliverVia: 'email'); on failure → storage.clearCooldown(...) + delete OTP, rethrow
    │
    ▼
Returns { expiresAt, cooldownSeconds }
```

> Acquiring the cooldown atomically *before* generating (instead of writing it after a successful
> send) closes the race where two parallel requests both observe `getCooldown() == 0` and both reset
> the attempt counter — which would otherwise quietly defeat the `maxAttempts` protection.

### 8.3 Configuration

- **Global:** `otp.resendCooldownSeconds` (default: 60)
- **Per purpose:** `otp.perPurpose.{purpose}.resendCooldownSeconds` — overrides

### 8.4 Redis keys (summary — see §10 for the full table)

```
{namespace}:otp_cd:{purpose}:{sha256(tenantId+':'+recipient)} → '1' with TTL = cooldown
```

### 8.5 UX trade-off

60s cooldown is traditionally reasonable for email. For SMS, consider 30s. Cases where 60s is annoying:

- Email does not arrive — user wants to resend before 60s
- User typed wrong email and wants to correct it

The lib does not magically solve this — the consumer can allow OTP cancellation via `otp.consume()` (which clears the cooldown when deleting the key) in case the user decides to cancel and restart with a different email.

---

## 9. Templating

### 9.1 Template resolution

```
emailService.sendTemplate({ template: 'welcome', data, locale: 'pt-BR' })
    │
    ├─ renderer.hasTemplate('welcome', 'pt-BR') → boolean
    │     │
    │     ├─ No → tries locale 'en' (hardcoded fallback to 'en')
    │     │   │
    │     │   ├─ No → throws NotificationException TEMPLATE_NOT_FOUND
    │     │   │
    │     │   └─ Yes → renderer.render('welcome', data, 'en')
    │     │
    │     └─ Yes → renderer.render('welcome', data, 'pt-BR')
    │
    ▼
{ subject, html, text } → emailService.send({ subject, html, text, ...rest })
```

### 9.2 Suggested default templates

The lib documents canonical template names. **Does not embed any HTML** — the consumer registers the templates in the renderer.

| Template | When to use | Typical variables |
|---|---|---|
| `otp_code` | OTP for email verification | `code`, `expiresInMinutes`, `purpose`, `name`, `appName` |
| `otp_password_reset` | OTP for password reset (distinct copy; may carry a deep link) | `code`, `expiresInMinutes`, `name`, `appName`, `verificationLink` |
| `otp_resent` | OTP resend | same as the originating OTP template |
| `welcome` | After email verification | `name`, `appName`, `appUrl` |
| `password_reset_success` | Password change confirmation | `name`, `appName`, `supportEmail` |
| `trial_expiring` | Trial ends soon | `name`, `appName`, `trialPlanName`, `daysLeft`, `appUrl` |
| `trial_expired` | Trial ended | `name`, `appName`, `trialPlanName`, `durationDays`, `appUrl` |
| `new_login_alert` | New device login | `device`, `ip`, `timestamp`, `name` |
| `mfa_enabled` / `mfa_disabled` | MFA toggled | `name`, `appName` |

> The first seven mirror the names a typical consumer already ships. `otp_code` /
> `otp_password_reset` render a CTA button when `emailData.verificationLink` is supplied — that is how
> an OTP email doubles as a deep link (the `magic_link` purpose). `trial_*` templates typically also
> register a hand-written plain-text body for deliverability and provider `tags` for analytics.
>
> **Important:** this list is convention, not enforced. Each consumer decides which templates they want to register. The lib never embeds HTML — templates live in the consumer's `IEmailTemplateRenderer`.

### 9.3 Security in templates

- **Default renderer** does automatic HTML-escape on variables (`{{var}}` → escaped text)
- When consumer uses Handlebars, should use `{{var}}` (escape) instead of `{{{var}}}` (raw)
- When consumer uses React Email, escape is automatic by React

### 9.4 i18n

The lib accepts `locale` on all operations that depend on a template. The renderer decides how to handle it:

- DefaultTemplateRenderer: lookup key is `${templateName}::${locale}` with fallback `${templateName}::en`
- HandlebarsTemplateRenderer: same strategy
- ReactEmailTemplateRenderer: same strategy
- Consumer with custom i18n library: implements its own renderer

---

## 10. Redis Strategy

### 10.1 Overview

Redis is used for 2 purposes:

1. **OTP storage** (via `RedisOtpStorage`)
2. **Resend cooldown** (same class)

The lib does **not** force ioredis or Redis on the consumer — just implement `IOtpStorage`. But since Redis is the recommended backend for any multi-instance SaaS in production, `RedisOtpStorage` is the default exported.

### 10.2 Key pattern

All keys follow the format: `{namespace}:{prefix}:{purpose}:{identifier}`

Where:
- `{namespace}` is `global.redisNamespace` (default: `notification`)
- `{prefix}` indicates the type (`otp` or `otp_cd`)
- `{purpose}` is the purpose (`email_verification`, `password_reset`, etc.)
- `{identifier}` is sha256(`{tenantId}:{recipient}`)

> **Why hash `{tenantId}:{recipient}`?** Avoids PII (emails, phones) leakage via Redis key inspection. Whoever can list `KEYS notification:otp:*` cannot identify who has pending OTPs.

### 10.3 Complete Redis key table

| Prefix | Key pattern | Value | TTL | Purpose |
|---|---|---|---|---|
| `otp` | `notification:otp:{purpose}:{sha256(tid+':'+rcpt)}` | JSON: `{ code, expiresAt, attempts, maxAttempts, validated?, metadata? }` | `ttlSeconds` resolved per purpose (default 600s) | OTP entry. Stores plaintext code, attempt counter, and validation flag. We hash (tenantId, recipient) for privacy. |
| `otp_cd` | `notification:otp_cd:{purpose}:{sha256(tid+':'+rcpt)}` | `'1'` | `resendCooldownSeconds` (default 60s) | Cooldown between resends. Key existence indicates active cooldown. TTL determines remaining time. |

> **Why JSON and not Hash?** Hash would have write cost per field via HSET — but for this pattern (we always read and write the entire entry) JSON is simpler and has equivalent cost. In very high volumes, consider migrating to Hash (does not change public API).

### 10.4 Redis operations per feature

**OTP generation:**

```
1. SET   notification:otp_cd:{purpose}:{h} '1' NX EX {cooldown}   → atomic cooldown acquire
2.        (if reply != 'OK' → OTP_COOLDOWN_ACTIVE; remainingSeconds from TTL on that key)
3. SETEX notification:otp:{purpose}:{h} {ttl} {json}
4.        (on delivery failure → DEL both keys, then rethrow — no lockout, no orphan)
```

**OTP verification (one atomic EVAL):**

```
EVAL consumeAttempt.lua 1 notification:otp:{purpose}:{h} {now}
  → inside the script: GET → expiry check → maxAttempts check → INCR attempts → SET ... PX {remaining}
  → returns { status: 'not_found' | 'max_attempts' | 'ok', entry }
(service then constant-time-compares the code; on success marks validated via SET ... KEEPTTL XX)
```

**OTP consumption:**

```
1. DEL notification:otp:{purpose}:{h}
2. DEL notification:otp_cd:{purpose}:{h}      (clearCooldown — lets a cancelled flow restart at once)
```

### 10.5 Performance considerations

- All operations are **O(1)** — `GET`, `SET`, `SETEX`, `DEL`, `TTL`, `PTTL`, and a single-key `EVAL`
- Verification uses **one small Lua script** (`consumeAttempt`) so the attempt counter's
  read-modify-write is atomic; cooldown acquisition uses `SET NX EX`. Both are required for the
  `maxAttempts` / anti-resend guarantees to hold under concurrency — a plain `GET`+`SET` would race.
- **SHA-256 hashing** happens on CPU (synchronous, fast — < 1µs)
- Redis's natural TTL ensures cleanup — **there is no manual GC**

### 10.6 Trade-off: Redis SET vs Redis Hash

A hand-rolled notification module commonly uses SET with JSON. We keep the pattern because:

- Simplifies `SET ... XX` for conditional upsert
- There is no field-by-field access (we always read/write the entire entry)
- HSET would have equivalent cost in low-medium volume

If the consumer needs extreme performance with 10k+ ops/s, they can implement `IOtpStorage` with custom pipelines/scripts.

---

## 11. Error Codes Catalog

### 11.1 `NotificationException` class

```typescript
import { HttpException, HttpStatus } from '@nestjs/common'

/**
 * Standardized exception of the notification module.
 * All exceptions follow the same response format.
 */
export class NotificationException extends HttpException {
  constructor(
    code: string,
    statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
    details?: Record<string, unknown>,
  ) {
    super(
      {
        error: {
          code,
          message: NOTIFICATION_ERROR_MESSAGES[code] || 'Notification error',
          details: details || null,
        },
      },
      statusCode,
    )
  }
}
```

### 11.2 Complete codes table

| Code | HTTP Status | Message | Context |
|---|---|---|---|
| `notification.email_provider_not_configured` | 500 | Email provider not configured | Call to EmailService without having configured `email.provider` |
| `notification.email_send_failed` | 502 | Failed to send email | Provider returned error (network, credential, quota) |
| `notification.email_attachments_too_large` | 413 | Email attachments exceed size limit | Attachments total > provider's limit |
| `notification.email_invalid_recipient` | 400 | Invalid recipient email | Invalid format (client-side validation recommended) |
| `notification.template_not_found` | 500 | Email template not found | Template name/locale not registered in the renderer |
| `notification.template_render_failed` | 500 | Failed to render email template | Renderer threw error (Handlebars syntax, etc.) |
| `notification.otp_storage_not_configured` | 500 | OTP storage not configured | Call to OtpService without having configured `otp.storage` |
| `notification.otp_email_delivery_not_configured` | 500 | OTP email delivery requested but email channel not configured | `generate({ deliverVia: 'email' })` while no `email` channel is configured |
| `notification.otp_cooldown_active` | 429 | Resend cooldown is active | `getCooldown()` returned > 0; response should include `Retry-After` |
| `notification.otp_not_found` | 404 | OTP not found or expired | `storage.get()` returned null |
| `notification.otp_expired` | 410 | OTP code expired | Entry found but `expiresAt < Date.now()` |
| `notification.otp_max_attempts_exceeded` | 429 | Maximum OTP attempts exceeded | `entry.attempts >= entry.maxAttempts` |
| `notification.otp_invalid_code` | 401 | Invalid OTP code | Code does not match; but attempts still remaining |
| `notification.otp_invalid_length` | 400 | Invalid OTP length config | Initialization error — `defaultLength` outside [1, 32] |
| `notification.sms_provider_not_configured` | 500 | SMS provider not configured | v0.2 |
| `notification.sms_send_failed` | 502 | Failed to send SMS | v0.2 |
| `notification.sms_invalid_recipient` | 400 | Invalid phone number | v0.2 — non-E.164 format |
| `notification.push_provider_not_configured` | 500 | Push provider not configured | v0.2 |
| `notification.push_send_failed` | 502 | Failed to send push notification | v0.2 |
| `notification.audit_log_failed` | 500 | Audit log write failed | Only propagated if `audit.swallowErrors: false` |
| `notification.channel_disabled` | 501 | Channel not enabled in module config | Call to disabled channel (e.g., `notification.dispatch({ channel: 'sms', ... })` without `sms` configured) |

### 11.3 Error response format

Identical to `@bymax-one/nest-auth`:

```json
{
  "error": {
    "code": "notification.otp_cooldown_active",
    "message": "Resend cooldown is active",
    "details": {
      "remainingSeconds": 47
    }
  }
}
```

### 11.4 Code constants

```typescript
export const NOTIFICATION_ERROR_CODES = {
  EMAIL_PROVIDER_NOT_CONFIGURED: 'notification.email_provider_not_configured',
  EMAIL_SEND_FAILED: 'notification.email_send_failed',
  EMAIL_ATTACHMENTS_TOO_LARGE: 'notification.email_attachments_too_large',
  EMAIL_INVALID_RECIPIENT: 'notification.email_invalid_recipient',
  TEMPLATE_NOT_FOUND: 'notification.template_not_found',
  TEMPLATE_RENDER_FAILED: 'notification.template_render_failed',
  OTP_STORAGE_NOT_CONFIGURED: 'notification.otp_storage_not_configured',
  OTP_EMAIL_DELIVERY_NOT_CONFIGURED: 'notification.otp_email_delivery_not_configured',
  OTP_COOLDOWN_ACTIVE: 'notification.otp_cooldown_active',
  OTP_NOT_FOUND: 'notification.otp_not_found',
  OTP_EXPIRED: 'notification.otp_expired',
  OTP_MAX_ATTEMPTS_EXCEEDED: 'notification.otp_max_attempts_exceeded',
  OTP_INVALID_CODE: 'notification.otp_invalid_code',
  OTP_INVALID_LENGTH: 'notification.otp_invalid_length',
  SMS_PROVIDER_NOT_CONFIGURED: 'notification.sms_provider_not_configured',
  SMS_SEND_FAILED: 'notification.sms_send_failed',
  SMS_INVALID_RECIPIENT: 'notification.sms_invalid_recipient',
  PUSH_PROVIDER_NOT_CONFIGURED: 'notification.push_provider_not_configured',
  PUSH_SEND_FAILED: 'notification.push_send_failed',
  AUDIT_LOG_FAILED: 'notification.audit_log_failed',
  CHANNEL_DISABLED: 'notification.channel_disabled',
} as const
```

### 11.5 Security principles in errors

1. **Never expose OTP code in error** — even in `OTP_INVALID_CODE`, do not return the expected `code` in `details`.
2. **Do not distinguish "OTP does not exist" from "OTP expired" in external responses** (ideally) — but the lib returns distinct values for internal use via `OtpVerifyResult.reason`. The consumer's controller should merge `not_found` and `expired` into a single message for the end client.
3. **`Retry-After` on 429** — when `OTP_COOLDOWN_ACTIVE` or `OTP_MAX_ATTEMPTS_EXCEEDED`, the consumer must map `details.remainingSeconds` to the HTTP header.
4. **Provider error message not directly exposed to client** — in `EMAIL_SEND_FAILED`, the technical message goes to `auditLog` and Logger. The client receives only "Failed to send email".

---

## 12. What Is NOT In the Package

Clear limits to avoid feature creep:

| Item | Why not | Where to implement |
|---|---|---|
| **Prisma schemas / migrations** | The lib is DB-agnostic. We distribute fragments in `docs/schemas/` as reference. | Consumer application schema |
| **Hardcoded HTML templates** | Templates are design opinions — vary by brand, locale, device. | Application's `IEmailTemplateRenderer` |
| **In-app inbox / notification center UI** | This is an application feature (Chakra/Material/etc.), not a backend lib. | UI library of consumer's choice |
| **User notification preferences UI** | Idem — UI/UX is app-level. | Consumer application |
| **Notification preferences storage** | This is business logic (which channels the user accepts, days/hours, etc.). | Consumer application |
| **Internationalization of error messages** | Error strings are in English. Translation is the UI layer's responsibility. | Application frontend |
| **Future notification scheduling** | This is the scope of `@bymax-one/nest-queue` (BullMQ jobs). | Job on the queue + calls `notification.dispatch()` in the worker |
| **Webhook handlers** (Resend webhook, Twilio status callbacks, FCM delivery receipts) | Each provider has its own format — scope of each application. | Dedicated controller in the consumer |
| **Open/click analysis/tracking** | Already offered by providers (Resend, SendGrid). | Provider's analytics UI |
| **Send deduplication** (don't send the same email 2x in 1h) | Application-specific. | Consumer application's business logic |
| **Failover between providers** | Added in v0.3 (multi-provider). For now, switch via redeploy. | Lib v0.3 |
| **Ready-made HTTP DTOs + Controllers** (e.g., `POST /notifications/otp/send`) | Each app has its own routes. We distribute DTOs in `dto/` for optional use. | Consumer application controllers |
| **Email/phone validation** | Use `class-validator` in the consumer application (`@IsEmail`, `@IsPhoneNumber`). | Application DTOs |
| **OAuth/JWT/MFA** | Auth is `@bymax-one/nest-auth`. This lib only sends OTPs — does not verify TOTP MFA or issue tokens. | `@bymax-one/nest-auth` |

---

## 13. Dependencies

### 13.1 Peer dependencies (server subpath)

| Package | Version | Reason |
|---|---|---|
| `@nestjs/common` | `^11.0.0` | Framework core — decorators, providers, exceptions |
| `@nestjs/core` | `^11.0.0` | DI container, module system |
| `reflect-metadata` | `^0.2.0` | Metadata for decorators |

### 13.2 Optional peer dependencies (server subpath)

Needed only if the consumer uses the corresponding reference provider:

| Package | Version | When required |
|---|---|---|
| `ioredis` | `^5.0.0` | If using `RedisOtpStorage` (default OTP storage) |
| `resend` | `^4.0.0` | If using `ResendEmailProvider` |
| `@sendgrid/mail` | `^8.0.0` | If using SendGridProvider (custom adapter) |
| `@aws-sdk/client-ses` | `^3.0.0` | If using SesProvider |
| `@aws-sdk/client-sns` | `^3.0.0` | If using SnsSmsProvider (v0.2) |
| `mailgun.js` | `^11.0.0` | If using MailgunProvider |
| `nodemailer` | `^7.0.0` | If using NodemailerSmtpProvider |
| `twilio` | `^5.0.0` | If using TwilioSmsProvider (v0.2) |
| `firebase-admin` | `^13.0.0` | If using FcmPushProvider (v0.2) |
| `@aws-sdk/client-dynamodb` | `^3.0.0` | If using DynamoDbOtpStorage |
| `handlebars` | `^4.0.0` | If using HandlebarsTemplateRenderer |
| `@react-email/render` | `^1.0.0` | If using ReactEmailTemplateRenderer |
| `mjml` | `^4.0.0` | If using MjmlTemplateRenderer |
| `class-validator` | `^0.14.0 \|\| ^0.15.0` | If using distributed DTOs (optional — consumer decides) |
| `class-transformer` | `^0.5.0` | Idem |
| `express` | `^5.0.0` | If using `tenantIdResolver` (receives `express.Request`) |
| `@types/express` | `^5.0.0` | Idem |

### 13.3 Dependencies

The lib has **zero direct dependencies** (`"dependencies": {}`). All external functionality is an optional peer dep. Crypto comes from `node:crypto` (native, Node 24+).

### 13.4 Peer deps per subpath

| Subpath | Mandatory peer deps | Optional peer deps |
|---|---|---|
| `.` (server) | `@nestjs/common`, `@nestjs/core`, `reflect-metadata` | All listed in §13.2 (as per chosen provider) |
| `./shared` | none | none |
| `./react` | `react ^19` | none |

### 13.5 `package.json` example

```json
{
  "name": "@bymax-one/nest-notification",
  "version": "0.1.0",
  "description": "Multi-channel notification library for NestJS — email, OTP, SMS, push — with pluggable providers and storage",
  "author": "Bymax One <support@bymax.one>",
  "license": "MIT",
  "homepage": "https://github.com/bymaxone/nest-notification#readme",
  "repository": { "type": "git", "url": "https://github.com/bymaxone/nest-notification.git" },
  "bugs": { "url": "https://github.com/bymaxone/nest-notification/issues" },
  "type": "module",
  "sideEffects": false,
  "files": ["dist", "LICENSE", "README.md", "CHANGELOG.md"],
  "exports": {
    ".": {
      "types": "./dist/server/index.d.ts",
      "import": "./dist/server/index.mjs",
      "require": "./dist/server/index.cjs"
    },
    "./shared": {
      "types": "./dist/shared/index.d.ts",
      "import": "./dist/shared/index.mjs",
      "require": "./dist/shared/index.cjs"
    },
    "./react": {
      "types": "./dist/react/index.d.ts",
      "import": "./dist/react/index.mjs",
      "require": "./dist/react/index.cjs"
    }
  },
  "scripts": {
    "build": "pnpm clean && tsup",
    "lint": "eslint src",
    "lint:fix": "eslint src --fix",
    "test": "jest",
    "test:cov": "jest --coverage",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config jest.e2e.config.ts",
    "test:all": "pnpm test && pnpm test:e2e",
    "test:cov:all": "jest --config jest.coverage.config.ts --coverage",
    "mutation": "stryker run",
    "mutation:incremental": "stryker run --incremental",
    "mutation:dry-run": "stryker run --dryRunOnly",
    "typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.server.json",
    "size": "node scripts/check-size.mjs",
    "clean": "rm -rf dist coverage",
    "prepublishOnly": "pnpm clean && pnpm typecheck && pnpm lint && pnpm test:cov:all && pnpm build",
    "release": "pnpm publish --provenance"
  },
  "peerDependencies": {
    "@nestjs/common": "^11.0.0",
    "@nestjs/core": "^11.0.0",
    "reflect-metadata": "^0.2.0",
    "ioredis": "^5.0.0",
    "resend": "^4.0.0",
    "@sendgrid/mail": "^8.0.0",
    "@aws-sdk/client-ses": "^3.0.0",
    "@aws-sdk/client-sns": "^3.0.0",
    "mailgun.js": "^11.0.0",
    "nodemailer": "^7.0.0",
    "twilio": "^5.0.0",
    "firebase-admin": "^13.0.0",
    "@aws-sdk/client-dynamodb": "^3.0.0",
    "handlebars": "^4.0.0",
    "@react-email/render": "^1.0.0",
    "mjml": "^4.0.0",
    "class-validator": "^0.14.0 || ^0.15.0",
    "class-transformer": "^0.5.0",
    "express": "^5.0.0",
    "@types/express": "^5.0.0",
    "react": "^19.0.0"
  },
  "peerDependenciesMeta": {
    "ioredis": { "optional": true },
    "resend": { "optional": true },
    "@sendgrid/mail": { "optional": true },
    "@aws-sdk/client-ses": { "optional": true },
    "@aws-sdk/client-sns": { "optional": true },
    "mailgun.js": { "optional": true },
    "nodemailer": { "optional": true },
    "twilio": { "optional": true },
    "firebase-admin": { "optional": true },
    "@aws-sdk/client-dynamodb": { "optional": true },
    "handlebars": { "optional": true },
    "@react-email/render": { "optional": true },
    "mjml": { "optional": true },
    "class-validator": { "optional": true },
    "class-transformer": { "optional": true },
    "express": { "optional": true },
    "@types/express": { "optional": true },
    "react": { "optional": true }
  },
  "keywords": [
    "nestjs", "notification", "email", "otp", "sms", "push",
    "resend", "sendgrid", "ses", "twilio", "fcm", "multi-tenant",
    "redis", "transactional", "saas"
  ],
  "packageManager": "pnpm@10.8.1",
  "engines": { "node": ">=24.0.0" },
  "publishConfig": { "access": "public", "registry": "https://registry.npmjs.org/" }
}
```

---

## 14. Implementation Phases

> **Strategy:** Unit tests written alongside each phase (TDD), not accumulated. Per the Bymax testing standard, each implemented file reaches **100% line/branch coverage** before advancing, with mutation score **≥ 95% (Stryker break 95), targeting 100%**, gating the release (§14.6).

### 14.1 Overview

| Phase | Complexity | Focus | Deliverables |
|---|---|---|---|
| 1 | MEDIUM | Foundation: Email channel + reference provider | Scaffold, interfaces, ResendProvider, NoOpEmailProvider, EmailService, DefaultTemplateRenderer + tests |
| 2 | MEDIUM | OTP channel + storage | OtpService, RedisOtpStorage, InMemoryOtpStorage, code-generator, cooldown, audit log integration + tests |
| 3 | MEDIUM | Templating + audit log | Refinement of DefaultTemplateRenderer (i18n, escape), audit interceptor, NotificationLogRepository contract + tests |
| 4 | LOW | Subpath shared + React | Public types/constants, useOtpInput hook, useOtpCountdown + RTL tests |
| 5 | LOW | Polishing + release v0.1.0 | README, CHANGELOG, scripts/check-size.mjs, mutation testing, npm publish |

> **Execution by AI agents** — no estimates in human days/weeks. Fine granularity per sub-step stays in `docs/development_plan.md` (Appendix B — Complexity Matrix).

**v0.2 phases (after v0.1 stabilized):**

| Phase | Complexity | Focus |
|---|---|---|
| 6 | MEDIUM | SMS channel + TwilioSmsProvider, SnsSmsProvider |
| 7 | MEDIUM | Push channel + FcmPushProvider |
| 8 | LOW | Failover between providers + release v0.2.0 |

### 14.2 Phase 1 — Foundation + Email Channel

**Objective:** Establish the lib skeleton and implement the complete Email channel.

**Deliverables:**

1. **Project scaffold**
   - `package.json` with peer deps
   - `tsconfig.json`, `tsconfig.build.json`, `tsconfig.server.json`
   - Directory structure (`src/server/`, `src/shared/`, `src/react/`)
   - `tsup.config.ts` with 3 entries
   - Lint config (copy from `@bymax-one/nest-auth`)
   - CI workflows (`.github/workflows/*.yml`)

2. **Base interfaces**
   - `notification-module-options.interface.ts`
   - `email-provider.interface.ts`
   - `email-template-renderer.interface.ts`
   - `notification-log-repository.interface.ts`

3. **Configuration**
   - `bymax-notification.constants.ts` (injection tokens)
   - `config/default-options.ts`
   - `config/resolved-options.ts` (merge of opts with defaults)

4. **Errors**
   - `errors/notification-error-codes.ts`
   - `errors/notification-exception.ts`

5. **Reference providers**
   - `providers/resend-email.provider.ts`
   - `providers/no-op-email.provider.ts`
   - `providers/default-template-renderer.ts`
   - `providers/no-op-notification-log.repository.ts`

6. **Service**
   - `services/email.service.ts` (send, sendTemplate, isConfigured)
   - `services/notification.service.ts` (basic orchestrator — only getEmail for now)

7. **Dynamic module**
   - `bymax-notification.module.ts` (forRoot + forRootAsync, conditional registration)

8. **Unit tests**
   - `email.service.spec.ts`, `resend-email.provider.spec.ts`, `default-template-renderer.spec.ts`
   - Coverage: 100% on implemented files (Bymax standard)

### 14.3 Phase 2 — OTP Channel

**Objective:** Implement complete OTP (generate, verify, consume, resend, cooldown).

**Deliverables:**

1. **Interfaces**
   - `otp-storage.interface.ts` (OtpEntry, OtpVerifyResult, OtpGenerateOptions)

2. **Providers**
   - `providers/redis-otp.storage.ts` (with identifier hashing)
   - `providers/in-memory-otp.storage.ts`

3. **Service**
   - `services/otp.service.ts` (generate, verify, consume, resend, getStatus)
   - Integration with EmailService for `deliverVia: 'email'`

4. **Utils**
   - `utils/code-generator.ts` (`randomInt`-based, supports numeric/alpha/alphanumeric)
   - `utils/timing-safe-compare.ts`
   - `utils/hash.ts`

5. **Audit log integration**
   - OtpService calls `auditLog.create()` at all relevant points
   - Codes never included in the audit log

6. **Module wiring**
   - Update of `bymax-notification.module.ts` to register OtpService when configured

7. **Unit tests**
   - `otp.service.spec.ts`, `redis-otp.storage.spec.ts` (mock ioredis), `in-memory-otp.storage.spec.ts`, `code-generator.spec.ts`
   - Coverage: 100% on implemented files (code-generator and storages fully covered, incl. edge lengths)

### 14.4 Phase 3 — Templating + Audit Log

**Objective:** Refine templating (i18n fallback, XSS escape) and complete audit log.

**Deliverables:**

1. **DefaultTemplateRenderer**
   - Automatic fallback `pt-BR` → `en`
   - HTML escape in `{{var}}`
   - Support for text-only templates (without HTML)

2. **Audit interceptor**
   - `interceptors/notification-audit.interceptor.ts`
   - Intercepts calls to `dispatch()` of NotificationService for automatic logging
   - Uses `global.tenantIdResolver` if present

3. **NotificationLogEntry**
   - Refined type with `verb` discriminator
   - Validation in `NoOpNotificationLogRepository` (only in dev/test mode)

4. **Prisma schema fragment**
   - `docs/schemas/notification-log.prisma`

5. **Tests**
   - E2E tests for templating in various locales
   - Custom mock template renderer
   - Validation of generated audit log entries

### 14.5 Phase 4 — Shared + React Subpaths

**Objective:** Expose public types/constants and React hook for OTP UX.

**Deliverables:**

1. **Shared subpath**
   - `src/shared/index.ts`
   - Types: `OtpPurpose`, `NotificationChannel`, `NotificationErrorResponse`
   - Constants: `NOTIFICATION_ERROR_CODES`, `DEFAULT_TTLS`

2. **React subpath**
   - `src/react/useOtpInput.ts` — manages N digit input state, auto-focus, paste handler
   - `src/react/useOtpCountdown.ts` — reactive timer until `expiresAt`
   - Public types

3. **Build setup**
   - tsup.config.ts updated with 3 entries
   - Validation that `./shared` has zero deps in the end bundle
   - `./react` marks `react` as external

4. **Tests**
   - RTL tests for `useOtpInput`, `useOtpCountdown`
   - Smoke test of the `./shared` export

### 14.6 Phase 5 — Release v0.1.0

**Objective:** Publish `0.1.0` on npm.

**Deliverables:**

1. README with badges, quick start, complete examples
2. CHANGELOG `0.1.0` entry
3. SECURITY.md (disclosure policy)
4. CLAUDE.md, AGENTS.md (quick reference for AI agents)
5. Mutation testing — Stryker dry run + mutation score **≥ 95% (break 95), as close to 100% as achievable**; document any equivalent mutants inline
6. `scripts/check-size.mjs` (limit: 80KB gzipped per subpath)
7. CodeQL clean
8. OpenSSF Scorecard ≥ 7.0
9. npm publish with `--provenance`

---

## 15. Known Limitations

| Limitation | Workaround | v0.2+ plan |
|---|---|---|
| **No failover between providers** | Switch provider via redeploy. For HA, use multiple instances of the lib with different providers in different containers. | v0.3 — `MultiProviderEmailProvider` that tries primary, fails over |
| **No future notification scheduling** | Use `@bymax-one/nest-queue` (BullMQ) to schedule jobs that call `notification.dispatch()`. | Not planned — correct scope is the queues lib |
| **No inbox / preferences UI** | Implement in the consumer application. | Not planned — scope is the application |
| **No embedded HTML templates** | Consumer registers templates in `IEmailTemplateRenderer`. We distribute canonical examples in `docs/templates/`. | Companion lib `@bymax-one/notification-templates` with ready-made Tailwind/MJML templates |
| **No send deduplication** | Consumer implements via Redis key with TTL. | Not planned — application scope |
| **No webhook handlers** (Resend events, Twilio status callbacks) | Consumer implements a dedicated controller. | Not planned — formats vary too much by provider |
| **No retry with exponential backoff** within EmailService | Configure on the provider (Resend has retry); or use BullMQ via `@bymax-one/nest-queue` to re-enqueue on failure. | Not planned — providers already do retry, or queue is used |
| **OTP only supports numeric/alpha/alphanumeric** | For other formats (UUID, hex), use the interface directly: pass an externally generated code via an internal call. | Not planned — these 3 cover 99% of cases |
| **OTP delivery is `email` or `manual` in v0.1** | For SMS-delivered OTP (2FA), call `generate({ deliverVia: 'manual' })` then send the returned code via your own `ISmsProvider`. | v0.2 — `deliverVia: 'sms'` lands with the SMS channel |
| **No global rate limit per tenant** (only cooldown per (tenant, recipient, purpose)) | Use `@nestjs/throttler` with custom key based on tenantId. | Consider `tenantRateLimits` in v0.2 |
| **`InMemoryOtpStorage` does not share state between instances** | Documented — use only in dev/test. | Not planned — for shared state use `RedisOtpStorage` (a Memcached adapter could be added later) |
| **i18n hardcoded fallback to 'en'** | For other fallbacks, implement custom `IEmailTemplateRenderer`. | Configurable via `email.fallbackLocale` in v0.2 |
| **No ready-made health check endpoint** | Consumer can call `emailProvider.isConfigured()` and `otpStorage.isConfigured()` in its own health route. | Consider exporting `NotificationHealthIndicator` for `@nestjs/terminus` in v0.2 |

---

## 16. Frontend Integration

### 16.1 `./shared` subpath

Types and constants shared between backend and frontend with **zero external dependencies**.

**Exports:**

```typescript
// Discriminated union for known purposes
export type OtpPurpose =
  | 'email_verification'
  | 'password_reset'
  | 'mfa_oob'
  | 'phone_verification'   // SMS-delivered OTP — needs the SMS channel (v0.2) or manual delivery
  | 'magic_link'           // long token delivered as a URL via emailData.verificationLink, not a short code
  | (string & {})          // allows custom purposes

// Channels
export type NotificationChannel = 'email' | 'otp' | 'sms' | 'push'

// Standardized error response (same as backend)
export interface NotificationErrorResponse {
  error: {
    code: string  // key of NOTIFICATION_ERROR_CODES
    message: string
    details: Record<string, unknown> | null
  }
}

// Error codes (same const as backend)
export const NOTIFICATION_ERROR_CODES = { /* ... */ } as const

// Default TTLs (informative)
export const DEFAULT_TTLS = {
  OTP_EMAIL_VERIFICATION_SECONDS: 3600,
  OTP_PASSWORD_RESET_SECONDS: 600,
  OTP_MFA_OOB_SECONDS: 300,
  RESEND_COOLDOWN_SECONDS: 60,
} as const
```

### 16.2 `./react` subpath — `useOtpInput` hook

Complete OTP entry UX — manages N separate 1-digit inputs, automatic focus, paste handler, length validation.

```typescript
import { useOtpInput } from '@bymax-one/nest-notification/react'

interface UseOtpInputOptions {
  /** Code length (default: 6) */
  length?: number

  /** Input type ('numeric' | 'alphanumeric' | 'alpha') (default: 'numeric') */
  type?: 'numeric' | 'alpha' | 'alphanumeric'

  /** Called when the complete code is typed */
  onComplete?: (code: string) => void

  /** Auto-submit when complete (default: true) */
  autoSubmit?: boolean

  /** Sanitizes paste (removes spaces, hyphens) (default: true) */
  sanitizeOnPaste?: boolean
}

interface UseOtpInputState {
  /** Array of values (1 char per slot) */
  values: string[]

  /** Setter for individual slot */
  setValue: (index: number, value: string) => void

  /** Handler for input change — expects React event */
  onChange: (index: number) => (e: React.ChangeEvent<HTMLInputElement>) => void

  /** Handler for keydown (handles Backspace, ArrowLeft/Right) */
  onKeyDown: (index: number) => (e: React.KeyboardEvent<HTMLInputElement>) => void

  /** Handler for paste — distributes chars between slots */
  onPaste: (e: React.ClipboardEvent<HTMLInputElement>) => void

  /** Refs for each input — caller spreads to ref={refs[i]} */
  refs: Array<React.RefObject<HTMLInputElement>>

  /** Programmatic reset */
  reset: () => void

  /** Complete code (joined) */
  code: string

  /** Whether it's complete (all slots filled) */
  isComplete: boolean
}

function useOtpInput(options?: UseOtpInputOptions): UseOtpInputState
```

**Usage example:**

```tsx
import { useOtpInput } from '@bymax-one/nest-notification/react'

export function OtpForm({ onSubmit }: { onSubmit: (code: string) => Promise<void> }) {
  const otp = useOtpInput({
    length: 6,
    type: 'numeric',
    onComplete: async (code) => {
      await onSubmit(code)
    },
  })

  return (
    <form>
      <div className="flex gap-2">
        {otp.values.map((value, i) => (
          <input
            key={i}
            ref={otp.refs[i]}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={value}
            onChange={otp.onChange(i)}
            onKeyDown={otp.onKeyDown(i)}
            onPaste={i === 0 ? otp.onPaste : undefined}
            className="w-12 h-14 text-center text-2xl border rounded"
          />
        ))}
      </div>
      <button type="button" onClick={otp.reset}>Reset</button>
    </form>
  )
}
```

### 16.3 `./react` subpath — `useOtpCountdown` hook

Reactive countdown timer until the OTP's `expiresAt`.

```typescript
interface UseOtpCountdownOptions {
  /** Unix timestamp (ms) of expiration */
  expiresAt: number | null

  /** Update interval (ms). Default: 1000 */
  tickIntervalMs?: number

  /** Called when countdown reaches zero */
  onExpired?: () => void
}

interface UseOtpCountdownState {
  /** Seconds remaining (>= 0) */
  remainingSeconds: number

  /** Indicates if expired (remainingSeconds <= 0) */
  expired: boolean

  /** Formatted as "MM:SS" */
  formatted: string
}

function useOtpCountdown(options: UseOtpCountdownOptions): UseOtpCountdownState
```

**Combined example:**

```tsx
import { useOtpInput, useOtpCountdown } from '@bymax-one/nest-notification/react'

export function VerifyOtpScreen({ expiresAt, onVerify, onResend }: {
  expiresAt: number
  onVerify: (code: string) => Promise<void>
  onResend: () => Promise<void>
}) {
  const otp = useOtpInput({ length: 6, onComplete: onVerify })
  const countdown = useOtpCountdown({
    expiresAt,
    onExpired: () => alert('Code expired — request a new one'),
  })

  return (
    <div>
      <p>Time remaining: {countdown.formatted}</p>
      <OtpForm otp={otp} />
      <button onClick={onResend} disabled={!countdown.expired && countdown.remainingSeconds > 0}>
        Resend code
      </button>
    </div>
  )
}
```

> **Note:** The lib does not have an HTTP client subpath (like `@bymax-one/nest-auth/client`) because the call to `POST /api/notifications/otp/verify` is the consumer app's job — there is no standard "verify OTP via backend" flow that makes sense to universalize. The React hooks deal **only with state and UX**, agnostically.

---

## 17. Integrated Example: Complete Registration + OTP Flow

This example shows how the lib integrates into the complete registration + email verification flow with `@bymax-one/nest-auth`.

### 17.1 Backend — `app.module.ts`

```typescript
import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import {
  BymaxNotificationModule,
  ResendEmailProvider,
  RedisOtpStorage,
  DefaultTemplateRenderer,
} from '@bymax-one/nest-notification'
import { BymaxAuthModule } from '@bymax-one/nest-auth'

import { PrismaUserRepository } from './auth/prisma-user.repository'
import { PrismaNotificationLogRepository } from './notification/prisma-notification-log.repository'
import { RedisService } from './redis/redis.service'

// Template registry — in production, prefer Handlebars or React Email
const TEMPLATES = {
  'otp_code::pt-BR': {
    subject: 'Your verification code - {{appName}}',
    html: `
      <h1>Hello {{name}},</h1>
      <p>Your code is: <strong>{{code}}</strong></p>
      <p>Expires in {{expiresInMinutes}} minutes.</p>
    `,
  },
  'welcome::pt-BR': {
    subject: 'Welcome to {{appName}}!',
    html: `<h1>Hello {{name}},</h1><p>Your account has been activated.</p>`,
  },
}

@Module({
  imports: [
    ConfigModule.forRoot(),

    // 1. Configure the notification lib
    BymaxNotificationModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) => ({
        global: {
          redisNamespace: 'notification',
          defaultLocale: 'pt-BR',
        },
        email: {
          provider: new ResendEmailProvider({
            apiKey: config.getOrThrow('RESEND_API_KEY'),
          }),
          defaultFrom: 'noreply@myapp.com',
          defaultFromName: 'My App',
          templateRenderer: new DefaultTemplateRenderer({ templates: TEMPLATES }),
        },
        otp: {
          storage: new RedisOtpStorage({ redisClient: redis.getClient() }),
          defaultLength: 6,
          defaultTtlSeconds: 600,
          resendCooldownSeconds: 60,
          perPurpose: {
            email_verification: { ttlSeconds: 3600 },  // 1h
            password_reset: { ttlSeconds: 600 },       // 10m
          },
        },
        audit: {
          repository: new PrismaNotificationLogRepository(),
          swallowErrors: true,
        },
      }),
    }),

    // 2. Configure @bymax-one/nest-auth
    BymaxAuthModule.registerAsync({
      // ... auth config — note that it does NOT use IEmailProvider directly
      // Auth calls hooks our app implements, and our hooks delegate to EmailService/OtpService
    }),
  ],
})
export class AppModule {}
```

### 17.2 Backend — `registration.controller.ts`

```typescript
import { Controller, Post, Body, BadRequestException } from '@nestjs/common'
import { OtpService, EmailService, NotificationException, NOTIFICATION_ERROR_CODES } from '@bymax-one/nest-notification'
import { AuthService } from '@bymax-one/nest-auth'

@Controller('auth')
export class RegistrationController {
  constructor(
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Registration:
   * 1. Creates the user (status PENDING_VERIFICATION) via authService
   * 2. Generates email verification OTP
   * 3. Sends email with OTP
   * 4. Returns { expiresAt } for the frontend to display countdown
   */
  @Post('register')
  async register(@Body() dto: { email: string; password: string; name: string; tenantId: string }) {
    // Creates user with pending status
    const user = await this.authService.register(dto)

    // Generates OTP and sends email
    const { expiresAt } = await this.otpService.generate({
      tenantId: dto.tenantId,
      recipient: dto.email,
      purpose: 'email_verification',
      deliverVia: 'email',
      emailTemplate: 'otp_code',
      emailData: { name: dto.name, appName: 'My App' },
      locale: 'pt-BR',
      userId: user.id,
    })

    return { userId: user.id, expiresAt }
  }

  /**
   * Verifies email OTP + activates user + sends welcome.
   */
  @Post('verify-email')
  async verifyEmail(@Body() dto: { email: string; code: string; tenantId: string }) {
    const result = await this.otpService.verify({
      tenantId: dto.tenantId,
      recipient: dto.email,
      purpose: 'email_verification',
      code: dto.code,
    })

    if (!result.valid) {
      // Maps reason to HTTP status / message (not_found also covers expired — see §11.5)
      switch (result.reason) {
        case 'not_found':
          throw new NotificationException(NOTIFICATION_ERROR_CODES.OTP_NOT_FOUND, 404)
        case 'max_attempts':
          throw new NotificationException(NOTIFICATION_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED, 429)
        case 'invalid_code':
          throw new NotificationException(
            NOTIFICATION_ERROR_CODES.OTP_INVALID_CODE,
            401,
            { remainingAttempts: result.remainingAttempts }
          )
      }
    }

    // Valid OTP — activates user
    const user = await this.authService.markEmailVerified(dto.email, dto.tenantId)

    // Consumes (deletes) the OTP
    await this.otpService.consume({
      tenantId: dto.tenantId,
      recipient: dto.email,
      purpose: 'email_verification',
      userId: user.id,
    })

    // Sends welcome email (fire-and-forget — does not block if it fails)
    this.emailService.sendTemplate({
      tenantId: dto.tenantId,
      to: dto.email,
      template: 'welcome',
      data: { name: user.name, appName: 'My App' },
      locale: 'pt-BR',
      userId: user.id,
    }).catch(() => {})

    return { activated: true }
  }

  /**
   * OTP resend — protected by cooldown automatically.
   */
  @Post('resend-verification')
  async resend(@Body() dto: { email: string; tenantId: string }) {
    try {
      const { expiresAt, cooldownSeconds } = await this.otpService.resend({
        tenantId: dto.tenantId,
        recipient: dto.email,
        purpose: 'email_verification',
        deliverVia: 'email',
        emailTemplate: 'otp_code',
        emailData: { appName: 'My App' },
      })
      return { expiresAt, cooldownSeconds }
    } catch (err) {
      if (err instanceof NotificationException) {
        // active cooldown, etc — propagates
        throw err
      }
      throw new BadRequestException('Failed to resend code')
    }
  }
}
```

### 17.3 Frontend — `RegisterFlow.tsx`

```tsx
'use client'

import { useState } from 'react'
import { useOtpInput, useOtpCountdown } from '@bymax-one/nest-notification/react'
import { NOTIFICATION_ERROR_CODES } from '@bymax-one/nest-notification/shared'

export function VerifyEmailScreen({
  email,
  tenantId,
  initialExpiresAt,
}: {
  email: string
  tenantId: string
  initialExpiresAt: number
}) {
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const otp = useOtpInput({
    length: 6,
    type: 'numeric',
    onComplete: async (code) => {
      setError(null)
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, tenantId }),
      })
      if (res.ok) {
        setSuccess(true)
      } else {
        const json = await res.json()
        if (json.error?.code === NOTIFICATION_ERROR_CODES.OTP_INVALID_CODE) {
          setError(`Invalid code. ${json.error.details.remainingAttempts} attempts remaining.`)
        } else if (
          json.error?.code === NOTIFICATION_ERROR_CODES.OTP_NOT_FOUND ||
          json.error?.code === NOTIFICATION_ERROR_CODES.OTP_EXPIRED
        ) {
          setError('Code expired or not found. Request a new one.')
        } else {
          setError('Error verifying code.')
        }
        otp.reset()
      }
    },
  })

  const countdown = useOtpCountdown({
    expiresAt,
    onExpired: () => setError('Code expired. Request a new one.'),
  })

  async function handleResend() {
    setError(null)
    const res = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, tenantId }),
    })
    if (res.ok) {
      const { expiresAt } = await res.json()
      setExpiresAt(expiresAt)
      otp.reset()
    } else {
      const json = await res.json()
      if (json.error?.code === NOTIFICATION_ERROR_CODES.OTP_COOLDOWN_ACTIVE) {
        setError(`Wait ${json.error.details.remainingSeconds}s to resend.`)
      } else {
        setError('Error resending.')
      }
    }
  }

  if (success) {
    return <div>Email verified successfully! Redirecting…</div>
  }

  return (
    <div>
      <h2>Verify your email</h2>
      <p>We sent a code to <strong>{email}</strong></p>
      <p>Expires in: <strong>{countdown.formatted}</strong></p>

      <div className="flex gap-2 my-4">
        {otp.values.map((value, i) => (
          <input
            key={i}
            ref={otp.refs[i]}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={1}
            value={value}
            onChange={otp.onChange(i)}
            onKeyDown={otp.onKeyDown(i)}
            onPaste={i === 0 ? otp.onPaste : undefined}
            className="w-12 h-14 text-center text-2xl border rounded"
          />
        ))}
      </div>

      {error && <p className="text-red-600">{error}</p>}

      <button onClick={handleResend} disabled={countdown.remainingSeconds > 540}>
        Resend code
      </button>
    </div>
  )
}
```

### 17.4 Flow summary

| Step | Actor | Operation | State |
|---|---|---|---|
| 1 | Frontend | Submits `POST /auth/register` with email/password/name | — |
| 2 | Backend | `authService.register()` → creates user with `status=PENDING_VERIFICATION` | User created |
| 3 | Backend | `otpService.generate()` → generates OTP, saves to Redis (`notification:otp:email_verification:{h}`), sends email via Resend | OTP in Redis |
| 4 | Backend | Audit log: `verb='generated' channel='otp'` + `verb='sent' channel='email'` | Audit logs recorded |
| 5 | Backend | Returns `{ expiresAt }` to the frontend | — |
| 6 | Frontend | Renders `VerifyEmailScreen` with countdown via `useOtpCountdown(expiresAt)` | — |
| 7 | User | Receives email, types 6-digit code | — |
| 8 | Frontend | `useOtpInput.onComplete(code)` → submits `POST /auth/verify-email` | — |
| 9 | Backend | `otpService.verify()` → `storage.consumeAttempt()` (atomic increment), then constant-time code compare | — |
| 10 | Backend | If valid: `authService.markEmailVerified()`, `otpService.consume()`, `emailService.sendTemplate('welcome')` (fire-and-forget) | User active, OTP deleted |
| 11 | Backend | Audit log: `verb='verified'` + `verb='sent'` (welcome) | Audit logs recorded |
| 12 | Frontend | Shows "Success", redirects to login | — |

In case the user wants to resend:

| Step | Actor | Operation | State |
|---|---|---|---|
| R1 | Frontend | Clicks "Resend code" → `POST /auth/resend-verification` | — |
| R2 | Backend | `otpService.resend()` → checks `storage.getCooldown()` | Active cooldown? |
| R3a | Backend | If cooldown active: throws `OTP_COOLDOWN_ACTIVE` with `remainingSeconds` | — |
| R3b | Backend | If cooldown expired: generates new OTP, overwrites in Redis, sends email, activates new cooldown | OTP updated |

---

_End of the technical specification of `@bymax-one/nest-notification`._
