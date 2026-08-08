<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--notification-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="@bymax-one/nest-notification" />
</p>

<h1 align="center">@bymax-one/nest-notification</h1>

<p align="center">
  <strong>Transactional notification for NestJS & React</strong><br />
  <sub>Email · OTP · Multi-Tenant · Pluggable Providers · Prisma-Free · Zero Runtime Dependencies</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-notification"><img src="https://img.shields.io/npm/v/@bymax-one/nest-notification?style=flat-square&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-notification"><img src="https://img.shields.io/npm/dm/@bymax-one/nest-notification?style=flat-square&colorA=000000&colorB=000000" alt="npm downloads" /></a>
  <a href="https://github.com/bymaxone/nest-notification/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bymaxone/nest-notification/ci.yml?branch=main&style=flat-square&colorA=000000&label=CI" alt="CI status" /></a>
  <a href="https://github.com/bymaxone/nest-notification/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&colorA=000000" alt="coverage" /></a>
  <a href="https://github.com/bymaxone/nest-notification/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-100.00%25-brightgreen?style=flat-square&colorA=000000" alt="mutation score" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/bymaxone/nest-notification"><img src="https://api.scorecard.dev/projects/github.com/bymaxone/nest-notification/badge?style=flat-square" alt="OpenSSF Scorecard" /></a>
  <a href="https://github.com/bymaxone/nest-notification/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bymaxone/nest-notification?style=flat-square&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="https://github.com/bymaxone/nest-notification">GitHub</a> ·
  <a href="https://github.com/bymaxone/nest-notification/issues">Issues</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-api-reference">API Reference</a> ·
  <a href="https://github.com/bymaxone/nest-notification-example">Example App</a>
</p>

---

## ✨ Overview

`@bymax-one/nest-notification` is a **transactional notification library for NestJS 11** that ships two channels — **email** and **OTP** (one-time passwords) — behind a single dynamic module, plus a React subpath for the OTP input box.

Everything that touches the outside world — the email transport, the OTP store, the template renderer, the audit sink — is an **interface** you implement or pick from the bundled reference adapters. The same module runs on Resend or SendGrid, on Redis or an in-memory map, with a Prisma audit log or none at all, without changing a single call site.

### Why nest-notification?

- **🔌 Your database, your provider** — The library defines the contracts (`IEmailProvider`, `IOtpStorage`, `IEmailTemplateRenderer`, `INotificationLogRepository`). You supply the implementations. It **never imports `@prisma/client`** or any other ORM — a CI gate fails the build if one appears — so a cross-cutting concern never hard-wires your schema.
- **🏢 Multi-tenant from the first line** — Every operation is scoped by `tenantId`, store keys are `sha256(tenantId:recipient)`, and the audit interceptor resolves the trusted tenant from the request rather than the request body.
- **🔒 Native crypto only** — Codes come from `crypto.randomInt` and are compared with `crypto.timingSafeEqual`. No `crypto-js`, no `otpauth`, no `uuid`, no `nanoid` — the most security-sensitive path carries no third-party supply-chain risk.
- **⚛️ Atomic by construction** — The attempt counter and the resend cooldown are mutated **inside the storage** (Redis Lua / `SET NX EX`), never by a service-side read-then-write. A `get` + `update` pair races, and the race is exactly how a max-attempts ceiling gets bypassed under concurrent requests.
- **🪶 Pay for what you use** — `"dependencies": {}`. NestJS, your email SDK, your Redis client, and React are all peer dependencies, and only the channels you configure are registered in the container.

```
pnpm add @bymax-one/nest-notification
```

---

## 🔥 Features

### 📧 Email

- ✅ **Pluggable transport** — `IEmailProvider` with a bundled `ResendEmailProvider` and a `NoOpEmailProvider` for dev/test that logs subject and recipient only, never the body
- ✅ **Template rendering** — `IEmailTemplateRenderer` with a bundled `{{var}}` renderer that **HTML-escapes** interpolated values in the HTML body
- ✅ **Canonical template names** — `CANONICAL_EMAIL_TEMPLATES` so providers and templates agree on the wire
- ✅ **Attachment guard** — a configurable total size ceiling (10 MiB by default) rejected before the provider is called

### 🔢 OTP

- ✅ **CSPRNG codes** — `numeric` / `alpha` / `alphanumeric`, built character by character from `crypto.randomInt` so every position is uniform
- ✅ **TTL + max attempts** — with the counter spent atomically inside the storage
- ✅ **Atomic resend cooldown** — acquired with `SET NX EX` and released only on delivery failure, so two concurrent resends cannot both win
- ✅ **Constant-time verification** — `crypto.timingSafeEqual`, never `===`
- ✅ **Per-purpose overrides** — length, code type, TTL, attempts, and cooldown tuned per purpose (a password reset is not an email verification)
- ✅ **Optional email delivery** — hand the code to the email channel, or take it and deliver it yourself

