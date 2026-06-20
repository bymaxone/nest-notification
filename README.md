<p align="center">
  <img src="https://img.shields.io/badge/%40bymax--one-nest--notification-000000?style=for-the-badge&logo=nestjs&logoColor=E0234E" alt="@bymax-one/nest-notification" />
</p>

<h1 align="center">@bymax-one/nest-notification</h1>

<p align="center">
  <strong>Multi-channel notification library for NestJS</strong><br />
  <sub>Email · OTP · Multi-Tenant · Pluggable Providers · Zero Runtime Dependencies · Prisma-Free</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@bymax-one/nest-notification"><img src="https://img.shields.io/npm/v/@bymax-one/nest-notification?style=flat-square&colorA=000000&colorB=000000" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@bymax-one/nest-notification"><img src="https://img.shields.io/npm/dm/@bymax-one/nest-notification?style=flat-square&colorA=000000&colorB=000000" alt="npm downloads" /></a>
  <a href="https://github.com/bymaxone/nest-notification/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/bymaxone/nest-notification/ci.yml?branch=main&style=flat-square&colorA=000000&label=CI" alt="CI status" /></a>
  <a href="https://github.com/bymaxone/nest-notification/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square&colorA=000000" alt="coverage" /></a>
  <a href="https://github.com/bymaxone/nest-notification/blob/main/docs/mutation_testing_results.md"><img src="https://img.shields.io/badge/mutation-%E2%89%A595%25-brightgreen?style=flat-square&colorA=000000" alt="mutation score" /></a>
  <a href="https://scorecard.dev/viewer/?uri=github.com/bymaxone/nest-notification"><img src="https://api.scorecard.dev/projects/github.com/bymaxone/nest-notification/badge?style=flat-square" alt="OpenSSF Scorecard" /></a>
  <a href="https://github.com/bymaxone/nest-notification/blob/main/LICENSE"><img src="https://img.shields.io/github/license/bymaxone/nest-notification?style=flat-square&colorA=000000&colorB=000000" alt="license" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-24%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" /></a>
</p>

<p align="center">
  <a href="https://github.com/bymaxone/nest-notification">GitHub</a> ·
  <a href="https://github.com/bymaxone/nest-notification/issues">Issues</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-subpath-exports">Subpaths</a> ·
  <a href="#-multi-tenant-security">Security</a> ·
  <a href="./CHANGELOG.md">Changelog</a> ·
  <a href="./SECURITY.md">Security Policy</a>
</p>

---

## Overview

`@bymax-one/nest-notification` is a transactional notification library for **NestJS 11**.
It ships two channels in v0.1 — **email** and **OTP** (one-time passwords) — behind a
single dynamic module, with everything that touches the outside world (the email
transport, the OTP store, the template renderer, the audit sink) expressed as an
**interface** you implement or pick from the bundled reference adapters.

The design goal is **decoupling**. A hand-rolled email-verification service usually
reaches straight for a database client to persist codes, hard-wiring your schema and
your ORM into a cross-cutting concern. This library **never imports `@prisma/client`**
(or any ORM): persistence lives behind `IOtpStorage` and `INotificationLogRepository`,
so the same module runs on Redis, an in-memory map, Postgres, DynamoDB, or anything you
write — without touching the call sites.

It is **multi-tenant by design**. Every operation is scoped by a `tenantId`, OTP store
keys are `sha256(tenantId:recipient)` (no recipient PII in keys, no cross-tenant
collision), and an opt-in audit interceptor can resolve the trusted tenant from the
request rather than the request body.

It ships **zero runtime dependencies** — `"dependencies": {}`. NestJS, your email SDK,
your Redis client, and React are all **peer dependencies**, pulled in only for the
channels you actually use. OTP cryptography uses `node:crypto` exclusively
(`randomInt`, `timingSafeEqual`) — no `crypto-js`, no `otpauth`, no `uuid`.

## Features

- **Email channel** — pluggable `IEmailProvider` (bundled `ResendEmailProvider` and a
  `NoOpEmailProvider` for dev/test), template rendering, attachment size guard.
- **OTP channel** — CSPRNG codes (`numeric` / `alpha` / `alphanumeric`), TTL + max-attempts,
  **atomic** attempt counting and resend cooldown (no race-conditioned bypass), optional
  email delivery via the email channel, per-purpose overrides.
