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

Everything that touches the outside world — the email transport, the OTP store, the template renderer, the audit sink — is an **interface** you implement or pick from the bundled reference adapters. The same module runs on Resend or SMTP out of the box (or any provider you implement, SendGrid for example), on Redis or an in-memory map, with a Prisma audit log or none at all, without changing a single call site.

### Why nest-notification?

- **🔌 Your database, your provider** — The library defines the contracts (`IEmailProvider`, `IOtpStorage`, `IEmailTemplateRenderer`, `INotificationLogRepository`). You supply the implementations. It **never imports `@prisma/client`** or any other ORM — a CI gate fails the build if one appears — so a cross-cutting concern never hard-wires your schema.
- **🏢 Multi-tenant from the first line** — Every operation is scoped by `tenantId`, store keys are `sha256(sha256(tenantId):sha256(recipient))`, and the audit interceptor resolves the trusted tenant from the request rather than the request body when you configure a resolver.
- **🔒 Native crypto only** — Codes come from `crypto.randomInt` and are compared with `crypto.timingSafeEqual`. No `crypto-js`, no `otpauth`, no `uuid`, no `nanoid` — the most security-sensitive path carries no third-party supply-chain risk.
- **⚛️ Atomic by construction** — The attempt counter and the resend cooldown are mutated **inside the storage** (Redis Lua / `SET NX EX`), never by a service-side read-then-write. A `get` + `update` pair races, and the race is exactly how a max-attempts ceiling gets bypassed under concurrent requests.
- **🪶 Pay for what you use** — `"dependencies": {}`. NestJS, your email SDK, your Redis client, and React are all peer dependencies, and only the channels you configure are registered in the container.

---

## 🔥 Features

### 📧 Email

- ✅ **Pluggable transport** — `IEmailProvider` with a bundled `ResendEmailProvider`, an `SmtpEmailProvider` that speaks the protocol every relay and mail-capture server understands, and a `NoOpEmailProvider` for dev/test that logs a masked recipient only, never the body
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