### 🏢 Multi-Tenant & Audit

- ✅ **SHA-256 storage keys** — `sha256(tenantId:recipient)`: no recipient PII in a key, no cross-tenant collision
- ✅ **`tenantIdResolver`** — the audited tenant comes from a trusted source (a JWT claim, a subdomain, a gateway-checked header), not the payload
- ✅ **Opt-in audit log** — a fire-and-forget `INotificationLogRepository` plus a `NotificationAuditInterceptor`; audit failures never break delivery
- ✅ **Codes are never logged** — not to a logger, not to an audit entry, not into an error message, enforced by a regression test

### 🧩 Developer Experience

- ✅ **Three subpaths** — server, zero-dependency shared types, and React hooks
- ✅ **Stable error catalog** — 22 namespaced codes shared byte-for-byte between server and frontend, so you localize on the `code`
- ✅ **Dual-format output** — ESM + CJS + declarations for both, verified against the packed tarball on every PR
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

One package, three entry points — import only what your app needs:

| Subpath    | Import                                | Purpose                                            |               Peer deps                |
| ---------- | ------------------------------------- | -------------------------------------------------- | :------------------------------------: |
| **Server** | `@bymax-one/nest-notification`        | NestJS module, services, providers, errors, tokens | NestJS 11 (+ your provider/store SDKs) |
| **Shared** | `@bymax-one/nest-notification/shared` | Types + constants (error codes, TTLs)              |                  None                  |
| **React**  | `@bymax-one/nest-notification/react`  | `useOtpInput` + `useOtpCountdown` (UX/state only)  |                React 19                |

```
shared (zero deps)
  ↗            ↖
server        react
```

`shared` is independent, `react` depends only on `react`, and `server` is independent — importing one never drags in another's peers. Every subpath ships ESM (`.mjs`), CJS (`.cjs`), and declarations for both formats (`.d.ts` + `.d.cts`).

---