- **Multi-tenant** — `sha256(tenantId:recipient)` store keys, `tenantIdResolver`
  anti-spoofing, never-log-codes invariant enforced by a regression test.
- **Pluggable everywhere** — `IEmailProvider`, `IOtpStorage`, `IEmailTemplateRenderer`,
  `INotificationLogRepository`. Bring your own; the module wires the ones you configure.
- **Audit log** — opt-in fire-and-forget `INotificationLogRepository` + a
  `NotificationAuditInterceptor`; codes are never written to it.
- **Three subpaths** — `.` (NestJS server), `./shared` (zero-dep types + constants),
  `./react` (browser OTP-input/countdown hooks).
- **Zero runtime dependencies** — everything is a peer dep; `node:crypto` only for secrets.
- **Strict quality bar** — TS strict, 100% line/branch coverage, mutation score ≥ 95%
  (driven toward 100%), published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

## Subpath Exports

| Subpath      | Import specifier                              | Purpose                                              | Peer deps                          |
| ------------ | --------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| `.` (server) | `@bymax-one/nest-notification`                | NestJS module, services, providers, errors, tokens   | `@nestjs/common`, `@nestjs/core`, `reflect-metadata`, `rxjs` (+ your provider/storage SDKs) |
| `./shared`   | `@bymax-one/nest-notification/shared`         | Types + constants (error codes, TTLs) — zero deps    | none                               |
| `./react`    | `@bymax-one/nest-notification/react`          | `useOtpInput` + `useOtpCountdown` hooks (UX/state only) | `react ^19`                      |

Each subpath ships ESM (`.mjs`), CJS (`.cjs`), and type declarations (`.d.ts`).

## Installation

```bash
# pnpm (recommended)
pnpm add @bymax-one/nest-notification

# npm
npm install @bymax-one/nest-notification

# yarn
yarn add @bymax-one/nest-notification
```

Then add only the peer deps for the channels you use, for example:

```bash
# Production email + OTP over Redis
pnpm add resend ioredis

# React OTP input on the frontend
pnpm add react
```

> **Requirements:** Node.js **24+** and NestJS **11**.

## Quick Start

Three complete, copy-pasteable scenarios. Each is a full `AppModule` you can drop in.

### 1 · Development — `NoOpEmailProvider` + `InMemoryOtpStorage`

No external services. Emails are logged (subject + recipient only, never the body), and
OTP state lives in process memory. Ideal for local dev and tests.

```typescript
import { Module } from '@nestjs/common'
import {
  BymaxNotificationModule,
  NoOpEmailProvider,
  InMemoryOtpStorage,
} from '@bymax-one/nest-notification'

@Module({
  imports: [
    BymaxNotificationModule.forRoot({
      email: {
        provider: new NoOpEmailProvider(),
        defaultFrom: 'no-reply@dev.local',
      },
      otp: {
        storage: new InMemoryOtpStorage(),
        defaultLength: 6,
        defaultTtlSeconds: 600,
        defaultMaxAttempts: 5,
        resendCooldownSeconds: 60,
      },
    }),
  ],
})
export class AppModule {}
```

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
      deliverVia: 'email',
    })
    return { expiresAt }
  }

  /** Verify a submitted code. */
  async confirm(tenantId: string, email: string, code: string): Promise<boolean> {
    const result = await this.otp.verify({
      tenantId,
      recipient: email,
      purpose: 'email_verification',
      code,
    })
    return result.valid
  }
}
```

### 2 · Production — Resend + Redis

Real email via [Resend](https://resend.com) and OTP state in Redis (keys are SHA-256
hashed). Wire your `ioredis` client however your app already does.

```typescript
import { Module } from '@nestjs/common'
import Redis from 'ioredis'
import {
  BymaxNotificationModule,
  ResendEmailProvider,
  RedisOtpStorage,
  DefaultTemplateRenderer,
} from '@bymax-one/nest-notification'

const redis = new Redis(process.env.REDIS_URL!)