- ✅ **SHA-256 storage keys** — `sha256(sha256(tenantId):sha256(recipient))`: no recipient PII in a key, and the encoding adds no ambiguity of its own, so two pairs never share one by construction
- ✅ **`tenantIdResolver`** — the audited tenant comes from a trusted source (a JWT claim, a subdomain, a gateway-checked header), not the payload
- ✅ **Opt-in audit log** — a fire-and-forget `INotificationLogRepository` plus a `NotificationAuditInterceptor`; audit failures do not break delivery unless `audit.swallowErrors` is `false`
- ✅ **This library never logs a code** — not to a logger, an audit entry, or an error message it authors, enforced by a regression test. Text a **provider** authors has a documented ceiling: see [Errors](#-errors)

### 🧩 Developer Experience

- ✅ **Subpaths** — server, zero-dependency shared types, React hooks, and a `testing` storage contract
- ✅ **Stable error catalog** — 24 namespaced codes shared byte-for-byte between server and frontend, so you localize on the `code`
- ✅ **Dual-format output** — ESM + CJS + declarations for both, verified against the packed tarball on every PR
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

One package, four entry points — import only what your app needs:

| Subpath     | Import                                 | Purpose                                                |               Peer deps                |
| ----------- | -------------------------------------- | ------------------------------------------------------ | :------------------------------------: |
| **Server**  | `@bymax-one/nest-notification`         | NestJS module, services, providers, errors, tokens     | NestJS 11 (+ your provider/store SDKs) |
| **Shared**  | `@bymax-one/nest-notification/shared`  | Types + constants (error codes, TTLs)                  |                  None                  |
| **React**   | `@bymax-one/nest-notification/react`   | `useOtpInput` + `useOtpCountdown` (UX/state only)      |                React 19                |
| **Testing** | `@bymax-one/nest-notification/testing` | Executable `IOtpStorage` contract for your own storage |                  None                  |

```
shared (zero deps) ← server        react
```

`shared` has no dependencies, `server` builds on it and re-exports its error codes and TTLs, and `react` imports nothing but `react` — importing one never drags in another's peers. Every subpath ships ESM (`.mjs`), CJS (`.cjs`), and declarations for both formats (`.d.ts` + `.d.cts`).

---

> [!TIP]
> Prefer to learn from a working app? See the [nest-notification-example](https://github.com/bymaxone/nest-notification-example) — a full NestJS project wired with this library.

## 🚀 Quick Start

### 1. Install

```bash
pnpm add @bymax-one/nest-notification

# Server subpath peers (required)
pnpm add @nestjs/common @nestjs/core reflect-metadata rxjs

# Pick your provider and store (optional peers): Resend or SMTP, plus Redis
pnpm add resend ioredis        # …or: pnpm add nodemailer ioredis

# React subpath (optional)
pnpm add react
```

> [!NOTE]
> Requires Node.js **24+** and NestJS **11**. Every provider and storage SDK is an _optional_ peer dependency: install only the ones your configuration names.

### 2. Development — `NoOpEmailProvider` + `InMemoryOtpStorage`

No external services. Emails are logged (a masked recipient only, never the subject or the body), and OTP state lives in process memory. Ideal for local dev and tests.

```typescript
import { Module } from '@nestjs/common'
import {
  BymaxNotificationModule,
  NoOpEmailProvider,
  InMemoryOtpStorage,
  DefaultTemplateRenderer
} from '@bymax-one/nest-notification'

// The default renderer ships no templates: register the one the OTP email is rendered from.
const templateRenderer = new DefaultTemplateRenderer({
  templates: {
    'otp_code::en': {
      subject: 'Your Acme verification code',
      html: '<p>Your code is <strong>{{code}}</strong>. It expires in {{expiresInMinutes}} minutes.</p>',
      text: 'Your code is {{code}}. It expires in {{expiresInMinutes}} minutes.'
    }
  }
})

@Module({
  imports: [
    BymaxNotificationModule.forRoot({
      email: {
        provider: new NoOpEmailProvider(),
        defaultFrom: 'no-reply@dev.local',
        templateRenderer
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

The OTP email is rendered from the `otp_code` template, and the default renderer ships none, so register one as above (the same template as in step 3). Without it the first `generate()` throws `TEMPLATE_NOT_FOUND` (its details carry a `remedy` for this case), and one warning, `BYMAX_NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED`, is logged at startup. Ignore that line if every `generate()` passes `emailTemplate`, if you deliver manually, or if your renderer loads its templates after startup.

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
  RedisOtpStorage
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
        templateRenderer // the DefaultTemplateRenderer from step 2, with its `otp_code` template
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

### 4. SMTP — any relay, and end-to-end tests

`SmtpEmailProvider` drives any SMTP relay and the mail-capture servers (Mailpit, MailHog) that make email flows testable end to end. It needs the optional `nodemailer` peer.

```typescript
import { SmtpEmailProvider } from '@bymax-one/nest-notification'

const relay = new SmtpEmailProvider({
  host: process.env.SMTP_HOST,
  port: 587,
  credentials: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
})
```

> [!WARNING]
> STARTTLS is mandatory by default for any non-loopback host, because a network attacker can strip the plaintext `STARTTLS` capability and read the OTP body. Opt out only with `requireTls: false`. The option table, the TLS rationale and the header-injection guard are in [`docs/smtp-provider.md`](./docs/smtp-provider.md).

### 5. Bring Your Own Provider

Every external boundary is an interface: implement it and pass the instance (or class) to `forRoot`. The bundled adapters are reference implementations, not requirements; SendGrid, Mailgun or AWS SES over HTTP are an `IEmailProvider` away.

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

A custom `IOtpStorage` implements the interface the package exports; the `/testing` subpath runs it against the contract.

> [!IMPORTANT]
> `consumeAttempt` and `tryAcquireCooldown` **must be atomic** — one indivisible read-modify-write (a Redis Lua script, or a synchronous operation for an in-memory store). Implemented as a `get` followed by an `update`, two concurrent requests both read the same attempt count and the `maxAttempts` ceiling stops being a ceiling.

Template-engine adapters (Handlebars, MJML, React Email) are under [`docs/templates/`](./docs/templates/).

### 6. Audit Log

The library never imports Prisma. You implement `INotificationLogRepository` against your own client and the module swallows its failures by default (`audit.swallowErrors`), so the audit sink does not crash the notification flow. A Prisma schema fragment is in [`docs/schemas/notification-log.prisma`](./docs/schemas/notification-log.prisma) and a full repository in [`docs/schemas/prisma-repository.example.md`](./docs/schemas/prisma-repository.example.md).

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

To capture HTTP-level `sent` / `failed` entries automatically, apply `NotificationAuditInterceptor` with `@UseInterceptors(...)` on a controller or handler, or wire it globally.

### 7. Frontend Integration (React)

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

Branch on a server error without duplicating string literals:

```typescript
import { NOTIFICATION_ERROR_CODES } from '@bymax-one/nest-notification/shared'

if (error.code === NOTIFICATION_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED) {
  // Show your own localized copy — the library never ships translations.
}
```

---

## ⚙️ Configuration

Configure via `forRoot(options)` or `forRootAsync({ useFactory })`. **At least one channel must be configured**, and configuring a channel the library does not implement throws at startup rather than failing on the first send. The full reference is in [`docs/technical_specification.md` §4](./docs/technical_specification.md); the most-used options:

| Section  | Option                  | Default          | Notes                                                                                                                                              |
| -------- | ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global` | `redisNamespace`        | `'notification'` | Prefix for store keys.                                                                                                                             |
| `global` | `defaultLocale`         | `'en'`           | Template locale fallback.                                                                                                                          |
| `global` | `tenantIdResolver`      | —                | `(req) => tenantId`; the audit source of truth.                                                                                                    |
| `email`  | `provider`              | — (required)     | Instance or class implementing `IEmailProvider`.                                                                                                   |
| `email`  | `defaultFrom`           | — (required)     | Must look like an email address.                                                                                                                   |
| `email`  | `templateRenderer`      | default renderer | Any `IEmailTemplateRenderer`.                                                                                                                      |
| `email`  | `maxAttachmentBytes`    | `10485760`       | 10 MiB attachment guard.                                                                                                                           |
| `email`  | `defaultFromName`       | —                | Display name sent with `defaultFrom`.                                                                                                              |
| `email`  | `defaultReplyTo`        | —                | `Reply-To` applied when a send does not set one.                                                                                                   |
| `email`  | `defaultTags`           | `[]`             | Tags merged into every send, before the send's own tags.                                                                                           |
| `otp`    | `storage`               | — (required)     | Instance or class implementing `IOtpStorage`.                                                                                                      |
| `otp`    | `defaultLength`         | `6`              | 1–32.                                                                                                                                              |
| `otp`    | `defaultCodeType`       | `'numeric'`      | `numeric` \| `alpha` \| `alphanumeric`.                                                                                                            |
| `otp`    | `defaultTtlSeconds`     | `600`            | Code lifetime.                                                                                                                                     |
| `otp`    | `defaultMaxAttempts`    | `5`              | Verify attempts before lock-out.                                                                                                                   |
| `otp`    | `codeSecret`            | —                | Secret (>= 32 bytes) the stored code is keyed under.                                                                                               |
| `otp`    | `consumeOnVerify`       | `false`          | `true` deletes the code when `verify()` succeeds; otherwise the entry is marked validated until `consume()` or its TTL.                            |
| `otp`    | `resendCooldownSeconds` | `60`             | Anti-resend window (atomic `SET NX EX`).                                                                                                           |
| `otp`    | `perPurpose`            | `{}`             | Per-purpose overrides of the above.                                                                                                                |
| `audit`  | `repository`            | — (required)     | Any `INotificationLogRepository`.                                                                                                                  |
| `audit`  | `swallowErrors`         | `true`           | Keep audit failures out of the delivery path. A swallowed failure logs `BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED`, at most once a minute per channel. |
| `audit`  | `maskRecipient`         | identity         | Minimize recipient PII before persisting.                                                                                                          |

---

## 🎨 Templates

Email rendering goes through `IEmailTemplateRenderer`. The bundled `DefaultTemplateRenderer` does `{{var}}` interpolation with **automatic HTML escaping in the HTML body** — subject and plaintext are left raw, since neither is an HTML context. That closes a stored-XSS vector: a display name containing markup renders as text, not as an element, in the recipient's mail client.

Register named templates per `name::locale`; the renderer falls back to the `en` locale when a locale-specific template is missing.

| Renderer option     | Default   | Notes                                                                                                 |
| ------------------- | --------- | ----------------------------------------------------------------------------------------------------- |
| `templates`         | `{}`      | `{ 'name::locale': { subject, html, text? } }`. Every template needs a string `subject` and `html`.   |
| `fallbackLocales`   | `['en']`  | Locales tried, in order, after the requested one.                                                     |
| `onMissingVar`      | `'empty'` | `'empty'` renders a missing variable as an empty string; `'throw'` raises instead.                    |
| `enableNestedPaths` | `false`   | `true` resolves `{{user.name}}` through nested objects; `false` looks up the literal key `user.name`. |

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

`NotificationService` is the façade: it dispatches to the channel services and exposes `getEnabledChannels()`, `getEmail()`, and `getOtp()` for direct access. Only the channels present in your configuration are wired: `getEnabledChannels()` lists them, and `getEmail()` / `getOtp()` throw `CHANNEL_DISABLED` for a channel that is not.

---

## 🔐 Security Model

OTP codes are bearer secrets with a short life and a wide blast radius: whoever holds one is the account. The model below keeps them unreadable, unguessable, and unresendable.

### SHA-256 storage keys

OTP entries and resend cooldowns are stored under a key derived from `sha256(sha256(tenantId):sha256(recipient))` — never the plaintext recipient or tenant id:

```
notification:otp:email_verification:7f3d8c91…  (64 hex chars)
```

- **Privacy.** An operator with `KEYS notification:otp:*` access to Redis — or anyone holding a leaked backup — cannot enumerate which addresses have a pending OTP. The recipient never appears in a key.
- **Isolation.** Each component is hashed to a fixed length before the two are joined, so distinct `(tenantId, recipient)` pairs cannot produce the same key. This is a property of the encoding rather than of the digest — joining the raw values around a delimiter would map `('acme:bob', 'x')` and `('acme', 'bob:x')` onto one key while SHA-256's preimage and collision resistance held perfectly. Both components must be non-empty; an empty one is refused rather than hashed, because it would place every caller that omits it into a single shared scope.

The trade-off — opaque keys you cannot read back to a recipient — is intentional: keys are an index, not a data source. The recipient lives only inside the TTL-bound value and, optionally masked, in the audit log.

### `tenantIdResolver` prevents tenant spoofing

When you expose notification endpoints over HTTP, a caller could forge another tenant's id in the request body — `POST { "tenantId": "tenant_a", … }` sent from `tenant_b` to verify someone else's OTP. Configure a `tenantIdResolver` that reads the tenant from a **trusted** source: a verified JWT claim, a subdomain, or a gateway-checked header.

```typescript
import { BymaxNotificationModule, type NotificationRequest } from '@bymax-one/nest-notification'

BymaxNotificationModule.forRoot({
  global: {
    // Subdomain-based: `acme.app.com` -> `acme`.
    tenantIdResolver: (req: NotificationRequest) => req.hostname?.split('.')[0] ?? 'default'
  }
  // …channels
})

// Header based (set by a gateway you trust):
const tenantIdResolver = (req: NotificationRequest): string =>
  String(req.headers['x-tenant-id'] ?? 'default')
```

`NotificationRequest` is a minimal, framework-agnostic request shape declared by the library itself, so a public signature never drags in a framework's types. When a resolver is set, the `NotificationAuditInterceptor` uses it as the **source of truth** for the audited tenant id — any `tenantId` in the payload becomes a suggestion the resolver overrides.

A tenant id that identifies nobody is never recorded. The interceptor refuses a value that is not a string, is empty, or is whitespace-only, on every path that produces the id: what `tenantIdResolver` returns, the payload's `tenantId` when no resolver is configured, and the payload's `tenantId` when a resolver is configured but there is no HTTP request to read it from (a non-HTTP context). Your caller never sees the refusal itself. With `audit.swallowErrors: true` (the default) it is swallowed and no audit entry is written; with `false` it surfaces as `AUDIT_LOG_FAILED`, whose `cause` is a sanitized copy of the refusal. One input is ignored, not refused: an argument whose payload `tenantId` is not a string is not recognised as a dispatch at all, so it produces no audit entry and no error.

A swallowed audit failure is not silent: each channel (`otp`, `email`, the interceptor) logs one warning, `BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED`, naming the channel and the failure's class or code only: a `notification.` code (such as `notification.invalid_scope_identifier` for a refused tenant id), otherwise the error's name and code, each only when it is a short token such as `Error` or `ECONNREFUSED`. The repository's error message is never printed, since it can quote the entry it rejected, whose recipient and user id are personal data, in any form; the cause is in your repository's own logs. A name or code your repository sets itself is printed when it is a short token, so do not put an identifier of the entry in one. No OTP code is ever written. At most one line is written per channel per minute; the next line says how many failures it stands for. The operation's own result is unchanged.

With `audit.swallowErrors: false` the audit write comes after the state change, so `AUDIT_LOG_FAILED` says only that the audit write failed. It does not say what the operation did, and it replaces the result the call would have returned: `generate()` can raise it after the code was stored and delivered (its resend cooldown is then held, unless the email channel's own audit of the send is the one that failed, which releases the stored code and the cooldown), or while recording a blocked cooldown or a failed delivery; `verify()` can raise it after the code was accepted (consumed, or marked validated), or while recording a wrong code, a missing code or an exhausted attempt limit. Never read it as success or as failure of the operation; check the state through your own means.

> [!NOTE]
> The resolver governs what the audit interceptor trusts. Service methods still take an explicit `tenantId`: resolve the tenant in your controller and pass it down — there is no hidden override of a method argument.

### The library never writes a code anywhere readable

This is about text **this library authors**. Text a provider authors has a documented ceiling (see [Errors](#-errors)); the two are not one guarantee. The library never writes a code to a sink that can be read back:

- **The audit log.** An entry is `{ verb, tenantId, recipient, purpose, providerName, … }`, never `code`.
- **A console or logger line**, or an `errorMessage`, which carries the message only, never a stack trace.
- **A rethrown delivery error.** The renderer and the provider both receive the code, so on a failed delivery every literal occurrence of it is scrubbed to `[redacted]` across the outgoing error chain (message and stack at every link, cycle-safe) before the audit write and the rethrow. The email channel's own `failed` entry goes further: OTP delivery sets `publishProviderText: false`, so it records the fixed label `[provider text withheld]` plus the SMTP reply codes a fixed grammar can express, never the provider's words.

Codes exist only inside the OTP store, under a TTL (as a keyed digest when `otp.codeSecret` is set), and in process memory for the duration of the request. `audit.maskRecipient` minimizes the recipient before it is persisted (`jane@acme.com` → `j***@acme.com`). A regression test asserts the invariant directly: `JSON.stringify(auditEntry).includes(code) === false`.

### Stored codes are keyed digests when you set `otp.codeSecret`

A code is short: a six-digit code has a million values, so a plain hash of it is recovered by trying all of them, in a fraction of a second, by anyone who can read the store. With `otp.codeSecret` set (a string of at least 32 bytes, kept with the application and never in Redis), the store holds `hmac-sha256:v1:<hex>`, an HMAC-SHA-256 of the code under that secret, and `verify()` recomputes it and compares in constant time. A reader of the store alone then holds nothing to test a guess against. The delivered email still carries the plaintext code, and the audit entry never carries either form.

- **Unset** (the default): codes are stored in plaintext, and a warning is logged once at startup.
- **Manual delivery is refused while it is set.** `generate()` never returns the code, so a manual delivery reads it back from the store, and a store that holds a digest has nothing to hand over. `generate({ deliverVia: 'manual' })`, or the default delivery when no email channel is configured, fails with `notification.otp_manual_delivery_unavailable` (400) before the cooldown is taken or anything is stored. Deliver by email, or leave `codeSecret` unset where you read the code from the store (a local development flow, for instance).
- **Turning it on loses no live code.** An entry written in plaintext before the secret was set still verifies until it expires.
- **Changing or removing the secret** makes the digests already stored unverifiable (`invalid_code`); those codes must be requested again. Downgrading the library below the version that introduced the option does the same.
- A custom `IOtpStorage` is unaffected: `OtpEntry.code` is an opaque string to it.

### Attempt ceilings and cooldowns are atomic

`consumeAttempt` is the only writer of the attempt counter, and `tryAcquireCooldown` (`SET NX EX`) is the only acquirer of the resend window — both inside the storage, in one indivisible step. A service-side `get` followed by an `update` looks equivalent and passes every sequential test, but two concurrent verifies read the same count and each writes back the same increment: five attempts become unbounded. The same shape lets two concurrent resends both pass the cooldown check.

### Failed attempts survive a re-issue

A per-code counter alone lets a re-issue reset the failure count: guess wrongly up to the limit, wait out the resend cooldown, and guess again. So the failed verifications of a `(tenant, recipient, purpose)` are counted in the storage, and `verify()` refuses once that count passes the purpose's attempt ceiling, whichever code is live.

- Every verification attempt against a live code adds one to the count, before its code is compared, and restarts the counter's lifetime to the purpose's code lifetime (`ttlSeconds`); a counter that is not touched for that long lapses, which starts the count again from zero.
- A successful verification and `consume()` clear it (the attempt that succeeded included), so the next flow starts with a full budget.
- Once the count passes the ceiling, `verify()` returns `{ valid: false, reason: 'max_attempts' }` for any code, a freshly issued one included, until the counter lapses. The stored count alone decides, so the lockout ends exactly when the counter lapses. Because the increment is atomic and happens first, guesses that arrive together each get their own number and only those within the ceiling are compared. `remainingAttempts` reports the nearer of the code's own budget and the count's. This also means that someone who keeps sending wrong guesses for a recipient keeps that recipient locked out, so rate-limit the OTP endpoints by IP in your controller.
- `RedisOtpStorage` keeps the counter under `{namespace}:otp_fail:{purpose}:{hash}`, incremented by one script; `InMemoryOtpStorage` does the same in memory.
- A custom `IOtpStorage` opts in by implementing three **optional** methods, `getFailures`, `recordFailure` and `clearFailures`; the executable contract in `./testing` checks them when they are present. The three work together: a storage with only some of them is treated as having none. Without them each code keeps a fresh budget, and one warning, `BYMAX_NOTIFICATION_OTP_FAILURES_NOT_CARRIED`, is logged at startup naming the deviation.

### Security Checklist

When integrating `@bymax-one/nest-notification` in production, verify each of the following:

- `tenantIdResolver` reads from a **verified** source (JWT claim, subdomain, gateway-signed header) — never the request body
- `audit.maskRecipient` is configured if audit rows are retained beyond the operational minimum
- A custom `IOtpStorage` implements `consumeAttempt` and `tryAcquireCooldown` atomically
- `OtpService` keys its state on the recipient with surrounding whitespace trimmed and an email address lower-cased, so `Jane@Acme.com`, `jane@acme.com` and ` jane@acme.com` share one cooldown and one attempt counter; the message is still delivered to the address exactly as you pass it (RFC 5321 §2.4). A recipient that is not an email is only trimmed. Store and compare the same canonical form on your side
- `otp.codeSecret` is set, from a secret store and not from the same place as the Redis credentials, so a reader of the store cannot test a guess against a stored code
- `resendCooldownSeconds` and `defaultMaxAttempts` are tuned per purpose, not left at the defaults for high-value flows
- Your own controller rate-limits the OTP endpoints — the library bounds failed attempts per recipient and purpose, not requests per IP

---

## 🛡️ Security Table

| Layer              | Implementation                                                                                                                                                                            |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code Lifetime      | TTL-bound in the store; expiry and absence are reported identically so neither leaks the other                                                                                            |
| Provider Secrets   | The Resend API key, the SMTP password and the Redis client live in private fields; serializing a provider omits them, and a failing SMTP session has its password scrubbed from the error |
| Template Injection | HTML body escaped on interpolation by the bundled renderer — closes stored XSS through a display name                                                                                     |
| Attachment DoS     | Total attachment size rejected against a budget before the provider is called                                                                                                             |
| Supply Chain       | `"dependencies": {}`; published with npm provenance (OIDC), CodeQL and OpenSSF Scorecard                                                                                                  |

> [!IMPORTANT]
> This package uses **zero external cryptographic dependencies**. All operations use Node.js native `node:crypto`, eliminating supply chain attack vectors for critical security code.

---

## 🧪 Testing & Quality

A one-time password is a credential, so every behavior is pinned so that a regression **fails a test**.

- ✅ **100% coverage and mutation score** — per file across unit and end-to-end tests of every subpath, with [Stryker](https://stryker-mutator.io/) at `break: 100`. The equivalent mutants no test can kill carry an inline `// Stryker disable` with the reason, so the score is an accounting rather than a target
- ✅ **Invariants asserted, not assumed** — the never-log-codes rule is a test (`JSON.stringify(entry).includes(code) === false` on every audit entry, and the thrown exception serialized recursively at every depth), not a review convention
- ✅ **Published shape verified** — `attw` resolves every entrypoint against the packed tarball, and a dogfood smoke test installs the package into a scratch consumer before any tag is cut

| Gate           | Standard                                                                            |
| -------------- | ----------------------------------------------------------------------------------- |
| Type safety    | TypeScript `strict`, zero `any`                                                     |
| Coverage       | **100%** line/branch/function/statement per file (`pnpm test:cov:all`)              |
| Mutation       | Stryker score **100%** (`break: 100`), no survivors                                 |
| Lint           | ESLint flat config + `eslint-plugin-security`, zero warnings                        |
| Bundle budgets | server < 30 KB · shared < 4 KB · react < 8 KB · testing < 4 KB brotli (`pnpm size`) |
| Prisma-free    | `pnpm check:no-prisma` — the library never imports `@prisma/client`                 |
| Export map     | `pnpm check:exports` — `attw` against the packed tarball, ESM and CJS               |
| Supply chain   | published with npm provenance (OIDC), CodeQL + OpenSSF Scorecard                    |

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

### Send and issue options

`EmailService.send()` takes these fields. `sendTemplate()` takes `tenantId`, `to`, `from`, `fromName`, `replyTo`, `tags`, `userId`, `auditRedactValues` and `publishProviderText` as below, plus `template`, `data` and an optional `locale` in place of `subject`, `html` and `text`; it has no `cc`, `bcc` or `attachments`.

| Field                         | Notes                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `tenantId`                    | Required. Refused when blank or when it contains a control character.                              |
| `to`, `cc`, `bcc`             | A string or an array. `to` is not validated by the library.                                        |
| `subject`, `html`, `text`     | The message. `text` is optional.                                                                   |
| `from`, `fromName`, `replyTo` | Override the `defaultFrom`, `defaultFromName` and `defaultReplyTo` of the channel.                 |
| `tags`                        | Merged after `defaultTags`.                                                                        |
| `attachments`                 | `{ filename, content, contentType? }[]`; their total size is checked against `maxAttachmentBytes`. |
| `userId`                      | Recorded in the audit entry.                                                                       |
| `auditRedactValues`           | Values scrubbed from the failure's `cause` and `errorMessage`. See [Errors](#-errors).             |
| `publishProviderText`         | `false` withholds everything the provider wrote. Default `true`.                                   |

`OtpService.generate()` and `resend()` take:

| Field                              | Notes                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenantId`, `recipient`, `purpose` | Required; the OTP state is keyed on all three.                                                                                                          |
| `deliverVia`                       | `'email'` hands the code to the email channel; `'manual'` leaves delivery to you. Default `'email'` when an email channel exists, otherwise `'manual'`. |
| `emailTemplate`                    | Template rendered for email delivery. Default `'otp_code'`.                                                                                             |
| `emailData`                        | Variables for the template. `code`, `expiresInMinutes` and `purpose` are added to them.                                                                 |
| `locale`                           | Locale for the template. Default `global.defaultLocale`.                                                                                                |
| `userId`                           | Recorded in the audit entry.                                                                                                                            |

### Interceptor

| Member                         | Purpose                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------ |
| `NotificationAuditInterceptor` | Records `sent` / `failed` audit entries at the HTTP layer, tenant resolved by `tenantIdResolver` |

### Reference adapters

| Export                          | Implements                   | Use for                                                                 |
| ------------------------------- | ---------------------------- | ----------------------------------------------------------------------- |
| `ResendEmailProvider`           | `IEmailProvider`             | Production email via Resend                                             |
| `SmtpEmailProvider`             | `IEmailProvider`             | Any SMTP relay, and Mailpit/MailHog in tests                            |
| `NoOpEmailProvider`             | `IEmailProvider`             | Dev/test — logs a masked recipient only                                 |
| `RedisOtpStorage`               | `IOtpStorage`                | Production OTP state (atomic via Lua)                                   |
| `InMemoryOtpStorage`            | `IOtpStorage`                | Dev/test — single-process only; `.size()` returns `{ otps, cooldowns }` |
| `DefaultTemplateRenderer`       | `IEmailTemplateRenderer`     | `{{var}}` interpolation with HTML escaping                              |
| `NoOpNotificationLogRepository` | `INotificationLogRepository` | Audit configured but intentionally discarded                            |

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

| Hook option                           | Default      | Notes                                                                                                 |
| ------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `useOtpInput({ length })`             | `6`          | Number of slots.                                                                                      |
| `useOtpInput({ type })`               | `'numeric'`  | `'numeric'`, `'alpha'` or `'alphanumeric'`; other characters are dropped and letters are upper-cased. |
| `useOtpInput({ onComplete })`         | —            | Called with the full code once every slot is filled.                                                  |
| `useOtpInput({ autoSubmit })`         | `true`       | `false` stops `onComplete` from firing on its own.                                                    |
| `useOtpInput({ sanitizeOnPaste })`    | `true`       | Strips whitespace and hyphens from pasted text before distributing it.                                |
| `useOtpCountdown({ expiresAt })`      | — (required) | Epoch milliseconds, or `null` for no countdown.                                                       |
| `useOtpCountdown({ tickIntervalMs })` | `1000`       | How often `remainingSeconds` is recomputed.                                                           |
| `useOtpCountdown({ onExpired })`      | —            | Called once when the countdown reaches zero.                                                          |

### Injection tokens

Every token is a `Symbol()`, exported for an advanced override or a test that replaces one part of the module: `BYMAX_NOTIFICATION_OPTIONS` (the resolved, frozen options), `BYMAX_NOTIFICATION_EMAIL_PROVIDER`, `BYMAX_NOTIFICATION_OTP_STORAGE`, `BYMAX_NOTIFICATION_TEMPLATE_RENDERER` and `BYMAX_NOTIFICATION_LOG_REPOSITORY`. `BYMAX_NOTIFICATION_SMS_PROVIDER` and `BYMAX_NOTIFICATION_PUSH_PROVIDER` exist for the reserved channels and carry nothing today.

### Testing your own storage (`./testing`)

`otpStorageContract(factory, options?)` returns the executable cases your own `IOtpStorage` has to pass: atomic attempt counting, atomic cooldown, TTL that survives an update, and keys scoped by tenant, recipient and purpose. Each case is `{ name, run }`, so it runs in any test runner; `expiryWaitMs` raises the wait of the TTL cases for a backend with coarse expiry.

```ts
import { InMemoryOtpStorage } from '@bymax-one/nest-notification'
import { otpStorageContract } from '@bymax-one/nest-notification/testing'

// Run it once per storage you ship; Jest, Vitest and node:test all accept this loop.
for (const contractCase of otpStorageContract(() => new InMemoryOtpStorage())) {
  it(contractCase.name, contractCase.run)
}
```

Passing the contract does not prove a key encoding safe against every delimiter: it exercises the `:` and `::` joins, and the storage still has to encode the tenant and recipient boundary itself.

### Constants

| Export                      | Subpath                     | Purpose                                                        |
| --------------------------- | --------------------------- | -------------------------------------------------------------- |
| `NOTIFICATION_ERROR_CODES`  | `./shared` (and the server) | The stable codes, with zero dependencies on the shared side    |
| `DEFAULT_TTLS`              | `./shared` (and the server) | Default lifetimes, so a frontend countdown matches the backend |
| `NOTIFICATION_PURPOSES`     | server                      | Canonical purposes (`email_verification`, `password_reset`, …) |
| `CANONICAL_EMAIL_TEMPLATES` | server                      | Canonical template names (`otp_code`, `welcome`, …)            |

> [!IMPORTANT]
> Only `NOTIFICATION_ERROR_CODES` and `DEFAULT_TTLS` are re-exported from `./shared`. `NOTIFICATION_PURPOSES` and `CANONICAL_EMAIL_TEMPLATES` live on the server subpath — importing them into a browser bundle would pull NestJS in with them. Pass the purpose to your frontend as a plain string.

---

## 🚨 Errors

| Member                           | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `NotificationException`          | `HttpException` carrying a stable `code`, a status, and optional `details` |
| `NotificationExceptionOptions`   | Constructor options bag: `{ status?, message?, cause? }`                   |
| `NOTIFICATION_ERROR_CODES`       | The stable `notification.*` codes — branch on these, not on messages       |
| `NOTIFICATION_ERROR_DEFINITIONS` | Server-side code → HTTP status + default English message                   |

Codes never change once published; default messages are English, so localize on the `code`. A code marked **reserved** is in the catalog but never thrown by the library. The OTP verify codes are reserved: `verify()` returns its failure as a result (`{ valid: false, reason }`) and never throws it, so your controller maps `reason` to the code it answers with. The SMS and push codes stay reserved until those channels exist.

| Code                                             | Status | Raised by                                                                                                                           |
| ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `notification.email_provider_not_configured`     | 500    | `EmailService` — the provider reports `isConfigured() === false`                                                                    |
| `notification.email_send_failed`                 | 502    | `EmailService` — the provider rejected the send                                                                                     |
| `notification.email_attachments_too_large`       | 413    | `EmailService` — the attachments exceed `maxAttachmentBytes`                                                                        |
| `notification.email_invalid_recipient`           | 400    | reserved — `to` is not validated; a bad address surfaces as `email_send_failed`                                                     |
| `notification.email_missing_body`                | 400    | `NotificationService.dispatch` — neither a template nor a subject and body                                                          |
| `notification.template_not_found`                | 500    | `EmailService.sendTemplate` — no template for the locale or the fallback (for `otp_code`, `details.remedy` says how to register it) |
| `notification.template_render_failed`            | 500    | `EmailService.sendTemplate` — the renderer threw                                                                                    |
| `notification.otp_storage_not_configured`        | 500    | `OtpService` — the OTP channel is absent                                                                                            |
| `notification.otp_email_delivery_not_configured` | 500    | `OtpService.generate` — email delivery without an email channel                                                                     |
| `notification.otp_manual_delivery_unavailable`   | 400    | `OtpService.generate` — manual delivery while `otp.codeSecret` is set                                                               |
| `notification.otp_cooldown_active`               | 429    | `OtpService.generate` and `resend` — inside the resend cooldown                                                                     |
| `notification.otp_not_found`                     | 404    | reserved — `verify()` returns `{ valid: false, reason: 'not_found' }`                                                               |
| `notification.otp_expired`                       | 410    | reserved — an expired code is reported as `not_found`                                                                               |
| `notification.otp_max_attempts_exceeded`         | 429    | reserved — `verify()` returns `{ valid: false, reason: 'max_attempts' }`                                                            |
| `notification.otp_invalid_code`                  | 401    | reserved — `verify()` returns `{ valid: false, reason: 'invalid_code' }`                                                            |
| `notification.otp_invalid_length`                | 400    | module options validation and the code generator                                                                                    |
| `notification.sms_provider_not_configured`       | 500    | reserved — the SMS channel is not implemented                                                                                       |
| `notification.sms_send_failed`                   | 502    | reserved — the SMS channel is not implemented                                                                                       |
| `notification.sms_invalid_recipient`             | 400    | reserved — the SMS channel is not implemented                                                                                       |
| `notification.push_provider_not_configured`      | 500    | reserved — the push channel is not implemented                                                                                      |
| `notification.push_send_failed`                  | 502    | reserved — the push channel is not implemented                                                                                      |
| `notification.audit_log_failed`                  | 500    | `EmailService`, `OtpService` and `NotificationAuditInterceptor` — only with `audit.swallowErrors: false`                            |
| `notification.channel_disabled`                  | 501    | `NotificationService` — the channel is absent, or its provider or storage is not usable                                             |
| `notification.invalid_scope_identifier`          | 400    | `OtpService`, `EmailService` and `NotificationAuditInterceptor` — a blank or control-character tenant or recipient                  |

The library attaches the underlying error as the native `Error.cause`, as a **log-safe copy**: `name`, `message`, `stack` and the depth-bounded `cause` chain survive, and every other property is dropped, because SDK errors retain the request payload and, for an OTP email, that payload holds the code. The cause never enters the HTTP response, and `details` stays client-safe. To attach one yourself, pass the options bag third: `new NotificationException('EMAIL_SEND_FAILED', { providerName }, { cause: error })`.

### Secrets in provider error text

A relay that quotes the rejected content puts the rendered body into the provider error, which rides the `cause` into your logs. Two controls, both per send:

- **Declare the secret.** `auditRedactValues: [code]` scrubs it from the `cause`, from the failed-audit `errorMessage`, and from the provider's own error logging (as `EmailSendOptions.redactValues`). Any run of 16+ characters of the rendered body found in a provider error is also redacted.
- **Withhold the provider text.** `publishProviderText: false` (the built-in OTP delivery already sets it) removes every byte the provider wrote: no `cause`, and an `errorMessage` of `[provider text withheld]`. It publishes only the SMTP reply code and the RFC 3463 enhanced code, which are independent of the secret. The audit entry names them `deliveryStatus` / `deliveryEnhancedStatus`; the exception's `details` names them `status` / `enhanced`.

```ts
await emailService.send({
  tenantId,
  to: user.email,
  subject: 'Your code',
  html: rendered,
  publishProviderText: false // this body carries a credential
})
// On failure: NotificationException('notification.email_send_failed')
//   details → { providerName: 'smtp', status: 550, enhanced: '5.7.1' }
//   cause   → absent
// Audit entry: { verb: 'failed', errorMessage: '[provider text withheld]',
//                deliveryStatus: 550, deliveryEnhancedStatus: '5.7.1', … }
```

> [!WARNING]
> Declared values are not a barrier. A relay quotes what it _transmitted_ (a MIME body travels raw, quoted-printable or base64), so a declared `123456` cannot match `MTIzNDU2`, and no list of values closes an encoding gap. For a secret-bearing send, withhold the provider text and use declared values as precision on top. The default of `publishProviderText` is `true`: for a receipt or a marketing send the provider's message is often the only diagnosis available.

---

## 🚫 What This Library Does NOT Do

- **No SMS or push channel.** Only email and OTP exist; the SMS and push error codes and tokens are reserved.
- **No HTTP endpoints.** It ships no controller or route. Your controller resolves the tenant, calls the services, and maps `verify()` results to responses.
- **No rate limiting by IP.** It bounds failed attempts per recipient and purpose, not requests per client. Rate-limit the OTP endpoints yourself.
- **No database or ORM.** It never imports `@prisma/client`; persistence is behind `IOtpStorage` and `INotificationLogRepository`, which you implement or take from the bundled adapters.
- **No address validation.** `to` is not validated, so a bad address surfaces as `email_send_failed` from the provider.
- **No translations.** Default error messages are English; localize on the `code`.
- **No template engine beyond `{{var}}`.** Handlebars, MJML and React Email plug in through `IEmailTemplateRenderer`.
- **No `useClass` / `useExisting` configuration.** `forRootAsync` supports `useFactory` only and rejects the others at startup.
- **No verification in the React hooks.** They drive the input box and the countdown; verifying the code is your app's job.

---

## 🤝 Contributing

Contributions are welcome. Read the [contributing guidelines](./CONTRIBUTING.md) before submitting a pull request; it covers the setup and the checks a change has to pass.

---

## 🔒 Security Policy

If you discover a security vulnerability, please **do not** open a public issue. Instead, use GitHub Private Vulnerability Reporting (or email **support@bymax.one** if you cannot) with details. We take security seriously and will respond promptly. The full policy is in [SECURITY.md](./SECURITY.md).

---

## 📄 License

[MIT](./LICENSE) © [Bymax One](https://github.com/bymaxone)

---

<p align="center">
  <sub>Built with ❤️ by <a href="https://github.com/bymaxone">Bymax One</a></sub>
</p>