> [!TIP]
> Prefer to learn from a working app? See the [nest-notification-example](https://github.com/bymaxone/nest-notification-example) — a full NestJS project wired with this library.

## 🚀 Quick Start

### 1. Install

```bash
# Using pnpm (recommended)
pnpm add @bymax-one/nest-notification

# Using npm
npm install @bymax-one/nest-notification

# Using yarn
yarn add @bymax-one/nest-notification
```

> [!IMPORTANT]
> You must also install the **peer dependencies** for the subpaths and channels you use:

```bash
# Server subpath (required)
pnpm add @nestjs/common @nestjs/core reflect-metadata rxjs

# Production email + OTP over Redis (optional — pick your own provider/store)
pnpm add resend ioredis

# React subpath (optional)
pnpm add react
```

> [!NOTE]
> Requires Node.js **24+** and NestJS **11**. Every provider and storage SDK is an _optional_ peer dependency: install only the ones your configuration actually names.

### 2. Development — `NoOpEmailProvider` + `InMemoryOtpStorage`

No external services. Emails are logged (subject and recipient only, never the body), and OTP state lives in process memory. Ideal for local dev and tests.

```typescript
import { Module } from '@nestjs/common'
import {
  BymaxNotificationModule,
  NoOpEmailProvider,
  InMemoryOtpStorage
} from '@bymax-one/nest-notification'

@Module({
  imports: [
    BymaxNotificationModule.forRoot({
      email: {
        provider: new NoOpEmailProvider(),
        defaultFrom: 'no-reply@dev.local'
      },
      otp: {
        storage: new InMemoryOtpStorage(),
        defaultLength: 6,
        defaultTtlSeconds: 600,
        defaultMaxAttempts: 5,
        resendCooldownSeconds: 60
      }
    })
  ]
})
export class AppModule {}
```

Inject `OtpService` anywhere and the two-step flow is complete:

```typescript
import { Injectable } from '@nestjs/common'
import { OtpService } from '@bymax-one/nest-notification'

@Injectable()
export class VerificationService {
  constructor(private readonly otp: OtpService) {}

  /** Generate + deliver an email-verification OTP. */
  async start(tenantId: string, email: string): Promise<{ expiresAt: number }> {
    const { expiresAt } = await this.otp.generate({
      tenantId,
      recipient: email,
      purpose: 'email_verification',
      deliverVia: 'email'
    })
    return { expiresAt }
  }

  /** Verify a submitted code. */
  async confirm(tenantId: string, email: string, code: string): Promise<boolean> {
    const result = await this.otp.verify({
      tenantId,
      recipient: email,
      purpose: 'email_verification',
      code
    })
    return result.valid
  }
}
```

> [!NOTE]
> `generate()` returns only `expiresAt` and `cooldownSeconds` — never the code. Resolve the `tenantId` in your controller from a trusted source and pass it down; the service takes it as an explicit argument, so nothing is silently overridden.

### 3. Production — Resend + Redis

Real email via [Resend](https://resend.com) and OTP state in Redis (keys are SHA-256 hashed). Wire your `ioredis` client however your app already does.

```typescript
import { Module } from '@nestjs/common'
import Redis from 'ioredis'
import {
  BymaxNotificationModule,
  ResendEmailProvider,
  RedisOtpStorage,
  DefaultTemplateRenderer
} from '@bymax-one/nest-notification'

const redis = new Redis(process.env.REDIS_URL!)

@Module({
  imports: [
    BymaxNotificationModule.forRoot({
      global: {
        redisNamespace: 'notification',
        defaultLocale: 'en',
        // Trust the tenant from a gateway-verified header, not the request body.
        tenantIdResolver: (req) => String(req.headers['x-tenant-id'] ?? 'default')
      },
      email: {
        provider: new ResendEmailProvider({ apiKey: process.env.RESEND_API_KEY! }),
        defaultFrom: 'no-reply@acme.com',
        defaultFromName: 'Acme',
        templateRenderer: new DefaultTemplateRenderer({
          templates: {
            'otp_code::en': {
              subject: 'Your Acme verification code',
              html: '<p>Your code is <strong>{{code}}</strong>. It expires in {{expiresInMinutes}} minutes.</p>',
              text: 'Your code is {{code}}. It expires in {{expiresInMinutes}} minutes.'
            }
          }
        })
      },
      otp: {
        storage: new RedisOtpStorage({ redisClient: redis }),
        defaultLength: 6,
        defaultCodeType: 'numeric',
        defaultTtlSeconds: 600,
        defaultMaxAttempts: 5,
        resendCooldownSeconds: 60,
        perPurpose: {
          password_reset: {
            length: 8,
            codeType: 'alphanumeric',
            ttlSeconds: 900,
            maxAttempts: 5,
            resendCooldownSeconds: 60
          }
        }
      }
    })
  ]
})
export class AppModule {}
```

For async configuration (e.g. reading secrets from `ConfigService`), use `forRootAsync`:

```typescript
import { ConfigModule, ConfigService } from '@nestjs/config'

BymaxNotificationModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    email: {
      provider: new ResendEmailProvider({ apiKey: config.getOrThrow('RESEND_API_KEY') }),
      defaultFrom: config.getOrThrow('MAIL_FROM')
    },
    otp: { storage: new RedisOtpStorage({ redisClient: redis }) }
  })
})
```

> [!IMPORTANT]
> `forRootAsync` supports the `useFactory` pattern. `useClass` / `useExisting` are not implemented and are rejected at startup.

### 4. Bring Your Own Provider

Every external boundary is an interface — implement it and pass the instance (or class) to `forRoot`. The bundled `ResendEmailProvider` and `RedisOtpStorage` are reference implementations, not requirements.

```typescript
import type {
  IEmailProvider,
  EmailSendOptions,
  EmailSendResult
} from '@bymax-one/nest-notification'

export class SendGridEmailProvider implements IEmailProvider {
  readonly name = 'sendgrid'

  isConfigured(): boolean {
    return Boolean(this.apiKey)
  }

  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    // Call SendGrid; throw on failure — EmailService maps it to a NotificationException.
    return { messageId: '…' }
  }
}
```

```typescript
import type { IOtpStorage } from '@bymax-one/nest-notification'
// Implement set / get / consumeAttempt / update / delete /
// tryAcquireCooldown / getCooldown / clearCooldown.
```

> [!IMPORTANT]
> `consumeAttempt` and `tryAcquireCooldown` **must be atomic** — one indivisible read-modify-write (a Redis Lua script, or a synchronous operation for an in-memory store). Implemented as a `get` followed by an `update`, two concurrent requests both read the same attempt count and the `maxAttempts` ceiling stops being a ceiling.

Adapter examples for several providers and stores live under [`docs/templates/`](./docs/templates/) and [`docs/schemas/`](./docs/schemas/):

| Email provider | Adapter                                   |
| -------------- | ----------------------------------------- |
| Resend         | bundled — `ResendEmailProvider`           |
| SendGrid       | implement `IEmailProvider` (sketch above) |
| AWS SES        | implement `IEmailProvider`                |
| Mailgun        | implement `IEmailProvider`                |

| Template engine | Adapter                                                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Default         | bundled — `DefaultTemplateRenderer` (`{{var}}` interpolation, HTML-escaped)                          |
| Handlebars      | [`docs/templates/handlebars-renderer.example.md`](./docs/templates/handlebars-renderer.example.md)   |
| MJML            | [`docs/templates/mjml-renderer.example.md`](./docs/templates/mjml-renderer.example.md)               |
| React Email     | [`docs/templates/react-email-renderer.example.md`](./docs/templates/react-email-renderer.example.md) |

### 5. Audit Log

The library never imports Prisma. You implement `INotificationLogRepository` against your own client; the module calls it fire-and-forget, so the audit sink can never crash the notification flow. A copy-pasteable Prisma schema fragment lives in [`docs/schemas/notification-log.prisma`](./docs/schemas/notification-log.prisma) and a full repository in [`docs/schemas/prisma-repository.example.md`](./docs/schemas/prisma-repository.example.md).

```typescript
import { Injectable } from '@nestjs/common'
import type { INotificationLogRepository, NotificationLogEntry } from '@bymax-one/nest-notification'
import { PrismaClient } from '@prisma/client' // your app's dependency, not the library's

@Injectable()
export class PrismaNotificationLogRepository implements INotificationLogRepository {
  readonly name = 'prisma'

  constructor(private readonly prisma: PrismaClient) {}

  async create(entry: NotificationLogEntry): Promise<void> {
    await this.prisma.notificationLog.create({
      data: {
        timestamp: new Date(entry.timestamp),
        tenantId: entry.tenantId,
        channel: entry.channel,
        verb: entry.verb,
        recipient: entry.recipient, // already masked if you set `audit.maskRecipient`
        purpose: entry.purpose ?? null,
        providerName: entry.providerName,
        messageId: entry.messageId ?? null,
        errorMessage: entry.errorMessage ?? null,
        userId: entry.userId ?? null
      }
    })
  }
}
```

```typescript
BymaxNotificationModule.forRoot({
  email: { provider: new ResendEmailProvider({ apiKey }), defaultFrom: 'no-reply@acme.com' },
  otp: { storage: new RedisOtpStorage({ redisClient: redis }) },
  audit: {
    repository: new PrismaNotificationLogRepository(prisma),
    swallowErrors: true, // default — audit failures never break delivery
    maskRecipient: (r) => r.replace(/^(.).*(@.*)$/, '$1***$2') // jane@acme.com -> j***@acme.com
  }
})
```

To capture HTTP-level `sent` / `failed` entries automatically, apply the interceptor:

```typescript
import { NotificationAuditInterceptor } from '@bymax-one/nest-notification'
// @UseInterceptors(NotificationAuditInterceptor) on a controller/handler, or wire it globally.
```

### 6. Frontend Integration (React)

The `./react` subpath is browser-only state and UX — it drives the OTP-input box and a countdown. **Verifying the code is your app's job**: the hooks carry no HTTP client and no Node builtins, so nothing about your API shape is assumed.

```tsx
import { useOtpInput, useOtpCountdown } from '@bymax-one/nest-notification/react'

function OtpForm({ expiresAt }: { expiresAt: number }) {
  const { values, onChange, onKeyDown, onPaste, refs, isComplete } = useOtpInput({
    length: 6,
    type: 'numeric',
    onComplete: (full) => void submitToBackend(full)
  })
  const { formatted, expired } = useOtpCountdown({ expiresAt })

  return (
    <form>
      {values.map((v, i) => (
        <input
          key={i}
          ref={refs[i]}
          value={v}
          onChange={onChange(i)}
          onKeyDown={onKeyDown(i)}
          onPaste={i === 0 ? onPaste : undefined}
          inputMode="numeric"
          maxLength={1}
        />
      ))}
      <p>{expired ? 'Code expired' : `Expires in ${formatted}`}</p>
      {/* Never render the code itself — `onComplete` hands it to your submit path.
          Echoing it into a label leaks it to screen readers, screenshots and
          session-replay tools, which is exactly what the server side avoids. */}
      <button disabled={!isComplete}>Verify</button>
    </form>
  )
}
```

Pair it with the `./shared` subpath to branch on server errors without duplicating string literals:

```typescript
import { NOTIFICATION_ERROR_CODES } from '@bymax-one/nest-notification/shared'

if (error.code === NOTIFICATION_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED) {
  // Show your own localized copy — the library never ships translations.
}
```

---

## ⚙️ Configuration

Configure via `forRoot(options)` or `forRootAsync({ useFactory })`. **At least one channel must be configured**, and configuring a channel the library does not implement throws at startup rather than failing on the first send. The full reference is in [`docs/technical_specification.md` §4](./docs/technical_specification.md); the most-used options:

| Section  | Option                  | Default          | Notes                                            |
| -------- | ----------------------- | ---------------- | ------------------------------------------------ |
| `global` | `redisNamespace`        | `'notification'` | Prefix for store keys.                           |
| `global` | `defaultLocale`         | `'en'`           | Template locale fallback.                        |
| `global` | `tenantIdResolver`      | —                | `(req) => tenantId`; the audit source of truth.  |
| `email`  | `provider`              | — (required)     | Instance or class implementing `IEmailProvider`. |
| `email`  | `defaultFrom`           | — (required)     | Must look like an email address.                 |
| `email`  | `templateRenderer`      | default renderer | Any `IEmailTemplateRenderer`.                    |
| `email`  | `maxAttachmentBytes`    | `10485760`       | 10 MiB attachment guard.                         |
| `otp`    | `storage`               | — (required)     | Instance or class implementing `IOtpStorage`.    |
| `otp`    | `defaultLength`         | `6`              | 1–32.                                            |
| `otp`    | `defaultCodeType`       | `'numeric'`      | `numeric` \| `alpha` \| `alphanumeric`.          |
| `otp`    | `defaultTtlSeconds`     | `600`            | Code lifetime.                                   |
| `otp`    | `defaultMaxAttempts`    | `5`              | Verify attempts before lock-out.                 |
| `otp`    | `resendCooldownSeconds` | `60`             | Anti-resend window (atomic `SET NX EX`).         |
| `otp`    | `perPurpose`            | `{}`             | Per-purpose overrides of the above.              |
| `audit`  | `repository`            | — (required)     | Any `INotificationLogRepository`.                |
| `audit`  | `swallowErrors`         | `true`           | Keep audit failures out of the delivery path.    |
| `audit`  | `maskRecipient`         | identity         | Minimize recipient PII before persisting.        |

---

## 🎨 Templates

Email rendering goes through `IEmailTemplateRenderer`. The bundled `DefaultTemplateRenderer` does `{{var}}` interpolation with **automatic HTML escaping in the HTML body** — subject and plaintext are left raw, since neither is an HTML context. That closes a stored-XSS vector: a display name containing markup renders as text, not as an element, in the recipient's mail client.

Register named templates per `name::locale`; the renderer falls back to the `en` locale when a locale-specific template is missing.

`CANONICAL_EMAIL_TEMPLATES` exports stable names for common transactional emails (`otp_code`, `otp_password_reset`, `otp_resent`, `welcome`, `password_reset_success`, `trial_expiring`, …) so providers and templates agree on the wire. For richer output, plug in Handlebars, MJML, or React Email — examples under [`docs/templates/`](./docs/templates/).

---

## 🏗️ Architecture

The package runs **inside** your NestJS application as a dynamic module — not as a separate service:

```
┌──────────────────────────────────────────────────┐
│            Your NestJS Application                │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │      @bymax-one/nest-notification          │  │
│  │                                            │  │
│  │  NotificationService                       │  │
│  │      ├── EmailService                      │  │
│  │      └── OtpService ←→ Crypto (node:crypto)│  │
│  │  NotificationAuditInterceptor              │  │
│  └───┬────────┬─────────┬──────────┬──────────┘  │
│      │        │         │          │             │
│  ┌───▼───┐ ┌──▼─────┐ ┌─▼───────┐ ┌▼──────────┐  │
│  │IEmail │ │IOtp    │ │IEmail   │ │INotifi…   │  │
│  │Provi… │ │Storage │ │Template │ │LogRepo    │  │
│  │(yours)│ │(yours) │ │Renderer │ │(yours)    │  │
│  └───────┘ └────────┘ └─────────┘ └───────────┘  │
└──────────────────────────────────────────────────┘
```

`NotificationService` is the façade: it dispatches to the channel services and exposes `getEnabledChannels()`, `getEmail()`, and `getOtp()` for direct access. Only the channels present in your configuration are registered, so an unconfigured channel is a startup error, not a runtime surprise.

### Design Principles

| Principle                     | Description                                                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **🔌 Interface-Driven**       | Define contracts, inject implementations — works with any email provider, any store, any ORM (or none)                                                            |
| **🔒 Secure by Default**      | CSPRNG codes, constant-time comparison, hashed keys, and a never-log-codes invariant — all on by default, nothing to opt into                                     |
| **⚛️ Atomic Where It Counts** | The attempt counter and the resend cooldown are mutated by the storage in one indivisible step; a service-side read-then-write is a bug, not a style choice       |
| **🪶 Zero Runtime Deps**      | `"dependencies": {}` — adds nothing of its own; crypto is native `node:crypto`. Required peers (NestJS…) come from your app, optional ones only when you use them |
| **🌳 Tree-Shakeable**         | `sideEffects: false`, subpath exports, ESM + CJS dual output with declarations for both                                                                           |
| **⚡ Conditional Loading**    | Unconfigured channels don't register — no wasted memory or startup time, and no half-wired channel that fails on the first send                                   |

---

## 🔐 Security Model

OTP codes are bearer secrets with a short life and a wide blast radius: whoever holds one is the account. The model below is built around keeping them unreadable, unguessable, and unresendable.

### SHA-256 storage keys

OTP entries and resend cooldowns are stored under a key derived from `sha256(tenantId:recipient)` — never the plaintext recipient or tenant id:

```
notification:otp:email_verification:7f3d8c91…  (64 hex chars)
```

- **Privacy.** An operator with `KEYS notification:otp:*` access to Redis — or anyone holding a leaked backup — cannot enumerate which addresses have a pending OTP. The recipient never appears in a key.
- **Isolation.** Two tenants sharing the same recipient produce different keys, so a cross-tenant collision is computationally infeasible (SHA-256 preimage resistance). One tenant's OTP, cooldown, and verification can never touch another's.

The trade-off — opaque keys you cannot read back to a recipient — is intentional: keys are an index, not a data source. The recipient lives only inside the TTL-bound value and, optionally masked, in the audit log.

### `tenantIdResolver` prevents tenant spoofing

When you expose notification endpoints over HTTP, a caller could forge another tenant's id in the request body — `POST { "tenantId": "tenant_a", … }` sent from `tenant_b` to verify someone else's OTP. Configure a `tenantIdResolver` that reads the tenant from a **trusted** source: a verified JWT claim, a subdomain, or a gateway-checked header.

```typescript
import type { NotificationRequest } from '@bymax-one/nest-notification'

BymaxNotificationModule.forRoot({
  global: {
    // Subdomain-based: `acme.app.com` -> `acme`.
    tenantIdResolver: (req: NotificationRequest) => req.hostname?.split('.')[0] ?? 'default'
  }
  // …channels
})

// JWT-claim based (the request is augmented by your auth middleware):
const tenantIdResolver = (req: NotificationRequest): string =>
  String(req.headers['x-tenant-id'] ?? 'default')
```

`NotificationRequest` is a minimal, framework-agnostic request shape declared by the library itself, so a public signature never drags in a framework's types. When a resolver is set, the `NotificationAuditInterceptor` uses it as the **source of truth** for the audited tenant id — any `tenantId` in the payload becomes a suggestion the resolver overrides.

> [!NOTE]
> The resolver governs what the audit interceptor trusts. Service methods still take an explicit `tenantId`: resolve the tenant in your controller and pass it down — there is no hidden override of a method argument.

### Codes are never written anywhere readable

The library **never** writes a code to a sink that can be read back:

- Not to the audit log — an entry is `{ verb, tenantId, recipient, purpose, providerName, … }`, never `code`.
- Not to a console or logger line.
- Not inside an `errorMessage`, which carries the message only — never a stack trace, whose frames can hold the code as an argument.

Codes exist only inside the OTP store, under a TTL, and in process memory for the duration of the request. `audit.maskRecipient` minimizes the recipient before it is persisted (`jane@acme.com` → `j***@acme.com`). A regression test asserts the invariant directly rather than trusting review: `JSON.stringify(auditEntry).includes(code) === false`.

### Attempt ceilings and cooldowns are atomic

`consumeAttempt` is the only writer of the attempt counter, and `tryAcquireCooldown` (`SET NX EX`) is the only acquirer of the resend window — both inside the storage, in one indivisible step. A service-side `get` followed by an `update` looks equivalent and passes every sequential test, but two concurrent verifies read the same count and each writes back the same increment: five attempts become unbounded. The same shape lets two concurrent resends both pass the cooldown check.

### Security Checklist

When integrating `@bymax-one/nest-notification` in production, verify each of the following:

- `tenantIdResolver` reads from a **verified** source (JWT claim, subdomain, gateway-signed header) — never the request body
- `audit.maskRecipient` is configured if audit rows are retained beyond the operational minimum
- A custom `IOtpStorage` implements `consumeAttempt` and `tryAcquireCooldown` atomically
- The recipient passed to the service is canonical (`email.trim().toLowerCase()`) — the library does not normalize it, so `A@x.com` and `a@x.com` are distinct keys
- `resendCooldownSeconds` and `defaultMaxAttempts` are tuned per purpose, not left at the defaults for high-value flows
- Your own controller rate-limits the OTP endpoints — the library bounds attempts per code, not requests per IP

---

## 🛡️ Security Table

| Layer              | Implementation                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Code Generation    | `crypto.randomInt` per character over the configured alphabet — uniform at every position, no modulo bias |
| Code Comparison    | `crypto.timingSafeEqual` (constant-time), never `===`                                                     |
| Storage Keys       | `sha256(tenantId:recipient)` — no recipient PII, no cross-tenant collision                                |
| Attempt Ceiling    | Counter spent atomically inside the storage (Redis Lua) — never a service-side read-then-write            |
| Resend Cooldown    | `SET NX EX` acquire, released only on delivery failure — two concurrent resends cannot both win           |
| Code Lifetime      | TTL-bound in the store; expiry and absence are reported identically so neither leaks the other            |
| Code Exposure      | Never logged, never audited, never in an error message or stack trace — asserted by a regression test     |
| Recipient PII      | Absent from keys; optionally masked before it reaches the audit sink                                      |
| Provider Secrets   | The Resend API key and the Redis client live in private fields; serializing a provider omits them         |
| Tenant Isolation   | `tenantId` scopes every operation and is resolved from a trusted source, not the payload                  |
| Template Injection | HTML body escaped on interpolation by the bundled renderer — closes stored XSS through a display name     |
| Attachment DoS     | Total attachment size rejected against a budget before the provider is called                             |
| Audit Failures     | Fire-and-forget with `swallowErrors` — an audit outage never becomes a delivery outage                    |
| Supply Chain       | `"dependencies": {}`; published with npm provenance (OIDC), CodeQL and OpenSSF Scorecard on every push    |

> [!IMPORTANT]
> This package uses **zero external cryptographic dependencies**. All operations use Node.js native `node:crypto`, eliminating supply chain attack vectors for critical security code.

---

## 🧱 Tech Stack

<p>
  <img src="https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white" alt="NestJS" />
  <img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Redis-7%2B-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/Resend-email-000000?style=flat-square&logo=resend&logoColor=white" alt="Resend" />
  <img src="https://img.shields.io/badge/Jest-30-C21325?style=flat-square&logo=jest&logoColor=white" alt="Jest" />
</p>

---

## 🧪 Testing & Quality

A one-time password is a credential, so the suite is held to a bar beyond "it runs" — every behavior is pinned so that a regression **fails a test**.

- ✅ **100% line coverage** — statements, branches, functions, and lines, enforced per file as a release gate across unit + e2e
- ✅ **100% mutation score** — verified with [Stryker](https://stryker-mutator.io/): every viable seeded fault killed, with **no survivors**, against a `break` threshold of 95. The equivalents that no test can kill carry their reason on the line they apply to, so the number is an accounting rather than a target
- ✅ **384 tests** — unit and end-to-end, spanning all three subpaths
- ✅ **Invariants asserted, not assumed** — the never-log-codes rule is a test (`JSON.stringify(entry).includes(code) === false`), not a review convention
- ✅ **Published shape verified** — `attw` resolves every entrypoint against the packed tarball, and a dogfood smoke test installs the package into a scratch consumer before any tag is cut
- ✅ **Every equivalent mutant documented** — the ones no test can kill carry an inline `// Stryker disable` with the reason, so the score is an accounting rather than a number

| Gate           | Standard                                                               |
| -------------- | ---------------------------------------------------------------------- |
| Type safety    | TypeScript `strict`, zero `any`                                        |
| Coverage       | **100%** line/branch/function/statement per file (`pnpm test:cov:all`) |
| Mutation       | Stryker score **≥ 95%** (`break: 95`), currently **98.17%**            |
| Lint           | ESLint flat config + `eslint-plugin-security`, zero warnings           |
| Bundle budgets | server < 30 KB · shared < 4 KB · react < 8 KB brotli (`pnpm size`)     |
| Prisma-free    | `pnpm check:no-prisma` — the library never imports `@prisma/client`    |
| Export map     | `pnpm check:exports` — `attw` against the packed tarball, ESM and CJS  |
| Supply chain   | published with npm provenance (OIDC), CodeQL + OpenSSF Scorecard       |

```bash
pnpm test          # unit suite
pnpm test:cov:all  # unit + e2e, 100% coverage gate
pnpm mutation      # Stryker mutation testing
```

> [!NOTE]
> Line coverage proves a line _executed_ under test; mutation testing proves a test _would fail_ if that line were wrong. The full methodology and per-area breakdown are in [docs/mutation_testing_results.md](./docs/mutation_testing_results.md).

---

## 📖 API Reference

### Module

| Member                                   | Returns         | Purpose                                                      |
| ---------------------------------------- | --------------- | ------------------------------------------------------------ |
| `BymaxNotificationModule.forRoot()`      | `DynamicModule` | Synchronous registration from a literal options object       |
| `BymaxNotificationModule.forRootAsync()` | `DynamicModule` | Async registration via `useFactory` (+ `imports` / `inject`) |

### Services

| Service               | Method                    | Returns                          | Purpose                                                               |
| --------------------- | ------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| `OtpService`          | `generate()`              | `{ expiresAt, cooldownSeconds }` | Mint a code, store it, optionally deliver it — never returns the code |
| `OtpService`          | `verify()`                | `OtpVerifyResult`                | Spend one attempt and compare in constant time                        |
| `OtpService`          | `consume()`               | `void`                           | Invalidate a verified code so it cannot be replayed                   |
| `OtpService`          | `resend()`                | `{ expiresAt, cooldownSeconds }` | Re-issue under the atomic cooldown                                    |
| `OtpService`          | `getStatus()`             | `OtpStatusResult`                | Read-only view (existence, expiry, attempts) — never the code         |
| `EmailService`        | `send()`                  | `{ messageId }`                  | Send a literal subject + body                                         |
| `EmailService`        | `sendTemplate()`          | `{ messageId }`                  | Render a named template for a locale, then send                       |
| `NotificationService` | `dispatch()`              | `DispatchResult`                 | Channel-agnostic façade over the configured channels                  |
| `NotificationService` | `getEnabledChannels()`    | `NotificationChannel[]`          | Which channels this instance actually registered                      |
| `NotificationService` | `getEmail()` / `getOtp()` | the channel service              | Direct access when you already know the channel                       |

### Interceptor

| Member                         | Purpose                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `NotificationAuditInterceptor` | Records `sent` / `failed` audit entries at the HTTP layer, tenant resolved by `tenantIdResolver` |

### Errors

| Member                           | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `NotificationException`          | `HttpException` carrying a stable `code`, a status, and optional `details` |
| `NOTIFICATION_ERROR_CODES`       | The 22 stable `notification.*` codes — branch on these, not on messages    |
| `NOTIFICATION_ERROR_DEFINITIONS` | Server-side code → HTTP status + default English message                   |

Error codes are namespaced (`notification.otp_invalid_code`, `notification.otp_cooldown_active`, `notification.email_send_failed`, …) and never change once published. Default messages are English; localize on the `code`.

### Reference adapters

| Export                          | Implements                   | Use for                                      |
| ------------------------------- | ---------------------------- | -------------------------------------------- |
| `ResendEmailProvider`           | `IEmailProvider`             | Production email via Resend                  |
| `NoOpEmailProvider`             | `IEmailProvider`             | Dev/test — logs subject and recipient only   |
| `RedisOtpStorage`               | `IOtpStorage`                | Production OTP state (atomic via Lua)        |
| `InMemoryOtpStorage`            | `IOtpStorage`                | Dev/test — single-process only               |
| `DefaultTemplateRenderer`       | `IEmailTemplateRenderer`     | `{{var}}` interpolation with HTML escaping   |
| `NoOpNotificationLogRepository` | `INotificationLogRepository` | Audit configured but intentionally discarded |

### Utilities

| Export                  | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `hashTenantRecipient()` | The key derivation, exposed so a custom storage produces identical keys |
| `generateOtpCode()`     | The CSPRNG generator, for a storage or provider that mints its own      |
| `safeCompare()`         | Constant-time string comparison over `crypto.timingSafeEqual`           |
| `toRetryAfterHeader()`  | Format a cooldown as a `Retry-After` header value                       |
| `cooldownExpiresAt()`   | Absolute expiry timestamp for a remaining cooldown                      |
| `formatCooldown()`      | Human-readable cooldown, for a UI countdown                             |

### React hooks (`./react`)

| Hook                | Returns                                                                             | Purpose                                              |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `useOtpInput()`     | `{ values, setValue, onChange, onKeyDown, onPaste, refs, code, isComplete, reset }` | Multi-slot OTP input with paste and arrow navigation |
| `useOtpCountdown()` | `{ remainingSeconds, formatted, expired }`                                          | Expiry countdown for the resend button               |

### Constants

| Export                      | Subpath                     | Purpose                                                        |
| --------------------------- | --------------------------- | -------------------------------------------------------------- |
| `NOTIFICATION_ERROR_CODES`  | `./shared` (and the server) | The 22 stable codes, with zero dependencies on the shared side |
| `DEFAULT_TTLS`              | `./shared` (and the server) | Default lifetimes, so a frontend countdown matches the backend |
| `NOTIFICATION_PURPOSES`     | server                      | Canonical purposes (`email_verification`, `password_reset`, …) |
| `CANONICAL_EMAIL_TEMPLATES` | server                      | Canonical template names (`otp_code`, `welcome`, …)            |

> [!IMPORTANT]
> Only `NOTIFICATION_ERROR_CODES` and `DEFAULT_TTLS` are re-exported from `./shared`. `NOTIFICATION_PURPOSES` and `CANONICAL_EMAIL_TEMPLATES` live on the server subpath — importing them into a browser bundle would pull NestJS in with them. Pass the purpose to your frontend as a plain string.

---

## 🤝 Contributing

Contributions are welcome! Please read our [contributing guidelines](./CONTRIBUTING.md) before submitting a pull request.

```bash
# Clone the repository
git clone https://github.com/bymaxone/nest-notification.git
cd nest-notification

# Install dependencies
pnpm install

# Run tests
pnpm test

# Build
pnpm build

# Type check
pnpm typecheck
```

---

## 🔒 Security Policy

If you discover a security vulnerability, please **do not** open a public issue. Instead, email us at **support@bymax.one** with details. We take security seriously and will respond promptly. The full policy is in [SECURITY.md](./SECURITY.md).

---

## 📄 License

[MIT](./LICENSE) © [Bymax One](https://github.com/bymaxone)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/bymaxone">Bymax One</a></sub>
</p>