@Module({
  imports: [
    BymaxNotificationModule.forRoot({
      global: {
        redisNamespace: 'notification',
        defaultLocale: 'en',
        // Trust the tenant from a gateway-verified header, not the request body.
        tenantIdResolver: (req) => String(req.headers['x-tenant-id'] ?? 'default'),
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
              text: 'Your code is {{code}}. It expires in {{expiresInMinutes}} minutes.',
            },
          },
        }),
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
            resendCooldownSeconds: 60,
          },
        },
      },
    }),
  ],
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
      defaultFrom: config.getOrThrow('MAIL_FROM'),
    },
    otp: { storage: new RedisOtpStorage({ redisClient: redis }) },
  }),
})
```

> `forRootAsync` supports the `useFactory` pattern in v0.1. `useClass` / `useExisting`
> are deferred to v0.2.

### 3 · With audit log — Prisma example

The library never imports Prisma. You implement `INotificationLogRepository` against
your own client; the module calls it fire-and-forget (errors are swallowed by default so
the audit sink can never crash the notification flow). A copy-pasteable Prisma schema
fragment lives in [`docs/schemas/notification-log.prisma`](./docs/schemas/notification-log.prisma)
and a full repository in [`docs/schemas/prisma-repository.example.md`](./docs/schemas/prisma-repository.example.md).

```typescript
import { Injectable } from '@nestjs/common'
import type {
  INotificationLogRepository,
  NotificationLogEntry,
} from '@bymax-one/nest-notification'
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
        userId: entry.userId ?? null,
      },
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
    maskRecipient: (r) => r.replace(/^(.).*(@.*)$/, '$1***$2'), // jane@acme.com -> j***@acme.com
  },
})
```

To capture HTTP-level `sent` / `failed` entries automatically, apply the interceptor:

```typescript
import { NotificationAuditInterceptor } from '@bymax-one/nest-notification'
// @UseInterceptors(NotificationAuditInterceptor) on a controller/handler, or wire it globally.
```

## Configuration

Configure via `forRoot(options)` or `forRootAsync({ useFactory })`. Full reference:
[`docs/technical_specification.md` §4](./docs/technical_specification.md). At least one
channel must be configured. The most-used options:

| Section  | Option                    | Default          | Notes                                                      |
| -------- | ------------------------- | ---------------- | ---------------------------------------------------------- |
| `global` | `redisNamespace`          | `'notification'` | Prefix for store keys.                                     |
| `global` | `defaultLocale`           | `'en'`           | Template locale fallback.                                  |
| `global` | `tenantIdResolver`        | —                | `(req) => tenantId`; the audit source of truth.            |
| `email`  | `provider`                | — (required)     | Instance or class implementing `IEmailProvider`.           |
| `email`  | `defaultFrom`             | — (required)     | Must look like an email address.                           |
| `email`  | `templateRenderer`        | default renderer | Any `IEmailTemplateRenderer`.                              |
| `email`  | `maxAttachmentBytes`      | `10485760`       | 10 MiB attachment guard.                                   |
| `otp`    | `storage`                 | — (required)     | Instance or class implementing `IOtpStorage`.              |
| `otp`    | `defaultLength`           | `6`              | 1–32.                                                      |
| `otp`    | `defaultCodeType`         | `'numeric'`      | `numeric` \| `alpha` \| `alphanumeric`.                    |
| `otp`    | `defaultTtlSeconds`       | `600`            | Code lifetime.                                             |
| `otp`    | `defaultMaxAttempts`      | `5`              | Verify attempts before lock-out.                           |
| `otp`    | `resendCooldownSeconds`   | `60`             | Anti-resend window (atomic `SET NX EX`).                   |
| `otp`    | `perPurpose`              | `{}`             | Per-purpose overrides of the above.                        |
| `audit`  | `repository`              | — (required)     | Any `INotificationLogRepository`.                          |
| `audit`  | `swallowErrors`           | `true`           | Keep audit failures out of the delivery path.              |
| `audit`  | `maskRecipient`           | identity         | Minimize recipient PII before persisting.                  |

> **`sms` / `push` are rejected in v0.1.** The interfaces are declared so you can plan
> ahead, but configuring those channels throws at startup. See [Roadmap](#-roadmap).

## Bring Your Own Provider

Every external boundary is an interface — implement it and pass the instance (or class)
to `forRoot`. The bundled `ResendEmailProvider` and `RedisOtpStorage` are reference
implementations, not requirements.

```typescript
import type { IEmailProvider, EmailSendOptions, EmailSendResult } from '@bymax-one/nest-notification'

export class SendGridEmailProvider implements IEmailProvider {
  readonly name = 'sendgrid'
  isConfigured(): boolean {
    return Boolean(this.apiKey)
  }
  async send(options: EmailSendOptions): Promise<EmailSendResult> {
    // call SendGrid; throw on failure — EmailService maps it to a NotificationException
    return { messageId: '…' }
  }
}
```

```typescript
import type { IOtpStorage } from '@bymax-one/nest-notification'
// Implement set/get/consumeAttempt/update/delete/tryAcquireCooldown/getCooldown/clearCooldown.
// consumeAttempt and tryAcquireCooldown MUST be atomic — see the interface JSDoc.
```

Adapter examples for several providers and stores live under
[`docs/templates/`](./docs/templates/) and [`docs/schemas/`](./docs/schemas/):

| Email provider | Adapter example                                                      |
| -------------- | ------------------------------------------------------------------- |
| Resend         | bundled — `ResendEmailProvider`                                     |
| SendGrid       | implement `IEmailProvider` (sketch above)                          |
| AWS SES        | implement `IEmailProvider`                                          |
| Mailgun        | implement `IEmailProvider`                                          |

| Template engine | Adapter example                                                                  |
| --------------- | -------------------------------------------------------------------------------- |
| Default         | bundled — `DefaultTemplateRenderer` (`{{var}}` interpolation, HTML-escaped)      |
| Handlebars      | [`docs/templates/handlebars-renderer.example.md`](./docs/templates/handlebars-renderer.example.md) |
| MJML            | [`docs/templates/mjml-renderer.example.md`](./docs/templates/mjml-renderer.example.md) |
| React Email     | [`docs/templates/react-email-renderer.example.md`](./docs/templates/react-email-renderer.example.md) |

## Multi-tenant Security

This library is multi-tenant by design. Every operation is scoped by `tenantId`, and
three mechanisms keep tenants isolated and recipient data private.

### 1. SHA-256 storage keys (privacy + isolation)

OTP entries and resend cooldowns are stored under a key derived from
`sha256(tenantId:recipient)` — never the plaintext recipient or tenant id:

```
notification:otp:email_verification:7f3d8c91…  (64 hex chars)
```

- **Privacy.** An operator with `KEYS notification:otp:*` access to Redis — or anyone
  holding a leaked backup — cannot enumerate which emails/phones have a pending OTP. The
  recipient never appears in a key.
- **Isolation.** Two tenants sharing the same recipient produce different keys, so a
  cross-tenant collision is computationally infeasible (SHA-256 preimage resistance). One
  tenant's OTP, cooldown, and verification can never touch another's.

The trade-off — opaque keys you cannot read back to a recipient — is intentional: keys
are an index, not a data source. The recipient lives only inside the TTL-bound value, and
(optionally masked) in the audit log.

### 2. `tenantIdResolver` (anti-spoofing)

When you expose notification endpoints over HTTP, a caller could forge another tenant's
id in the request body — e.g. POST `{ "tenantId": "tenant_a", … }` from `tenant_b` to
verify someone else's OTP. To close this, configure a `tenantIdResolver` that reads the
tenant from a **trusted** source (a verified JWT claim, a subdomain, a gateway-checked
header):

```typescript
import type { NotificationRequest } from '@bymax-one/nest-notification'

BymaxNotificationModule.forRoot({
  global: {
    // Subdomain-based: `acme.app.com` -> `acme`.
    tenantIdResolver: (req: NotificationRequest) => req.hostname?.split('.')[0] ?? 'default',
  },
  // …channels
})

// JWT-claim based (the request is augmented by your auth middleware):
const tenantIdResolver = (req: NotificationRequest): string =>
  String(req.headers['x-tenant-id'] ?? 'default')
```

`NotificationRequest` is a minimal, framework-agnostic request shape (Express and Fastify
compatible). When a resolver is set, the opt-in `NotificationAuditInterceptor` uses it as
the **source of truth** for the audited tenant id — any `tenantId` in the payload becomes
a mere suggestion that the resolver overrides.

> The resolver governs what the audit interceptor trusts. Service methods still take an
> explicit `tenantId`: resolve the tenant in your controller and pass it down — there is
> no hidden override of a method argument.

### 3. Least-privilege logging (codes are never logged)

OTP codes are a bearer secret. The library **never** writes a code to any sink:

- Not to the audit log — an audit entry is
  `{ verb, tenantId, recipient, purpose, providerName, … }`, never `code`.
- Not to a console/logger line, and not inside an `errorMessage` (which carries the
  message only — never a stack trace).

Codes exist only inside the OTP store (with a TTL) and in process memory for the duration
of the request. Configure `audit.maskRecipient` to minimize the recipient before it is
persisted (e.g. `jane@acme.com` → `j***@acme.com`). A regression test asserts the
invariant directly: `JSON.stringify(auditEntry).includes(code) === false`.

## Templates

Email rendering goes through `IEmailTemplateRenderer`. The bundled
`DefaultTemplateRenderer` does `{{var}}` interpolation with **automatic HTML escaping in
the HTML body** (subject and plaintext are left raw, since they are not HTML contexts) —
closing a stored-XSS vector when an interpolated value contains markup. Register named
templates per `name::locale` and the renderer falls back to the `en` locale.

`CANONICAL_EMAIL_TEMPLATES` exports stable names for common transactional emails
(`otp_code`, `otp_password_reset`, `welcome`, `password_reset_success`, …) so providers
and templates agree on the wire. For richer output, plug in Handlebars, MJML, or React
Email — examples under [`docs/templates/`](./docs/templates/).

### Frontend OTP hooks (`./react`)

The `./react` subpath is browser-only state/UX — it renders the OTP-input box and a
countdown; **verifying the code is your app's job** (call your backend). No HTTP client,
no Node builtins.

```tsx
import { useOtpInput, useOtpCountdown } from '@bymax-one/nest-notification/react'

function OtpForm({ expiresAt }: { expiresAt: number }) {
  const { values, onChange, onKeyDown, onPaste, refs, code, isComplete } = useOtpInput({
    length: 6,
    type: 'numeric',
    onComplete: (full) => void submitToBackend(full),
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
      <button disabled={!isComplete}>Verify {code}</button>
    </form>
  )
}
```

## Testing & Quality

| Gate                 | Standard                                                              |
| -------------------- | -------------------------------------------------------------------- |
| Type safety          | TypeScript `strict`, zero `any`                                      |
| Coverage             | **100%** line/branch/function/statement per file (`pnpm test:cov`)  |
| Mutation             | Stryker score **≥ 95%** (break 95), driven toward 100%              |
| Lint                 | ESLint flat config + `eslint-plugin-security`, zero warnings         |
| Bundle budgets       | server < 30 KB · shared < 4 KB · react < 8 KB brotli (`pnpm size`)  |
| Prisma-free          | `pnpm check:no-prisma` — the library never imports `@prisma/client` |
| Supply chain         | published with npm provenance (OIDC), CodeQL + OpenSSF Scorecard     |

```bash
pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size
```

## Roadmap

| Version | Scope                                                                                  |
| ------- | -------------------------------------------------------------------------------------- |
| **v0.1** (current) | Email + OTP channels, multi-tenant, pluggable providers/storage, audit log, React hooks. |
| **v0.2** (planned) | **SMS** and **Push** channels (`ISmsProvider` / `IPushProvider` already declared), `forRootAsync` `useClass` / `useExisting`. |
| **v0.3** (planned) | Multi-provider failover and routing.                                                   |

> **SMS + Push are deferred to v0.2.** Their interfaces ship in v0.1 so you can plan your
> dispatch code paths, but the services are not implemented and configuring those channels
> is rejected at startup.

## Contributing

Issues and pull requests are welcome. Please run `pnpm typecheck && pnpm lint && pnpm test:cov`
before opening a PR, and follow [Conventional Commits](https://www.conventionalcommits.org/).
Security reports go through the process in [`SECURITY.md`](./SECURITY.md), not public issues.

## License

[MIT](./LICENSE) © Bymax One
