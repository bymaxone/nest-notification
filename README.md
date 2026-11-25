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
- ✅ **Stable error catalog** — namespaced codes shared byte-for-byte between server and frontend, so you localize on the `code`
- ✅ **Dual-format output** — ESM + CJS + declarations for both, verified against the packed tarball on every PR
- ✅ **Typed end to end** — TypeScript `strict` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`; zero `any`

---

## 📦 Subpath Exports

One package, five entry points — import only what your app needs:

| Subpath           | Import                                       | Purpose                                                |                                 Peer deps                                  |
| ----------------- | -------------------------------------------- | ------------------------------------------------------ | :------------------------------------------------------------------------: |
| **Server**        | `@bymax-one/nest-notification`               | NestJS module, services, providers, errors, tokens     |                   NestJS 11 (+ your provider/store SDKs)                   |
| **Shared**        | `@bymax-one/nest-notification/shared`        | Types + constants (error codes, TTLs)                  |                                    None                                    |
| **React**         | `@bymax-one/nest-notification/react`         | `useOtpInput` + `useOtpCountdown` (UX/state only)      |                                  React 19                                  |
| **Testing**       | `@bymax-one/nest-notification/testing`       | Executable `IOtpStorage` contract for your own storage |                                    None                                    |
| **Observability** | `@bymax-one/nest-notification/observability` | Metrics, spans and a readiness check                   | `@bymax-one/nest-core`, `prom-client`, `@opentelemetry/api` (all optional) |

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

`ResendEmailProvider` bounds every send with `timeoutMs` (default `15000`, an integer from `1` to `2147483647`), from the request to the end of the response body. A send that exceeds it fails with `EMAIL_SEND_FAILED` and the reason `Resend request timed out after <n> ms`. **A timed-out send may still have been delivered:** only the answer is missing, so do not treat the failure as proof the message was not sent. The library does not retry a failed send; an application that retries one (from a queue job, for example) should pass an idempotency key, which `resend` 6.x accepts as `idempotencyKey`, because the earlier attempt may already have been delivered.

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

`tls` takes `rejectUnauthorized`, `servername`, `ca`, `minVersion`, `maxVersion`, `ciphers`, `checkServerIdentity`, `cert`, `key`, `passphrase` and `pfx`, and passes them to the transport as given; each value is checked when the provider is built (a boolean for `rejectUnauthorized`, a string for `servername`, `ciphers` and `passphrase`, one of `TLSv1` to `TLSv1.3` for the two version bounds, a string, a Buffer or an array of them for `ca` and `cert`, the same or, inside an array, Node's object carrying a passphrase (`{ pem, passphrase }`, `{ buf, passphrase }`) for `key` and `pfx`, a function for `checkServerIdentity`), and a wrong type fails the build naming the key and the type but never the value; any other key fails when the provider is built, naming it, so a setting you asked for is forwarded or refused and never dropped.

`SmtpEmailProvider` also bounds the whole call with `sendTimeoutMs` (default `60000`). Every SMTP timeout (`sendTimeoutMs`, `connectionTimeout`, `greetingTimeout`, `socketTimeout`) and `ResendEmailProvider`'s `timeoutMs` must be an integer from `1` to `2147483647`, and the provider refuses anything else when it is built: a value outside that range, or one that is not a number, can make a timer fire at once or leave a phase unbounded, and a string is refused even when it is numeric, because a bound is a number. The other timeouts bound a phase or an idle socket, so a relay that keeps trickling bytes could hold a send past all of them. A send that exceeds the bound fails with `EMAIL_SEND_FAILED` and the code `ETIMEDOUT`. **A timed-out send may still have been delivered:** nodemailer cannot abort a send in flight, so only the answer is missing; do not treat the failure as proof the message was not sent. The library leaves the connection open, so a pooled transport keeps its other sends. `socketTimeout` reaps the connection once the relay goes idle; a relay that keeps sending holds it until the relay ends the connection or the process exits.

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

A custom `IOtpStorage` implements the interface the package exports, including `deleteIfCode` when you set `consumeOnVerify`; the `/testing` subpath runs it against the contract. The library also checks what the store answers: `tryAcquireCooldown` and `deleteIfCode` must resolve a boolean, `isConfigured()` must return one, `recordFailure` must resolve an integer of at least `1`, and `consumeAttempt` must resolve one of its three statuses (an `ok` carries an entry with a string `code`, a finite `expiresAt`, and whole-number `attempts` and `maxAttempts`). An answer of another kind is refused with `notification.otp_storage_failed` (`notification.otp_storage_not_configured` for `isConfigured()`), and never read as a lock that was taken, a code that was removed, or a budget that was not spent. Besides the attempt and cooldown methods, the interface requires `getCooldown(tenantId, recipient, purpose)`, which answers the seconds left on an active cooldown or `0`, and `clearCooldown(tenantId, recipient, purpose)`, which is idempotent and is called when a delivery fails, on `consume()`, and after a successful `verify()` when `consumeOnVerify` is set.

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

**Control characters are escaped before your repository sees an entry.** An entry carries values a caller chose (a recipient, a user id, an error text, a template name), and a line feed in one of them starts a second record in a log or a store that writes lines. Every string of an entry, and every key and string value of its `metadata`, reaches `create` with the C0 and C1 controls, the Unicode line and paragraph separators and the bidirectional controls written as visible sequences (`\n`, `\r`, `\t`, `\uXXXX`); a backslash is left as it is, so a key that escapes to the text of an earlier key takes a `#2`, `#3` suffix instead of replacing it. Metadata is kept down to 3 levels of nesting below the `metadata` object; a subtree deeper than that arrives as `[depth limit]`, a cycle as `[circular]`, and a value that is not a plain object, an array or a primitive as `[non-plain value]`. The module does this for every writer it wires, and the `BYMAX_NOTIFICATION_LOG_REPOSITORY` token still resolves to your own repository. A host that builds `OtpService`, `EmailService` or `NotificationAuditInterceptor` itself, with `new`, bypasses the wiring and has its own repository's `create` escape the strings of the entry the same way. The length of a value is not bounded here. The failure lines the library logs from text it did not write (the reason an SMTP relay or the Resend API gives, and the error a template renderer throws at startup) carry it with the same escape; the error those providers throw keeps the text as it came, and is yours to escape if you log it.

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

## 🏭 Production

What the library leaves to you, and what to set before real traffic. The option tables are in the Configuration section and in [`docs/smtp-provider.md`](./docs/smtp-provider.md); nothing here restates a default.

### The Redis client is yours: bound it, and close it

`RedisOtpStorage` uses the client you give it. It never connects it, configures it or quits it. A client with no bounds turns a Redis outage into requests that hang. With a connect timeout, a command timeout and a bounded retry policy, the same outage reaches the caller as the library's `503`: a command that fails because the server cannot be reached is answered as unavailable.

```typescript
import Redis from 'ioredis'
import { RedisOtpStorage } from '@bymax-one/nest-notification'

const client = new Redis(process.env.REDIS_URL!, {
  connectTimeout: 5_000,
  commandTimeout: 2_000,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(attempt * 200, 2_000)
})

const storage = new RedisOtpStorage({ redisClient: client })
```

Close the client in your own shutdown hook, after Nest has closed the application, so no OTP operation is still running when its connection goes.

### Bound every send

`ResendEmailProvider` takes `timeoutMs` and `SmtpEmailProvider` takes `sendTimeoutMs`, plus the phase timeouts, each with its default in the option tables. A send that times out fails with `EMAIL_SEND_FAILED`, and **may still have been delivered**: make the job that retries it idempotent, as the Apply note of 1.4.9 says.

### Shut down cleanly

Call `app.enableShutdownHooks()`, or close the application yourself, and Nest calls `onModuleDestroy` on the providers. `SmtpEmailProvider` closes its transport there. That matters once you set `pool`: a pool keeps sockets to the relay open, and without a close they keep the process alive. `close()` is also public and idempotent. A send already in flight on a pooled transport finishes; one still waiting for a connection fails with `Connection pool was closed`. A `send()` after `close()` builds a new transport, which you have to close again if you keep the provider alive. A failing close is logged as `[SMTP_CLOSE_FAILED]` with no text from the relay and does not stop the other hooks.

### Store codes as digests

Without `otp.codeSecret`, codes are stored in plaintext and the startup warning `BYMAX_NOTIFICATION_PLAINTEXT_OTP_CODES` says so. In production set it to a secret of at least 32 bytes; see [Stored codes are keyed digests](#stored-codes-are-keyed-digests-when-you-set-otpcodesecret).

## 📈 Observability

### Log events

Every operational line the library writes carries an `event` field and, in `message`, its human-readable text. With `@bymax-one/nest-logger` 1.4.23 or later `event` is a field of the entry, so match on it; with the default Nest logger the line prints as the object. `message` is the library's own text, bracketed tag included, and never the text of an error from a provider, a relay or your own code. Three events report such an error (`NOTIFICATION_RESEND_SEND_FAILED`, `NOTIFICATION_SMTP_SEND_FAILED` and `NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED`): they carry it as an `Error` in the `err` field, a copy with control characters written as visible sequences; for Resend and SMTP it is also scrubbed like the error your call receives, and a send whose provider text is withheld has no `err`. An event names what happened and never what it happened to: no recipient, identifier or error text is a field of it. A line is written through one helper that catches what your logger throws, so a logger that throws synchronously loses the line and never fails a send, a verification or the module's start. Nest's `Logger` discards what your logger returns, so a logger method that is `async` and rejects cannot be caught by the library: the rejection is unhandled and, unless your application handles `unhandledRejection`, ends the Node process. Keep the logger methods synchronous, or catch inside them. In the entry `event` and `message` are the last keys, after `err` when there is one. A name your configuration supplies and the library writes into a line, an error or an audit entry (the storage's `name`, which also fills `providerName` in the audit entry and in the `OTP_STORAGE_UNAVAILABLE` and `OTP_STORAGE_FAILED` details; the email provider's `name`; the audit repository's `name`; `global.defaultLocale`; the class name `forRootAsync` refuses) is cut at 200 code points of the name, counted before any escaping, marked with `…`, and has each control, format (bidi, zero-width, byte order mark), line-separator and paragraph-separator character, and each lone surrogate, written as a visible `\uXXXX` sequence, so a name cannot start a second log line or reorder the text. A name that is not a string, or a getter that throws, is written as `[unreadable]`; the exception is `global.defaultLocale` and the other options, which are read once while the module is built, where a getter that throws fails the build with your own error.

| Event                                    | Level   | When                                                                                                                           | Tag in the text                                  |
| ---------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `NOTIFICATION_BOOTSTRAP_OK`              | `log`   | The module was built; the message names the active channels.                                                                   | `[BYMAX_NOTIFICATION_MODULE_BOOTSTRAP_OK]`       |
| `NOTIFICATION_PLAINTEXT_OTP_CODES`       | `warn`  | `forRoot` with an `otp` channel and no `otp.codeSecret`.                                                                       | `[BYMAX_NOTIFICATION_PLAINTEXT_OTP_CODES]`       |
| `NOTIFICATION_REDIS_NAMESPACE_UNUSED`    | `warn`  | `global.redisNamespace` is set; it does not reach `RedisOtpStorage`, which takes its own `namespace`. Constant text, no value. | `[BYMAX_NOTIFICATION_REDIS_NAMESPACE_UNUSED]`    |
| `NOTIFICATION_CHANNEL_NOT_USABLE`        | `warn`  | A configured email or OTP channel's provider or storage reports `isConfigured()` as `false` at startup.                        | `[BYMAX_NOTIFICATION_CHANNEL_NOT_USABLE]`        |
| `NOTIFICATION_OTP_FAILURES_NOT_CARRIED`  | `warn`  | The OTP storage lacks `getFailures`, `recordFailure` and `clearFailures`.                                                      | `[BYMAX_NOTIFICATION_OTP_FAILURES_NOT_CARRIED]`  |
| `NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED` | `warn`  | The default OTP email template does not resolve, or could not be checked.                                                      | `[BYMAX_NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED]` |
| `NOTIFICATION_AUDIT_WRITE_FAILED`        | `warn`  | An audit entry could not be written and the failure was swallowed (rate limited).                                              | `[BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED]`        |
| `NOTIFICATION_RESEND_SEND_FAILED`        | `warn`  | The Resend API call failed.                                                                                                    | `[RESEND_SEND_FAILED]`                           |
| `NOTIFICATION_SMTP_SEND_FAILED`          | `warn`  | The SMTP send failed.                                                                                                          | `[SMTP_SEND_FAILED]`                             |
| `NOTIFICATION_SMTP_CLOSE_FAILED`         | `warn`  | The SMTP transport could not be closed at shutdown.                                                                            | `[SMTP_CLOSE_FAILED]`                            |
| `NOTIFICATION_NOOP_EMAIL`                | `debug` | `NoOpEmailProvider` recorded a send, with the recipient masked.                                                                | `[NoOpEmail]`                                    |

### Metrics

The `./observability` subpath publishes three Prometheus metrics on the registry that `@bymax-one/nest-core` serves at its scrape endpoint. It needs the optional peers `@bymax-one/nest-core` and `prom-client`; the main entry imports neither, and an application that never imports the subpath pays nothing.

```ts
import { Module } from '@nestjs/common'
import { BymaxNotificationModule } from '@bymax-one/nest-notification'
import type { BymaxNotificationModuleOptions } from '@bymax-one/nest-notification'
import { NotificationObservabilityModule } from '@bymax-one/nest-notification/observability'

declare const options: BymaxNotificationModuleOptions

@Module({
  imports: [BymaxNotificationModule.forRoot(options), NotificationObservabilityModule.register()]
})
export class AppModule {}
```

| Metric                                     | Type      | Labels                                                                | Meaning                                                                                                                                                                            |
| ------------------------------------------ | --------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bymax_notification_messages_total`        | counter   | `channel` (`email`, `push`), `outcome` (`sent`, `failed`, `rejected`) | Sends the library was asked to make. `sent`: the provider accepted the message. `failed`: the provider did not. `rejected`: the library refused it before the provider was called. |
| `bymax_notification_send_duration_seconds` | histogram | `channel` (`email`, `push`)                                           | Seconds from the call to its end, in the default Prometheus buckets.                                                                                                               |
| `bymax_notification_otp_total`             | counter   | `event` (`issued`, `verified`, `failed`, `locked`)                    | What happened to one-time codes: a code issued; a code accepted; a wrong code or none live; a recipient that ran into the attempt ceiling.                                         |

A label value is always one of the listed ones: no recipient, tenant, identifier or error text is ever a label. Every series exists at zero from the first scrape, so a rate is defined from the start. The outcome follows how far the send got and not the error it ended in: a message the provider accepted counts as `sent` even when the audit write that followed failed (with `audit.swallowErrors` off), and a provider failure counts as `failed` even when the audit write of that failure failed too. A send that fails before the provider with an error that is not the library's own, such as a getter on the input that throws, counts as `failed`, not `rejected`: `rejected` is only the library's own refusal, and a `to: null` or any other field of the wrong kind is one. A code delivered by email is also a send: `OtpService` goes through `EmailService`, so it adds to `bymax_notification_messages_total` and the send histogram as well as to `bymax_notification_otp_total`. A call the library refuses outright (an invalid argument, a cooldown) records no `bymax_notification_otp_total` event.

### Traces

With the optional peer `@opentelemetry/api`, the same module runs two operations inside spans: `notification.send` (a raw or a template email send, or a push send) and `notification.otp.verify`. A span carries one attribute, `bymax.notification.channel` (`email`, `otp` or `push`). When the operation throws, the span ends with status `ERROR` and the library's error code as its message, for example `notification.email_send_failed`, or `unknown` for an error that is not the library's, and never the text of an error. A code delivered by email runs a `notification.send` span of its own. With no OpenTelemetry SDK registered the API's tracer does nothing, so the peer costs nothing until you register one. The operation's failure is rethrown unchanged whatever it is, including an object whose class cannot be read (a revoked proxy); the span's status message is then `unknown`.

### Health

`NotificationHealthIndicator` reports the readiness of the email channel as `up` or `down`, with no detail, under the name `notification`. It is marked `@BymaxHealthIndicator()`, so `@bymax-one/nest-core` discovers it when `health.autoDiscover` is on. It never sends a message. With no email channel configured there is nothing to check and it is `up`. A provider that reports `isConfigured()` as `false` is `down`. `SmtpEmailProvider` is verified with its `verify()` method (connect, greeting, TLS upgrade, login) at most once per window: a success is trusted for five minutes and a failure for thirty seconds, callers that arrive together share one verification, and it is bounded by four seconds, under the five of the core's indicator timeout. A provider that cannot verify, such as `ResendEmailProvider`, is `up` once it is configured, because that is all that can be known without a network call. Tune the windows with `register({ health: { successTtlMs, failureTtlMs, timeoutMs } })`. `verify()` answers a failure in fixed words that carry nothing of the relay's text.

## ⚙️ Configuration

Configure via `forRoot(options)` or `forRootAsync({ useFactory })`. **At least one channel must be configured**, and configuring a channel the library does not implement throws at startup rather than failing on the first send. The full reference is in [`docs/technical_specification.md` §4](./docs/technical_specification.md); the most-used options:

| Section  | Option                  | Default          | Notes                                                                                                                                                                                                                                                             |
| -------- | ----------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global` | `redisNamespace`        | `'notification'` | **Deprecated; removed in v2.0.** Exposed as `ResolvedGlobalOptions.redisNamespace`. `RedisOtpStorage` does not read it: its key prefix is its own `namespace` option, so pass that one. Setting this logs one startup warning.                                    |
| `global` | `defaultLocale`         | `'en'`           | Template locale fallback.                                                                                                                                                                                                                                         |
| `global` | `tenantIdResolver`      | —                | `(req) => tenantId`; the audit source of truth.                                                                                                                                                                                                                   |
| `email`  | `provider`              | — (required)     | Instance or class implementing `IEmailProvider`.                                                                                                                                                                                                                  |
| `email`  | `defaultFrom`           | — (required)     | Must look like an email address.                                                                                                                                                                                                                                  |
| `email`  | `templateRenderer`      | default renderer | Any `IEmailTemplateRenderer`.                                                                                                                                                                                                                                     |
| `email`  | `maxAttachmentBytes`    | `10485760`       | 10 MiB attachment guard.                                                                                                                                                                                                                                          |
| `email`  | `maxRecipients`         | `50`             | Recipients per message, `to` + `cc` + `bcc`, refused above it.                                                                                                                                                                                                    |
| `email`  | `defaultFromName`       | —                | Display name sent with `defaultFrom`.                                                                                                                                                                                                                             |
| `email`  | `defaultReplyTo`        | —                | `Reply-To` applied when a send does not set one.                                                                                                                                                                                                                  |
| `email`  | `defaultTags`           | `[]`             | Tags merged into every send, before the send's own tags.                                                                                                                                                                                                          |
| `otp`    | `storage`               | — (required)     | Instance or class implementing `IOtpStorage`.                                                                                                                                                                                                                     |
| `otp`    | `defaultLength`         | `6`              | 1–32.                                                                                                                                                                                                                                                             |
| `otp`    | `defaultCodeType`       | `'numeric'`      | `numeric` \| `alpha` \| `alphanumeric`.                                                                                                                                                                                                                           |
| `otp`    | `defaultTtlSeconds`     | `600`            | Code lifetime.                                                                                                                                                                                                                                                    |
| `otp`    | `defaultMaxAttempts`    | `5`              | Verify attempts before lock-out.                                                                                                                                                                                                                                  |
| `otp`    | `codeSecret`            | —                | Secret (>= 32 bytes) the stored code is keyed under.                                                                                                                                                                                                              |
| `otp`    | `consumeOnVerify`       | `false`          | `true` deletes the code when `verify()` succeeds, once however many verifications run together (needs `IOtpStorage.deleteIfCode`; a storage without it makes `OtpService` refuse to start); otherwise the entry is marked validated until `consume()` or its TTL. |
| `otp`    | `resendCooldownSeconds` | `60`             | Anti-resend window (atomic `SET NX EX`).                                                                                                                                                                                                                          |
| `otp`    | `perPurpose`            | `{}`             | Per-purpose overrides of the above.                                                                                                                                                                                                                               |
| `otp`    | `strictPurposes`        | `false`          | `true` refuses a purpose that is neither in `NOTIFICATION_PURPOSES` nor a key of `perPurpose`, before any storage call.                                                                                                                                           |
| `audit`  | `repository`            | — (required)     | Any `INotificationLogRepository`.                                                                                                                                                                                                                                 |
| `audit`  | `swallowErrors`         | `true`           | Keep audit failures out of the delivery path. A swallowed failure logs `BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED`, at most once a minute per channel.                                                                                                                |
| `audit`  | `maskRecipient`         | identity         | Minimize recipient PII before persisting.                                                                                                                                                                                                                         |

Numeric options are checked when the module is built, and a value the library cannot act on is refused with a message that names the option. `otp.defaultMaxAttempts` and each `perPurpose` `maxAttempts` must be an integer from `1` to `9007199254740991`, as must `email.maxRecipients` and the pool's `maxConnections` and `maxMessages`. That ceiling is the largest safe integer, the point past which a count is no longer exact; it is a limit of representation and not a recommendation, because the library knows no natural ceiling for these options, so choose one that fits your relay and your traffic. `otp.defaultTtlSeconds` and each `ttlSeconds` must be a finite number above `0`. `otp.resendCooldownSeconds` and each `perPurpose` cooldown must be a finite number of at least `0`, where `0` switches the cooldown off. `email.maxAttachmentBytes` must be a finite number of at least `0`. `otp.defaultLength` and each `perPurpose` `length` must be an integer from `1` to `32`; the `perPurpose` container, when set, and each entry in it must be an object (a `null` container is refused, an `undefined` one is read as not set, and a `null` or `undefined` entry is refused); and the SMTP provider's `port`, checked when the provider is built, must be an integer from `1` to `65535`. `NaN` is refused in every one of these options and in the SMTP timeouts: it would pass a range test and then compare false against everything, so an attempts bound of `NaN` would never lock. An option that reads as `undefined` or `null` is not set and takes its default, the same as one that is left out, and the options are checked after that. This holds for every option of the module and of both providers, for each option of a `perPurpose` entry (an entry with `maxAttempts: undefined` gets the default attempts bound, and one with `ttlSeconds: undefined` the default TTL) and for each key of the SMTP `credentials` and `tls`; a `null` `pool.maxConnections` or `pool.maxMessages` is refused. There are two exceptions. A `null` is refused for the options whose default is the weaker security posture: `audit`, `global.tenantIdResolver` (which must also be a function), `otp.codeSecret`, `otp.strictPurposes`, `otp.consumeOnVerify`, `otp.perPurpose`, `audit.swallowErrors`, `audit.maskRecipient` and the SMTP `credentials`; and for the SMTP `secure` and `requireTls`, whose omitted values are derived from the port and the host, because a `null` is not a valid value for them. And a `perPurpose` entry that is itself `null` or `undefined` is refused. A boolean option (`otp.consumeOnVerify`, `otp.strictPurposes`, `audit.swallowErrors`) must be `true` or `false`, so the string `'false'` is refused with a message naming the option and never read as `true`, and `audit.maskRecipient` must be a function. The options object itself must be an object, `global`, when set, must be one too (a `null` is read as not set), the `perPurpose` container must be a plain object or an instance of your own class (a `Map` or a `Date` is refused; an object made in another realm, such as a `vm` context, counts as a plain object), and the `codeType` of an entry must be one of the supported ones. The module and both providers read each option they declare once, by property access, into a copy, down to the keys of `credentials`, `tls` and `pool`, so a class that supplies its options from getters keeps its values. A key that is found only on the realm-root prototype (`Object.prototype`, or the same object of another realm) is treated as absent, for every option and every input the library reads by name: code that runs before the library cannot set `Object.prototype.bcc` or `Object.prototype.maxAttempts` and have it taken for yours. The objects the library hands to a provider, a mail transport, an SDK, a renderer or a store have no prototype for the same reason. Limits, stated plainly: a `Proxy` answers for itself, so a `Proxy` around your options or input with no `get` trap (or one that forwards) still resolves an unset key through its target, and a key held only on the topmost prototype of a chain you built by hand (`Object.create(Object.create(null))`) cannot be told from the realm root and is read as absent, so put an option on the object or on a class prototype. The SMTP adapter also gives Nodemailer an own key, set to your value or to `undefined`, for every name Nodemailer reads from what it is given, because it copies that into ordinary objects and then reads names this library never sets; the Resend payload gets the same for the fields its SDK reads after spreading it. Nodemailer also reads names from ordinary objects it builds itself, and nothing this library hands over can shadow those names, so the SMTP and Resend adapters refuse (`INVALID_SCOPE_IDENTIFIER`, reporting a count and never a key or a value) while `Object.prototype` holds any string key outside the runtime's standard set, or a standard key that was overwritten, redefined or removed since the library loaded: when they are built, when a send or the SMTP `verify()` starts, and again immediately before the transport's `sendMail` or `verify` or the SDK's call, so a name planted after boot is refused before any I/O. The OTP service makes the same check when `generate` and `verify` start and again after each store call whose answer is about to decide something (the cooldown, the attempt count, the consumption of the code), so a built-in it reads for a verdict that was replaced since the library loaded is refused and not obeyed. A host that extends `Object.prototype` or patches a built-in late cannot send, generate or verify through the library. The check cannot close a timing window, so the reads themselves are closed as well: the SMTP adapter opens the connection itself (`tls.connect`, or a `net.Socket` it connects, with options that have no prototype and come only from its own configuration) and hands Nodemailer the open socket, and it tells Nodemailer to open no file and no URL (`disableFileAccess`, `disableUrlAccess`; the adapter sends `content` only), so a `path`, `localAddress` or `href` that a concurrent request plants after a send has started neither moves the connection nor attaches a file. The table of listeners of the socket the adapter opens has no prototype, so a string planted under any event name is not read by Node's emitter on a later tick, where it would throw; the sockets and streams Nodemailer builds itself (the STARTTLS upgrade, a message) are its own, and a string planted under `pause` or `resume` after the check can still throw there, which freezing `Object.prototype` at startup prevents. A standard key that was not what it must be when the library loaded (a native function (not a Proxy) with its own name, and `__proto__` an accessor of native functions; the realm was polluted before it) counts on every use, and loading itself never throws. A clean process is unaffected. Freezing `Object.prototype` at startup is still the better defence for code you do not control. OTP expiry and cooldown use the live `Date.now`; a host that replaces the clock controls them. The connection is handed to Nodemailer as a stream that checks every write, so the TLS upgrade after STARTTLS writes its encrypted bytes through the same check, and a name planted once the session is up refuses the send before `MAIL FROM`, `RCPT TO` or the body. A function planted under `pipe` still ends the process inside Nodemailer's streams: freezing `Object.prototype` at startup is the defence. A recipient that is not a bare mailbox (`Bob <bob@x.com>`) goes to Nodemailer as the string it was. The Resend payload is built from own copies; the arrays in it serialise through a `toJSON` function planted on the root, which needs code to have run first. Address masking joins a line break that is followed by blanks, and a soft break of quoted-printable text, in the text it returns, so ordinary text with such a break comes out joined (`Hello\n  world` reads `Helloworld`). Address masking leaves out the base64 of a whole address and the spelled-out forms (`bob at x`, `[at]`), and a quoted local part of more than 300 units is read as ordinary characters up to a space. A refusal says what kind of value it received (`a string`, `an object`, `null`) and shows a number, but it never prints a string, a symbol or a function, which may be a credential put in the wrong option.

---

## 🎨 Templates

Email rendering goes through `IEmailTemplateRenderer`. The bundled `DefaultTemplateRenderer` does `{{var}}` interpolation with **automatic HTML escaping in the HTML body** — subject and plaintext are left raw, since neither is an HTML context. That closes a stored-XSS vector: a display name containing markup renders as text, not as an element, in the recipient's mail client. A custom renderer implements `render()` and `hasTemplate(templateName, locale)`, which answers whether the template is registered for the locale so that a missing one fails early; both are required.

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

Codes exist only inside the OTP store, under a TTL (as a keyed digest when `otp.codeSecret` is set), and in process memory for the duration of the request. `audit.maskRecipient` minimizes the recipient before it is persisted (`jane@acme.com` → `j***@acme.com`). The error text of a failed audit row, whether the services or the audit interceptor wrote it, is masked the same way: every token of it that holds an at-sign is replaced, whole, by what `audit.maskRecipient` answers for it. A regression test asserts the invariant directly: `JSON.stringify(auditEntry).includes(code) === false`.

### Stored codes are keyed digests when you set `otp.codeSecret`

A code is short: a six-digit code has a million values, so a plain hash of it is recovered by trying all of them, in a fraction of a second, by anyone who can read the store. With `otp.codeSecret` set (a string of at least 32 bytes, kept with the application and never in Redis), the store holds `hmac-sha256:v1:<hex>`, an HMAC-SHA-256 of the code under that secret, and `verify()` recomputes it and compares in constant time. A reader of the store alone then holds nothing to test a guess against. The delivered email still carries the plaintext code, and the audit entry never carries either form.

- **Unset** (the default): codes are stored in plaintext, and a warning is logged once at startup.
- **Manual delivery is refused while it is set.** `generate()` never returns the code, so a manual delivery reads it back from the store, and a store that holds a digest has nothing to hand over. `generate({ deliverVia: 'manual' })`, or the default delivery when no email channel is configured, fails with `notification.otp_manual_delivery_unavailable` (400) before the cooldown is taken or anything is stored. Deliver by email, or leave `codeSecret` unset where you read the code from the store (a local development flow, for instance).
- **Turning it on loses no live code.** An entry written in plaintext before the secret was set still verifies until it expires.
- **Changing or removing the secret** makes the digests already stored unverifiable (`invalid_code`); those codes must be requested again. Moving to a release of the library that has no `otp.codeSecret` does the same.
- A custom `IOtpStorage` is unaffected: `OtpEntry.code` is an opaque string to it.

### Which spellings share a key

The recipient is normalized before it is hashed. Surrounding whitespace is trimmed, and an email (an identifier with an ASCII `@`) is lower-cased and its domain is given the spelling the resolver gives it, so `Jane@Acme.com`, `jane@acme.com` and `jane@ａｃｍｅ.com` (fullwidth letters) are one recipient, and so are `jane@bücher.de` and `jane@xn--bcher-kva.de`. A domain the mapping would change in any other way keeps the spelling it was written in, lower-cased: an address literal, a host a URL parser reads as an address (`0x7f.1`), and a domain with anything in it that is not part of a name. The local part gets no Unicode normalization: two local parts that differ in a compatibility character (`ﬁle` and `file`) are two mailboxes at a provider that accepts them, and one key for both would let a code mailed to one verify for the other. A plus tag is kept for the same reason of not guessing a provider's rules: `jane+1@acme.com` and `jane@acme.com` are two recipients, each with its own cooldown and attempt counter, although many providers deliver both to one mailbox. A host that must limit per mailbox limits per user id, not per recipient.

### Purposes are yours

A purpose names a flow (`email_verification`, `password_reset`): 1 to 64 characters from `A-Z a-z 0-9 : _ -`. Every OTP operation and both reference storages refuse anything else with `notification.invalid_scope_identifier` (HTTP 400), and a `perPurpose` key outside that set stops the module at startup. The refusal never carries the value. The limits of a recipient are kept per `(tenant, recipient, purpose)`, and a purpose with no `perPurpose` entry uses the defaults, so a caller who can choose the purpose can ask for a fresh cooldown and a fresh attempt counter each time. Purposes are yours: a literal from `NOTIFICATION_PURPOSES` or your own list, never taken from the request. If a purpose can still reach the service from outside, set `otp.strictPurposes: true`: a purpose that is neither in `NOTIFICATION_PURPOSES` nor a key of `perPurpose` is then refused the same way (`reason: 'not a registered purpose'`), so your own flows are registered with `perPurpose: { my_flow: {} }`.

### Attempt ceilings and cooldowns are atomic

`consumeAttempt` is the only writer of the attempt counter, and `tryAcquireCooldown` (`SET NX EX`) is the only acquirer of the resend window — both inside the storage, in one indivisible step. A service-side `get` followed by an `update` looks equivalent and passes every sequential test, but two concurrent verifies read the same count and each writes back the same increment: five attempts become unbounded. The same shape lets two concurrent resends both pass the cooldown check.

### A code is accepted once, with `consumeOnVerify`

With `otp.consumeOnVerify: true`, `verify()` removes the entry with one atomic compare-and-delete in the storage (`IOtpStorage.deleteIfCode`). Of any number of verifications of the right code running together, exactly one returns `valid: true`; the others return `{ valid: false, reason: 'not_found' }`. The method receives the value the service read from the store (the keyed digest when `otp.codeSecret` is set), never the guess. A custom storage must implement it for this option, and the module refuses to start without it.

With the default, `consumeOnVerify: false`, the entry is marked validated and stays until `consume()` or its TTL, so several verifications that run together can each return `valid: true`. Make the action your app takes on success single-use itself (for example by calling `consume()` and acting only when your own state change succeeds).

### Failed attempts survive a re-issue

A per-code counter alone lets a re-issue reset the failure count: guess wrongly up to the limit, wait out the resend cooldown, and guess again. So the failed verifications of a `(tenant, recipient, purpose)` are counted in the storage, and `verify()` refuses once that count passes the purpose's attempt ceiling, whichever code is live.

- Every verification attempt against a live code adds one to the count, before its code is compared, and restarts the counter's lifetime to the purpose's code lifetime (`ttlSeconds`); a counter that is not touched for that long lapses, which starts the count again from zero. Because every attempt restarts the lifetime, attempts spaced closer apart than `ttlSeconds` never let the counter lapse; only a success, `consume()` or `ttlSeconds` of silence resets it, which is the stricter behaviour against a slow attack.
- A successful verification and `consume()` clear it (the attempt that succeeded included), so the next flow starts with a full budget.
- Once the count passes the ceiling, `verify()` returns `{ valid: false, reason: 'max_attempts' }` for any code, a freshly issued one included, until the counter lapses. The stored count alone decides, so the lockout ends exactly when the counter lapses. Because the increment is atomic and happens first, guesses that arrive together each get their own number and only those within the ceiling are compared. `remainingAttempts` reports the nearer of the code's own budget and the count's. This also means that someone who keeps sending wrong guesses for a recipient keeps that recipient locked out, so rate-limit the OTP endpoints by IP in your controller.
- `RedisOtpStorage` keeps the counter under `{namespace}:otp_fail:{purpose}:{hash}`, incremented by one script; `InMemoryOtpStorage` does the same in memory.
- A custom `IOtpStorage` opts in by implementing three **optional** methods, `getFailures`, `recordFailure` and `clearFailures`; the executable contract in `./testing` checks them when they are present. The three work together: a storage with only some of them is treated as having none. Without them each code keeps a fresh budget, and one warning, `BYMAX_NOTIFICATION_OTP_FAILURES_NOT_CARRIED`, is logged at startup naming the deviation.

### Security Checklist

When integrating `@bymax-one/nest-notification` in production, verify each of the following:

- Validate the email address in your own controller before calling `generate()`. The library refuses a recipient that is not exactly one mailbox, but it cannot tell whether the mailbox belongs to the caller
- `tenantIdResolver` reads from a **verified** source (JWT claim, subdomain, gateway-signed header) — never the request body
- `audit.maskRecipient` is configured if audit rows are retained beyond the operational minimum
- A custom `IOtpStorage` implements `consumeAttempt` and `tryAcquireCooldown` atomically (`getCooldown` and `clearCooldown` are plain reads and deletes, and are required too)
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

A one-time password is a credential, so every behavior is pinned so that a regression **fails a test**.

- ✅ **100% coverage and mutation score** — per file across unit and end-to-end tests of every subpath, with [Stryker](https://stryker-mutator.io/) at `break: 100`. The equivalent mutants no test can kill carry an inline `// Stryker disable` with the reason, so the score is an accounting rather than a target
- ✅ **Invariants asserted, not assumed** — the never-log-codes rule is a test (`JSON.stringify(entry).includes(code) === false` on every audit entry, and the thrown exception serialized recursively at every depth), not a review convention
- ✅ **Published shape verified** — `attw` resolves every entrypoint against the packed tarball, and a dogfood smoke test installs the package into a scratch consumer before any tag is cut

| Gate           | Standard                                                                      |
| -------------- | ----------------------------------------------------------------------------- |
| Type safety    | TypeScript `strict`, zero `any`                                               |
| Coverage       | **100%** line/branch/function/statement per file (`pnpm test:cov:all`)        |
| Mutation       | Stryker score **100%** (`break: 100`), no survivors                           |
| Lint           | ESLint flat config + `eslint-plugin-security`, zero warnings                  |
| Bundle budgets | brotli budget per entry point, held in `scripts/check-size.mjs` (`pnpm size`) |
| Prisma-free    | `pnpm check:no-prisma` — the library never imports `@prisma/client`           |
| Export map     | `pnpm check:exports` — `attw` against the packed tarball, ESM and CJS         |
| Supply chain   | published with npm provenance (OIDC), CodeQL + OpenSSF Scorecard              |

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

| Field                         | Notes                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `tenantId`                    | Required. Refused when blank or when it contains a control character.                                                                      |
| `to`, `cc`, `bcc`             | A string or an array, at most `maxRecipients` addresses in all (a `,` or `;` splits a string). The addresses themselves are not validated. |
| `subject`, `html`, `text`     | The message. `text` is optional.                                                                                                           |
| `from`, `fromName`, `replyTo` | Override the `defaultFrom`, `defaultFromName` and `defaultReplyTo` of the channel.                                                         |
| `tags`                        | Merged after `defaultTags`.                                                                                                                |
| `attachments`                 | `{ filename, content, contentType? }[]`; their total size is checked against `maxAttachmentBytes`.                                         |
| `userId`                      | Recorded in the audit entry.                                                                                                               |
| `auditRedactValues`           | Values scrubbed from the failure's `cause` and `errorMessage`. See [Errors](#-errors).                                                     |
| `publishProviderText`         | `false` withholds everything the provider wrote. Default `true`.                                                                           |

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

| Export                          | Implements                   | Use for                                                         |
| ------------------------------- | ---------------------------- | --------------------------------------------------------------- |
| `ResendEmailProvider`           | `IEmailProvider`             | Production email via Resend                                     |
| `SmtpEmailProvider`             | `IEmailProvider`             | Any SMTP relay, and Mailpit/MailHog in tests                    |
| `NoOpEmailProvider`             | `IEmailProvider`             | Dev/test — logs a masked recipient only                         |
| `RedisOtpStorage`               | `IOtpStorage`                | Production OTP state (atomic via Lua)                           |
| `InMemoryOtpStorage`            | `IOtpStorage`                | Dev/test — single-process only; `.size()` reports what it holds |
| `DefaultTemplateRenderer`       | `IEmailTemplateRenderer`     | `{{var}}` interpolation with HTML escaping                      |
| `NoOpNotificationLogRepository` | `INotificationLogRepository` | Audit configured but intentionally discarded                    |

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

Every token is a `Symbol()`, exported for an advanced override or a test that replaces one part of the module: `BYMAX_NOTIFICATION_OPTIONS` (the resolved, frozen options), `BYMAX_NOTIFICATION_EMAIL_PROVIDER`, `BYMAX_NOTIFICATION_OTP_STORAGE`, `BYMAX_NOTIFICATION_TEMPLATE_RENDERER` and `BYMAX_NOTIFICATION_LOG_REPOSITORY`. `BYMAX_NOTIFICATION_PUSH_PROVIDER` carries the push provider when `push` is configured. `BYMAX_NOTIFICATION_SMS_PROVIDER` exists for the reserved SMS channel and carries nothing.

### Testing your own storage (`./testing`)

`otpStorageContract(factory, options?)` returns the executable cases your own `IOtpStorage` has to pass: atomic attempt counting, atomic cooldown, atomic compare-and-delete (`deleteIfCode`, when implemented), TTL that survives an update, and keys scoped by tenant, recipient and purpose. Each case is `{ name, run }`, so it runs in any test runner; `expiryWaitMs` raises the wait of the TTL cases for a backend with coarse expiry.

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

### Types

Every type, option shape and constant the entry points export, by name, with its defaults and the failure it raises. Each name is also exported under the subpath its heading shows.

#### Service inputs and results

Every service refuses a bad value before it calls a provider or a store. The options these inputs take are described in [Send and issue options](#send-and-issue-options); limits such as `maxRecipients` and `maxAttachmentBytes` are the channel options in Configuration.

| Name                     | What it is                                                                  | Fields, defaults, limits and failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EmailSendInput`         | The argument of `EmailService.send()`: a message whose body you made.       | Required: `tenantId`, `to`, `subject`, `html`. Optional: `text`, `from`, `fromName`, `replyTo`, `cc`, `bcc`, `tags`, `attachments`, `userId`, `auditRedactValues`, `publishProviderText`. A blank `tenantId` or one with a control character raises `notification.invalid_scope_identifier` (400). `to`, `cc` and `bcc` together may name at most `maxRecipients` addresses (a `,` or `;` splits a string), else `notification.email_invalid_recipient` (400). Attachments over `maxAttachmentBytes` in total raise `notification.email_attachments_too_large` (413); a string attachment is measured as the UTF-8 bytes of the string. An `html` or `text` that is not a string raises `notification.email_missing_body` (400). `to`, `cc` and `bcc` must be a string or a list of at most 1000 strings, else `notification.email_invalid_recipient` (400); `attachments`, `tags` and `auditRedactValues` must be lists of at most 1000 entries of the right kind (an attachment carries `filename`, `content` (a string, a `Buffer` or a `Uint8Array`), `contentType`, `cid` and `contentDisposition`, and any other field is refused), and `publishProviderText` must be `true` or `false`, else `notification.invalid_scope_identifier` (400). Each list is read once, into a copy. A provider failure raises `notification.email_send_failed` (502, or 503 when the provider could not be reached or asked to retry later). |
| `EmailSendTemplateInput` | The argument of `EmailService.sendTemplate()`: the renderer makes the body. | Required: `tenantId`, `to`, `template`, `data`. Optional: `locale` (default `global.defaultLocale`), `from`, `fromName`, `replyTo`, `tags`, `userId`, `auditRedactValues`, `publishProviderText`. There is no `cc`, `bcc` or `attachments`, and no `subject`, `html` or `text`. The recipient count is checked before the template is rendered. The renderer is asked for the locale, then for `en`; when neither has the template the call raises `notification.template_not_found` (500), and a renderer that throws raises `notification.template_render_failed` (500). A tag `{ name: 'template', value: <template> }` is added after your own tags. Everything `EmailSendInput` refuses is refused here too.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EmailAttachment`        | One attachment of a message.                                                | `filename: string`, `content: Buffer \| string`, optional `contentType: string`, optional `cid: string` (1 to 128 printable ASCII characters, no space, quote or angle bracket) and optional `contentDisposition: 'attachment' \| 'inline'`. An inline image is a `cid` that the HTML refers to as `cid:<value>`, with `'inline'`; SMTP sends both; Resend sends the `cid` as its content id and has no disposition, so it refuses a `contentDisposition` that disagrees with the `cid`. Any other field, hidden or symbol-keyed ones included, is refused (on a tag too). A string `content` is a base64 string by contract of the provider. The sum of all attachments of a message is checked against `maxAttachmentBytes`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `RenderedEmail`          | What an `IEmailTemplateRenderer` returns for one template.                  | `subject: string`, `html: string`, optional `text: string`. A renderer that cannot find the template throws; `EmailService` maps a throw from `render()` to `notification.template_render_failed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `OtpGenerateInput`       | The argument of `OtpService.generate()` and `resend()` (the same call).     | Required: `tenantId`, `recipient`, `purpose`. Optional: `userId`, `deliverVia` (`'email'` or `'manual'`; default `'email'` when an email channel exists, otherwise `'manual'`; any other value raises `notification.invalid_scope_identifier` (400), and is never read as `'manual'`), `emailTemplate` (default `'otp_code'`), `emailData`, `locale` (default `global.defaultLocale`). A blank or control-character `tenantId` or `recipient`, or a `purpose` that is empty, over 64 characters or outside `A-Z a-z 0-9 : _ -`, raises `notification.invalid_scope_identifier` (400); so does an unregistered purpose when `otp.strictPurposes` is `true`. The `recipient` is normalized before it keys the state (see [Which spellings share a key](#which-spellings-share-a-key)). By email the recipient must be exactly one mailbox of at most 254 characters, else `notification.email_invalid_recipient` (400). `'manual'` while `otp.codeSecret` is set raises `notification.otp_manual_delivery_unavailable` (400). `'email'` without an email channel raises `notification.otp_email_delivery_not_configured` (500). Inside the resend cooldown the call raises `notification.otp_cooldown_active` (429). When the store or the delivery fails, the cooldown and the entry are released and the error is rethrown.                                                                                                      |
| `OtpVerifyInput`         | The argument of `OtpService.verify()`.                                      | `tenantId`, `recipient`, `purpose` and `userId?` as in `OtpGenerateInput`, plus `code: string`. A wrong, missing or exhausted code is returned as `{ valid: false, reason }` and never thrown. The scope checks above raise `notification.invalid_scope_identifier` (400); an absent OTP channel raises `notification.otp_storage_not_configured` (500).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `OtpConsumeInput`        | The argument of `OtpService.consume()`.                                     | The same reference as `OtpVerifyInput` without `code`: `tenantId`, `recipient`, `purpose`, `userId?`. It deletes the entry, the cooldown and the failure counter, and is idempotent. Same failures as `verify()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `OtpStatusInput`         | The argument of `OtpService.getStatus()`.                                   | `tenantId`, `recipient`, `purpose`, all required; there is no `userId`. The scope checks raise `notification.invalid_scope_identifier` (400). The status never carries the code.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `OtpStatusResult`        | What `OtpService.getStatus()` returns.                                      | `exists: boolean` and `cooldownSeconds: number` (the remaining resend window, `0` when none) are always present. `expiresAt`, `attempts` and `maxAttempts` are present when `exists` is `true`, and `validated` when the entry carries it. The code is never part of it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `OtpVerifyResult`        | What `OtpService.verify()` returns.                                         | `{ valid: true }`, or `{ valid: false, reason }` where `reason` is `'not_found'` (no live code, or it expired), `'max_attempts'` (the attempt ceiling was reached) or `'invalid_code'`, which also carries `remainingAttempts: number`. A failed verification is a result and is never thrown.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `OtpGenerateResult`      | What a successful `generate()` or `resend()` returns.                       | `expiresAt: number` (Unix time in milliseconds) and `cooldownSeconds: number` (the resend window of the purpose). The code itself is never returned: it reaches the recipient by email, or you read it from your store with `deliverVia: 'manual'` when `otp.codeSecret` is not set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ConsumeAttemptResult`   | What `IOtpStorage.consumeAttempt` returns, in one atomic step.              | `{ status: 'not_found' }` (no entry, or it expired), `{ status: 'max_attempts' }` (the ceiling was already reached; the entry is deleted), or `{ status: 'ok'; entry: OtpEntry }` (an attempt was consumed; `entry` carries the updated entry and the stored code). `OtpService.verify()` turns the first two into `{ valid: false, reason }` results.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

#### Dispatch

`NotificationService.dispatch()` routes one request to a channel. A channel that is absent, or whose provider or storage reports `isConfigured()` as `false`, raises `notification.channel_disabled` (501).

| Name                   | What it is                                                                    | Fields, defaults, limits and failures                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DispatchInput`        | The argument of `dispatch()`, one variant per channel.                        | `{ channel: 'email', tenantId, payload: EmailDispatchPayload }` or `{ channel: 'otp', tenantId, payload: OtpDispatchPayload }`. It is a union on `channel`, so the payload type follows the channel.                                                                                                                                                                                                                                                 |
| `EmailDispatchPayload` | The email payload of a dispatch.                                              | Required: `to`. Either `template` (with `data`, default `{}`, and optional `locale`) or both `subject` and `html` (with optional `text`). When `template` is set it wins. With neither a template nor both `subject` and `html` the call raises `notification.email_missing_body` (400). Optional on both paths: `from`, `fromName`, `replyTo`, `tags`, `userId`. It has no `cc`, `bcc` or `attachments`.                                            |
| `OtpDispatchPayload`   | The OTP payload of a dispatch.                                                | Required: `recipient`, `purpose`. `action` is `'generate'` (the default), `'verify'` or `'consume'`; any other value raises `notification.invalid_scope_identifier` (400) and sends no code. `code` is read for `'verify'` and an absent one is checked as an empty string. `deliverVia`, `emailTemplate`, `emailData` and `locale` are read for `'generate'` only. `userId` is optional. Each action fails as `OtpService` does for the same input. |
| `DispatchResult`       | What `dispatch()` returns, one variant per channel.                           | `{ channel: 'email'; messageId: string }` or `{ channel: 'otp'; result }`, where `result` is the `OtpGenerateResult` of `'generate'`, the `OtpVerifyResult` of `'verify'`, or `undefined` for `'consume'`.                                                                                                                                                                                                                                           |
| `NotificationChannel`  | The channels a log entry or `getEnabledChannels()` names; also in `./shared`. | `'email'`, `'otp'`, `'sms'` or `'push'`. `'email'`, `'otp'` and `'push'` are implemented; `getEnabledChannels()` never returns `'sms'`.                                                                                                                                                                                                                                                                                                              |

#### Audit

| Name                   | What it is                                                              | Members, defaults and failures                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NotificationLogVerb`  | The `verb` of an audit entry, the event that is recorded.               | One of `'sent'`, `'generated'`, `'verified'`, `'failed'`, `'cooldown_blocked'`, `'max_attempts_exceeded'`. Email writes `sent` and `failed`; OTP writes `generated`, `verified`, `failed`, `cooldown_blocked` and `max_attempts_exceeded`. See Audit Log for the entry it belongs to.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `NotificationLogEntry` | What `INotificationLogRepository.create` receives for each audit entry. | Required: `timestamp: number` (Unix time in milliseconds), `tenantId`, `channel: NotificationChannel`, `verb: NotificationLogVerb`, `recipient` (already passed through `audit.maskRecipient`; several email recipients are joined with `', '`), `providerName`. Optional: `purpose`, `messageId`, `errorMessage` (the message only, never a stack trace or a code), `userId`, `deliveryStatus: number` and `deliveryEnhancedStatus: string` (the SMTP reply code and its RFC 3463 form, on a failed send whose provider text was withheld), `metadata: Record<string, unknown>` (context such as the `reason` of a refused verification). Strings are escaped before `create` sees them (see Audit Log). |

#### Canonical names and purposes

| Name                           | What it is                                                      | Members and failures                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OtpPurpose`                   | The type of a purpose, from `./shared` and the server entry.    | The five canonical strings `'email_verification'`, `'password_reset'`, `'mfa_oob'`, `'phone_verification'`, `'magic_link'`, plus any other string, so your own purposes type-check and the editor still offers the five. The type does not validate: a purpose outside `A-Z a-z 0-9 : _ -` or over 64 characters raises `notification.invalid_scope_identifier` (400) at the service. See [Purposes are yours](#purposes-are-yours). |
| `CanonicalNotificationPurpose` | The literal union of the values of `NOTIFICATION_PURPOSES`.     | The same five strings as above, without the open escape hatch. It is a type only and carries no runtime check.                                                                                                                                                                                                                                                                                                                       |
| `CanonicalEmailTemplate`       | The literal union of the values of `CANONICAL_EMAIL_TEMPLATES`. | `'otp_code'`, `'otp_password_reset'`, `'otp_resent'`, `'welcome'`, `'password_reset_success'`, `'trial_expiring'`, `'trial_expired'`, `'new_login_alert'`, `'mfa_enabled'`, `'mfa_disabled'`. The library ships no HTML for them: you register each in your renderer. `sendTemplate()` accepts any string, so the type is for autocompletion.                                                                                        |

#### Error types

The catalog itself is described in Errors.

| Name                          | What it is                                                                        | Members and defaults                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NotificationErrorKey`        | The symbolic key of an entry of `NOTIFICATION_ERROR_DEFINITIONS`.                 | A string-literal union such as `'OTP_INVALID_LENGTH'` or `'EMAIL_SEND_FAILED'`. It is the first argument of `new NotificationException(key, details?, options?)`. A key that is not in the catalog, passed from untyped code, yields the code `notification.unknown_error` with status 500 instead of a `TypeError`. |
| `NotificationErrorDefinition` | One catalog entry.                                                                | `code: string` (the `notification.*` value), `status: HttpStatus`, `message: string` (the English default).                                                                                                                                                                                                          |
| `NotificationErrorResponse`   | The JSON body a `NotificationException` serializes to; also in `./shared`.        | `{ error: { code: string; message: string; details: Record<string, unknown> \| null } }`. `details` is `null` when the exception carries none. A frontend types the parsed body with it and matches on `error.code`.                                                                                                 |
| `NotificationErrorCode`       | The union of the string values of `NOTIFICATION_ERROR_CODES`; also in `./shared`. | A literal union such as `'notification.otp_cooldown_active'`. It is a type only: a body parsed from the network is a `string` until you narrow it.                                                                                                                                                                   |

#### Observer contract

The observer is how the services report what they do without importing a metrics or tracing package. Register one under the `BYMAX_NOTIFICATION_OBSERVER` token (a `Symbol`); with none registered the services record nothing and cost nothing. The `./observability` subpath provides one, and Observability lists the metrics, spans and log events built on it. Every value below belongs to a closed set; none is an identifier, a recipient or error text.

| Name                          | What it is                                              | Members and rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INotificationObserver`       | What the services call.                                 | Three members, all optional: `onSend(event: NotificationSendEvent): void`, `onOtp(event: NotificationOtpEvent): void` and `span<T>(name, attributes, run): Promise<T>`. `onSend` and `onOtp` that throw are ignored: observing never fails a send or a verification. A `span` that throws, or that never calls `run`, does not change the outcome either: the operation runs exactly once and its own value or error is what the caller gets. `span` should call `run` once and settle as it does. |
| `NotificationObservedChannel` | The channel an event belongs to.                        | `'email'` or `'otp'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `NotificationSendEvent`       | What `onSend` receives, once, when a send ends.         | `readonly channel: NotificationObservedChannel`, `readonly outcome: NotificationSendOutcome`, `readonly seconds: number` (the duration of the whole call). A template send is reported once, by the call you made.                                                                                                                                                                                                                                                                                 |
| `NotificationSendOutcome`     | How a send ended.                                       | `'sent'` when the provider accepted the message, even if the audit write that followed failed. `'failed'` when the provider did not accept it, or when something that is not the library's own error failed before it. `'rejected'` when the library refused the message before the provider was called.                                                                                                                                                                                           |
| `NotificationOtpEvent`        | What `onOtp` receives when something happens to a code. | `readonly event: NotificationOtpEventName`. A call the library refuses outright (an invalid argument, a cooldown) is not reported.                                                                                                                                                                                                                                                                                                                                                                 |
| `NotificationOtpEventName`    | What happened to a code.                                | `'issued'` (a code was generated), `'verified'` (a code was accepted), `'failed'` (a wrong code, or none live), `'locked'` (the recipient ran into the attempt ceiling).                                                                                                                                                                                                                                                                                                                           |
| `NotificationSpanName`        | The operations that run inside a span.                  | `'notification.send'` (a raw or template email send) and `'notification.otp.verify'`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `NotificationSpanAttributes`  | The attributes a span starts with.                      | `readonly channel: NotificationObservedChannel`, and nothing else.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `BYMAX_NOTIFICATION_OBSERVER` | The injection token of the observer.                    | A `Symbol`. Injected as optional by `EmailService` and `OtpService`, so leaving it unprovided is valid. Provide an object implementing `INotificationObserver` under it, or import the `./observability` module, which does.                                                                                                                                                                                                                                                                       |

#### Module options

Defaults and ranges of the most-used options are in the Configuration section; this table adds the types that carry them. Every refusal below is an `Error` thrown when the module is built, with a message that starts `[BymaxNotificationModule]` and names the option, except where a code is given.

| Name                                    | What it is                                                                                                      | Fields, defaults, failure modes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BymaxNotificationModuleAsyncOptions`   | The argument of `forRootAsync()`.                                                                               | `useFactory` (required): `(...args) => options \| Promise<options>`. `inject`: providers passed to it, in order. `imports`: modules that supply them. A `useClass` or `useExisting` property is refused at registration, and so is a missing or non-function `useFactory`.                                                                                                                                                                                                                                                                                                                                                  |
| `BymaxNotificationModuleOptionsFactory` | An interface with one method, `createNotificationOptions()`, returning the module options or a promise of them. | Declared only. `forRootAsync()` takes `useFactory` and does not call this method.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `GlobalOptions`                         | Library-wide settings (`global`).                                                                               | `redisNamespace` (deprecated, removed in v2.0; default `'notification'`; resolved but not read by the bundled storages, whose prefix is `RedisOtpStorageOptions.namespace`; setting it logs one startup warning), `defaultLocale` (default `'en'`), `tenantIdResolver` `(req: NotificationRequest) => string \| Promise<string>`. `global` must be an object (`null` reads as not set); a `tenantIdResolver` that is not a function is refused. A resolved value that is not a string, is empty or is whitespace-only is refused by the audit interceptor.                                                                  |
| `EmailChannelOptions`                   | The email channel (`email`).                                                                                    | `provider` and `defaultFrom` are required; `provider` is an instance or a class. `defaultFrom` must be a non-empty string containing `@`. Optional: `defaultFromName`, `templateRenderer` (default `DefaultTemplateRenderer`), `defaultReplyTo`, `defaultTags` (default `[]`), `maxAttachmentBytes` (default `10485760`, a finite number of at least `0`; a larger sum fails a send with `EMAIL_ATTACHMENTS_TOO_LARGE`), `maxRecipients` (default `50`, an integer from `1` to `9007199254740991`; a larger message fails a send with `EMAIL_INVALID_RECIPIENT`).                                                           |
| `OtpChannelOptions`                     | The OTP channel (`otp`).                                                                                        | `storage` is required (an instance or a class). `defaultLength` `6` (integer `1` to `32`, else `OTP_INVALID_LENGTH`), `defaultCodeType` `'numeric'`, `defaultTtlSeconds` `600` (finite, above `0`), `defaultMaxAttempts` `5` (integer of at least `1`), `resendCooldownSeconds` `60` (finite, at least `0`; `0` switches the cooldown off), `consumeOnVerify` `false`, `strictPurposes` `false` (a non-boolean is refused), `codeSecret` (a string of at least 32 UTF-8 bytes, else refused without echoing it), `perPurpose` (see `OtpPurposeConfig`). A `codeType` outside `numeric`, `alpha`, `alphanumeric` is refused. |
| `OtpPurposeConfig`                      | The settings of one purpose: `length`, `codeType`, `ttlSeconds`, `maxAttempts`, `resendCooldownSeconds`.        | All five are required in this type, which is also what `resolveForPurpose()` returns. In `perPurpose` each entry is a partial of it: a field left out, or `undefined`, takes the channel default. Same ranges as the defaults above. A purpose key must be a valid purpose, the container must be a plain object or an instance of your own class, and an entry that is `null` or `undefined` is refused.                                                                                                                                                                                                                   |
| `SmsChannelOptions`                     | Shape of an SMS channel: `provider` (`ISmsProvider` or a class), `defaultFrom?`, `resendCooldownSeconds?`.      | Not wired. No service implements it, and passing `sms` throws at startup: `sms` counts as a channel for the at-least-one check and is then refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `PushChannelOptions`                    | Shape of a push channel: `provider` (`IPushProvider` or a class), `defaultTtlSeconds?`.                         | `provider` is required. `defaultTtlSeconds` (a non-negative integer) applies to a send that sets no `ttlSeconds`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `AuditOptions`                          | The audit log (`audit`).                                                                                        | `repository` is required whenever `audit` is set (an instance or a class). `swallowErrors` default `true`; `maskRecipient` default identity, applied to each recipient and joined with `', '`. `null` for `audit`, `swallowErrors` or `maskRecipient` is refused. Without `audit` the no-op repository is used and the same two defaults apply.                                                                                                                                                                                                                                                                             |

#### Resolved options

The frozen object injected under `BYMAX_NOTIFICATION_OPTIONS`. It holds scalars and functions only; providers, storage, renderer and repository are registered under their own tokens.

| Name                          | What it is                              | Members                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResolvedNotificationOptions` | The whole resolved object, deep-frozen. | `global` and `audit` are always present; `email` and `otp` only when that channel is configured, so `if (options.email)` narrows.                                                                                                                                                                                                                                                                                                                                                      |
| `ResolvedGlobalOptions`       | Resolved `global`.                      | `redisNamespace`, `defaultLocale` (both with their defaults applied), `tenantIdResolver?`.                                                                                                                                                                                                                                                                                                                                                                                             |
| `ResolvedEmailOptions`        | Resolved `email`.                       | `defaultFrom`, `defaultFromName?`, `defaultReplyTo?`, `defaultTags`, `maxAttachmentBytes`, `maxRecipients`.                                                                                                                                                                                                                                                                                                                                                                            |
| `ResolvedOtpOptions`          | Resolved `otp`.                         | `defaultLength`, `defaultCodeType`, `defaultTtlSeconds`, `defaultMaxAttempts`, `resendCooldownSeconds`, `consumeOnVerify`, `strictPurposes`; `perPurpose` (each entry merged over the defaults); `resolveForPurpose(purpose)` returns the entry or the defaults; `isRegisteredPurpose(purpose)` is true for a purpose in `NOTIFICATION_PURPOSES` or a `perPurpose` key; `digestCode?` exists only when `codeSecret` is set. It is a function, and the secret itself is not a property. |
| `ResolvedAuditOptions`        | Resolved `audit`.                       | `swallowErrors`, `maskRecipient`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

#### Providers and storage

| Name                         | What it is                                                                                                                  | Fields, defaults, failure modes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ResendEmailProviderOptions` | Constructor options of `ResendEmailProvider`.                                                                               | `apiKey?`: without it `isConfigured()` is `false` and `send()` throws. `timeoutMs?`: integer from `1` to `2147483647`, default `15000`; anything else is refused when the provider is built, naming `timeoutMs`. A send past it fails with `EMAIL_SEND_FAILED` and may still have been accepted.                                                                                                                                                                                                                                                                                                                                        |
| `SmtpEmailProviderOptions`   | Constructor options of `SmtpEmailProvider`; the table of defaults is in [`docs/smtp-provider.md`](./docs/smtp-provider.md). | `host?` (without it `isConfigured()` is `false`), `port?` (default `587`, integer `1` to `65535`), `secure?` (default `true` only on port `465`), `requireTls?` (default `true` when `secure` is `false` and the host is not `localhost`, `127.0.0.1`, `::1` or `[::1]`, otherwise `false`), `credentials?`, `tls?`, `connectionTimeout?` (`10000`), `greetingTimeout?` (`10000`), `socketTimeout?` (`20000`), `sendTimeoutMs?` (`60000`), `pool?`. Each timeout is an integer from `1` to `2147483647`, and the constructor refuses anything else, naming the option. A `null` for `secure`, `requireTls` or `credentials` is refused. |
| `SmtpCredentials`            | The login pair of `credentials`: `user?`, `pass?`.                                                                          | Both are typed `string \| undefined`. `isConfigured()` is `true` only when both are non-empty; a `credentials` object with either one empty makes `isConfigured()` `false` and a send throw `incomplete credentials`, so it never falls back to an anonymous send. Omit `credentials` for an open relay.                                                                                                                                                                                                                                                                                                                                |
| `SmtpPoolOptions`            | The limits of `pool`: `maxConnections?`, `maxMessages?`.                                                                    | Each an integer from `1` to `9007199254740991`; a left-out limit keeps Nodemailer's default. Setting `pool`, even to `{}`, turns pooled mode on. A `pool` that is not an object is refused with `pool must be an object`.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `SmtpTlsOptions`             | The `tls` object: the eleven keys below are the only ones forwarded to the transport.                                       | The checks run when the provider is built. A key outside this set, or a symbol key, is refused naming the key (`tls.<key> is not a supported option`). A set key of the wrong type is refused as `tls.<key> must be <type>`, naming the key and never the value. A key that reads as `undefined` or `null` is not set. A `tls` that is not an object is left to the transport.                                                                                                                                                                                                                                                          |
| `SmtpTlsKeyEntry`            | An element of a `tls.key` array: `{ pem, passphrase? }`.                                                                    | `pem` is a string or a `Buffer`; `passphrase`, when set, a string. Valid only inside an array: a bare object as `key` is refused.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SmtpTlsPfxEntry`            | An element of a `tls.pfx` array: `{ buf, passphrase? }`.                                                                    | `buf` is a string or a `Buffer`; `passphrase`, when set, a string. Valid only inside an array.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `InMemoryStorageSize`        | What `InMemoryOtpStorage.size()` returns.                                                                                   | `otps`, `cooldowns`, `failures`: the counts of stored OTP entries, cooldown entries and failure counters.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `RedisOtpStorageOptions`     | Constructor options of `RedisOtpStorage`.                                                                                   | `redisClient` (a `RedisLike`) and `namespace?` (default `'notification'`). The constructor does not check either value.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `RedisLike`                  | The slim client surface `RedisOtpStorage` calls; an `ioredis` client satisfies it.                                          | `get`, `set` (the forms `SET key value EX seconds NX` and `SET key value KEEPTTL XX`), `setex`, `del`, `ttl`, `pttl` and `eval(script, numKeys, ...args)`. The storage never connects, configures or closes the client.                                                                                                                                                                                                                                                                                                                                                                                                                 |

The accepted type of each `SmtpTlsOptions` key, as the provider checks it:

| Key                                   | Accepted                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `rejectUnauthorized`                  | a boolean; `false` turns certificate verification off                                 |
| `servername`, `ciphers`, `passphrase` | a string                                                                              |
| `minVersion`, `maxVersion`            | one of `'TLSv1'`, `'TLSv1.1'`, `'TLSv1.2'`, `'TLSv1.3'`                               |
| `ca`, `cert`                          | a string, a `Buffer` (or other binary view), or an array of them                      |
| `key`                                 | a string, a `Buffer`, or an array of strings, `Buffer`s and `SmtpTlsKeyEntry` objects |
| `pfx`                                 | a string, a `Buffer`, or an array of strings, `Buffer`s and `SmtpTlsPfxEntry` objects |
| `checkServerIdentity`                 | a function `(hostname, cert) => Error \| undefined`                                   |

#### Templates

The renderer options and defaults are in the Templates section; these are the types behind them.

| Name                             | What it is                                        | Members and failure modes                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DefaultTemplateRendererOptions` | Constructor options of `DefaultTemplateRenderer`. | `templates?` (default none), `fallbackLocales?` (default `['en']`), `onMissingVar?` (default `'empty'`), `enableNestedPaths?` (default `false`). A template that is not an object with a string `subject` and `html`, or whose `text` is set and not a string, makes the constructor throw `Invalid template "<key>"`. |
| `TemplateDefinition`             | One template: `{ subject, html, text? }`.         | Registered under the key `name::locale`. Placeholders are `{{var}}`; values are HTML-escaped in `html` only. A render with no match along the locale chain throws `Template not found`.                                                                                                                                |
| `MissingVariableMode`            | `'empty' \| 'throw'`.                             | `'empty'` renders a missing or `null` variable as an empty string; `'throw'` raises `Missing template variable: <path>`.                                                                                                                                                                                               |

#### Push

`PushService` sends one message to many device tokens and answers **per token**. The library stores no token: your backend does, and it acts on the closed `PushFailureReason` of each result (`token_unregistered` means delete the token). `ExpoPushProvider` is the shipped adapter, imported from the `@bymax-one/nest-notification/push` subpath so that it stays out of the main bundle of a host that sends no push: no SDK, no peer dependency, two JSON endpoints called with the platform's `fetch`, every request bounded by `timeoutMs` and sent only to Expo's fixed URLs.

Import `@bymax-one/nest-notification/push` at startup, next to the main entry, and not lazily: the subpath carries its own copy of the realm-root check and takes its baseline when it is first imported, so a lazy import would take it at that later moment.

```ts
import { BymaxNotificationModule, NotificationService } from '@bymax-one/nest-notification'
import { ExpoPushProvider } from '@bymax-one/nest-notification/push'

const accessToken = process.env.EXPO_ACCESS_TOKEN // only when the project enabled "enhanced security"
BymaxNotificationModule.forRoot({
  push: { provider: new ExpoPushProvider(accessToken ? { accessToken } : {}) }
})

async function notifyOrderShipped(
  notification: NotificationService,
  tenantId: string,
  token: string
) {
  const { results } = await notification.getPush().send({
    tenantId,
    tokens: [token],
    title: 'Order shipped',
    body: 'Your order is on its way'
  })
  // results[i] is the answer for tokens[i]: { token, messageId } or { token, reason, retryable }
  return results
}
```

- **One bad token does not fail its batch.** A refused token is a result with a `reason`; A token that is empty, too long or holds a control character is answered `token_invalid` on its own and never reaches the provider. `send` throws `PUSH_SEND_FAILED` only when nothing was sent, so retrying a thrown `PUSH_SEND_FAILED` cannot deliver twice. With `audit.swallowErrors: false`, an `AUDIT_LOG_FAILED` can follow a send that was delivered: do not retry that one. A partial outage keeps the tickets of the chunks that were accepted.
- **Retry rules.** `retryable` is `true` only when Expo refused the call before processing it: a rate limit, or a 5xx whose body carries an errors list with a string `code`, or a connection that was never made. A timeout, a reset, or a bare gateway 502, 503 or 504 is `retryable: false` with `reason: 'provider_unavailable'`, because Expo does not deduplicate and the message may have been delivered.
- **When `send` throws.** It throws `PUSH_SEND_FAILED` only when no token was sent and none may have been: a retry cannot duplicate. `error.details.retryable` (and the status, 503 against 502) says whether a retry is expected to succeed. An outcome that may have been acted on is a result with `retryable: false`, never a throw.
- **Receipts.** Expo accepts a message first and reports delivery later. `fetchReceipts(ticketIds)` takes the `messageId` values of earlier results and returns one `{ ticketId, status, reason?, retryable? }` each; an id Expo has no receipt for yet is `pending`. Check about 15 minutes after the send; Expo drops receipts after 24 hours. Your backend keeps the ticket-id-to-token mapping. A provider without receipts makes `fetchReceipts` throw `CHANNEL_DISABLED`.
- **Bounds.** A call takes 1 to 1000 tokens (or ticket ids). A token that is not shaped like an Expo token is answered `token_invalid` locally, with no call. A token given twice is sent once and answered in each place it appeared.
- **Nothing sensitive leaves.** No device token, access token, title, body or data value appears in a log, an audit entry or an error: the audit entry names the tenant, the provider and counts (`recipient: 'devices:N'`), and a provider's own error text is dropped, not wrapped. Treat the title, body and `data` as visible to Expo and to the push services behind it, and keep secrets out of them.

| Name                      | What it is                                       | Members                                                                                                                                                       |
| ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PushService`             | The push channel's service.                      | `send(input)`, `fetchReceipts(ticketIds)`, `isConfigured()`.                                                                                                  |
| `PushSendInput`           | The argument of `PushService.send()`.            | `PushSendOptions` plus `tenantId` and `userId?`.                                                                                                              |
| `ResolvedPushOptions`     | The push section after validation.               | `provider`, `defaultTtlSeconds?`.                                                                                                                             |
| `ExpoPushProvider`        | Reference adapter for Expo Push (`./push` only). | `new ExpoPushProvider(options?)`; `name` is `'expo'`.                                                                                                         |
| `ExpoPushProviderOptions` | Options of `ExpoPushProvider` (`./push`).        | `accessToken?` (Expo enhanced security), `timeoutMs?` (default 10 000), `fetch?`.                                                                             |
| `PushFailureReason`       | Why a token was not served (closed set).         | `'token_unregistered' \| 'token_invalid' \| 'message_too_big' \| 'rate_limited' \| 'provider_unavailable' \| 'credentials' \| 'unknown'`; also in `./shared`. |
| `PushTokenResult`         | The outcome of one token in a send.              | `token`, `messageId?`, `reason?`, `retryable?`; also in `./shared`.                                                                                           |
| `PushReceiptStatus`       | The state of a receipt.                          | `'ok' \| 'pending' \| 'error'`; also in `./shared`.                                                                                                           |
| `PushReceiptResult`       | One receipt.                                     | `ticketId`, `status`, `reason?`, `retryable?`; also in `./shared`.                                                                                            |

#### SMS and push contracts

`ISmsProvider`, `SmsSendOptions` and `SmsSendResult` are types only: no service uses them and a module configured with `sms` throws at startup. `IPushProvider`, `PushSendOptions` and `PushSendResult` are the contract `PushService` drives; a host can register its own provider.

| Name              | What it is                  | Members                                                                                                                                                                                                                                                                 |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ISmsProvider`    | Contract for an SMS sender. | `readonly name: string`, `isConfigured(): boolean`, `send(options: SmsSendOptions): Promise<SmsSendResult>`, which throws on failure.                                                                                                                                   |
| `SmsSendOptions`  | One SMS.                    | `to` (E.164), `body`, `from?` (E.164 or an alphanumeric sender id), `tags?` (`{ name, value }[]`).                                                                                                                                                                      |
| `SmsSendResult`   | The result of an SMS send.  | `messageId: string`.                                                                                                                                                                                                                                                    |
| `IPushProvider`   | Contract for a push sender. | `readonly name: string`, `isConfigured(): boolean`, `send(options: PushSendOptions): Promise<PushSendResult>`, which throws only when nothing was sent, and the optional `fetchReceipts(ticketIds)`.                                                                    |
| `PushSendOptions` | One push notification.      | `tokens` (a string or a string array), `title`, `body`; `data?` (`Record<string, string>`), `imageUrl?`, `sound?`, `badge?`, `ttlSeconds?`, `priority?`, `channelId?`, `subtitle?`, `categoryId?`, `collapseKey?`, `threadId?`, `mutableContent?`, `contentAvailable?`. |
| `PushSendResult`  | The result of a push send.  | `results`: one `PushTokenResult` per token, in order. The `error?` field is deprecated and never set by the shipped adapters.                                                                                                                                           |

#### React types (`./react`)

Type-only exports: they carry no runtime code. The hooks that use them are described in [React hooks](#react-hooks-react).

| Name                     | What it is                                                 | Members, defaults and failure modes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OtpInputType`           | The character class a `useOtpInput` slot accepts.          | `'numeric'` (`0-9`), `'alpha'` (`A-Z`, `a-z`) or `'alphanumeric'` (both). Letters are upper-cased; a character outside the class is dropped, so a typed character that does not match leaves the slot unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `UseOtpInputOptions`     | The options bag of `useOtpInput`. Every field is optional. | `length?: number`, default `6`. `type?: OtpInputType`, default `'numeric'`. `onComplete?: (code: string) => void \| Promise<void>`, called in a microtask once every slot is filled; the latest callback passed is the one called. `autoSubmit?: boolean`, default `true`; `false` stops the hook from calling `onComplete`. `sanitizeOnPaste?: boolean`, default `true`; strips whitespace and hyphens from pasted text before it is distributed. When `length` changes after mount, the slots are trimmed or padded with empty ones. No field is validated or range-checked.                                                                                                                                                                                                              |
| `UseOtpInputState`       | What `useOtpInput` returns.                                | `values: string[]` (one character per slot, `''` when empty); `setValue(index, value)` (sets one slot to the raw value, without character filtering, and runs the same completion path as typing); `onChange(index)`, `onKeyDown(index)` (curried handlers; Backspace on an empty slot clears the previous one and moves focus to it, ArrowLeft and ArrowRight move focus without wrapping); `onPaste(event)` (calls `preventDefault`, fills the slots from the clipboard text, and is meant for the first input only); `refs` (one stable ref object per slot); `reset()` (empties every slot and focuses the first); `code: string` (the slots joined); `isComplete: boolean` (every slot filled). A multi-character `onChange` value is ignored, since the paste handler owns that path. |
| `UseOtpCountdownOptions` | The options bag of `useOtpCountdown`.                      | `expiresAt: number \| null`, required: Unix epoch milliseconds, or `null` for no countdown. `tickIntervalMs?: number`, default `1000`, handed to `setInterval` unchecked. `onExpired?: () => void`, called once when the countdown reaches zero, including at once when `expiresAt` is already in the past. It is not called for `null`. Changing `expiresAt` or `tickIntervalMs` restarts the countdown.                                                                                                                                                                                                                                                                                                                                                                                   |
| `UseOtpCountdownState`   | What `useOtpCountdown` returns.                            | `remainingSeconds: number` (whole seconds, rounded down, never negative); `expired: boolean` (`remainingSeconds` is `0`, so it is also `true` when `expiresAt` is `null`); `formatted: string` (`MM:SS` under one hour, `HH:MM:SS` from one hour, `00:00` at zero).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

#### Storage contract types (`./testing`)

`otpStorageContract` itself is described in [Testing your own storage](#testing-your-own-storage-testing).

| Name                        | What it is                                              | Shape, default and failure mode                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `OtpStorageContractCase`    | One executable obligation of an `IOtpStorage`.          | `{ name: string, run: () => Promise<void> }`. `name` suits a test title. `run` resolves when the storage honours the obligation and rejects with an `Error` whose message starts `IOtpStorage contract violated:` when it does not.              |
| `OtpStorageContractOptions` | Timing options of `otpStorageContract`.                 | `expiryWaitMs?: number`: milliseconds the TTL cases wait for an entry to lapse. Default `1500`. It has to exceed the storage's own expiry granularity; no range is enforced.                                                                     |
| `OtpStorageFactory`         | The function that hands the contract a storage to test. | `() => IOtpStorage \| Promise<IOtpStorage>`. It is called once per case, so each case gets its own storage. A factory that throws or rejects makes that case reject. Each case removes the keys it wrote when it ends, whether or not it failed. |

#### Shared types (`./shared`)

Zero-dependency types a browser can import: nothing behind `./shared` reaches NestJS or a Node builtin. See [Constants](#constants) for the runtime values `NOTIFICATION_ERROR_CODES` and `DEFAULT_TTLS`.

| Name                        | What it is                                              | Shape and use                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OtpPurpose`                | The purpose of an OTP flow.                             | A string union: `'email_verification'`, `'password_reset'`, `'mfa_oob'`, `'phone_verification'`, `'magic_link'`, plus `(string & {})`, which keeps it open to custom purposes while the five literals still autocomplete. It is a compile-time hint only; the type does not validate a value, and the server's rules for a purpose are in [Errors](#-errors) under `notification.invalid_scope_identifier`. |
| `NotificationErrorResponse` | The JSON body a `NotificationException` serializes to.  | `{ error: { code: string, message: string, details: Record<string, unknown> \| null } }`. Match on `error.code`; `message` is the English default; `details` is `null` when there is no structured context. `code` is typed `string`, so narrow it against `NotificationErrorCode` yourself.                                                                                                                |
| `NotificationErrorCode`     | The union of every value in `NOTIFICATION_ERROR_CODES`. | The 25 `notification.*` string literals, for example `'notification.otp_cooldown_active'`; the full list with statuses is in [Errors](#-errors). It is derived from the constant, so a code added to the constant is added to the type.                                                                                                                                                                     |

#### Observability constants (`./observability`)

Every label value of the metrics and spans comes from one of these closed sets; the metrics, spans and health behaviour that use them are described in [Observability](#-observability).

| Name                                  | What it is                                                  | Value                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NOTIFICATION_METRIC_NAMES`           | The Prometheus metric names, as a read-only `as const` map. | `messages`: `bymax_notification_messages_total`; `sendDuration`: `bymax_notification_send_duration_seconds`; `otp`: `bymax_notification_otp_total`. |
| `NOTIFICATION_SEND_CHANNELS`          | The channels a send is counted on.                          | `['email']`. A send on any other channel is not counted.                                                                                            |
| `NOTIFICATION_SEND_OUTCOMES`          | How a send ends.                                            | `['sent', 'failed', 'rejected']`. An outcome outside the set is not counted.                                                                        |
| `NOTIFICATION_OTP_EVENTS`             | What happens to a code.                                     | `['issued', 'verified', 'failed', 'locked']`. An event outside the set is not counted.                                                              |
| `NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE` | The one attribute a span carries.                           | `'bymax.notification.channel'`.                                                                                                                     |
| `NOTIFICATION_TRACER_NAME`            | The name the tracer is requested under.                     | `'@bymax-one/nest-notification'`.                                                                                                                   |
| `NOTIFICATION_HEALTH_NAME`            | The name the readiness check reports under.                 | `'notification'`.                                                                                                                                   |

#### Observability providers and types (`./observability`)

| Name                               | What it is                                                                     | Shape, defaults and failure modes                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NotificationMetrics`              | The injectable that records sends and code events as Prometheus metrics.       | Registers the three collectors on the registry `@bymax-one/nest-core` passes it at bootstrap, every series at zero. `onSend(event)` counts the send and observes its duration in seconds; `onOtp(event)` counts a code event. A channel, outcome or event outside the closed sets is dropped. Before the registry is handed over, and in an application with metrics off, it records nothing and throws nothing.    |
| `NotificationTracing`              | The injectable that runs an operation inside an OpenTelemetry span.            | `span(name, attributes, run)` starts an active span under `NOTIFICATION_TRACER_NAME` with the single attribute `NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE`, returns what `run` returns, and ends the span however `run` settles. When `run` throws, the span gets status `ERROR` with the error's `code` as message (`'unknown'` for an error that is not a `NotificationException`) and the error is rethrown unchanged. |
| `NotificationObservabilityOptions` | The options of `NotificationObservabilityModule.register`.                     | `{ readonly health?: NotificationHealthOptions }`. With `health` omitted, the readiness check uses its defaults.                                                                                                                                                                                                                                                                                                    |
| `NOTIFICATION_HEALTH_OPTIONS`      | The injection token (a `Symbol`) under which the check's options are provided. | `register` provides `options.health`, or `{}`, under it. `NotificationHealthIndicator` injects it as optional, so the check also works when nothing is provided. Provide it yourself only to replace the options of the check.                                                                                                                                                                                      |
| `NotificationHealthOptions`        | How the readiness check caches and bounds its verification.                    | See the table below. Every field is optional and read-only.                                                                                                                                                                                                                                                                                                                                                         |

| `NotificationHealthOptions` field | Default              | What a value does                                                                                                                                                                                                                                      |
| --------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `successTtlMs`                    | `300000` (5 minutes) | How long a successful verification is trusted before the relay is verified again.                                                                                                                                                                      |
| `failureTtlMs`                    | `30000` (30 seconds) | How long a failed verification is trusted before the relay is tried again.                                                                                                                                                                             |
| `timeoutMs`                       | `4000`               | The longest a verification may take. A verification that has not settled by then counts as failed, so the check reports `down`. Keep it below the health indicator timeout of `BymaxCoreModule` (`5000` by default), or the aggregator gives up first. |

None of the three fields is range-checked. A verification that throws also counts as failed, and its answer is kept for `failureTtlMs`.

---

## 🚨 Errors

| Member                           | Purpose                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `NotificationException`          | `HttpException` carrying a stable `code`, a status, and optional `details` |
| `NotificationExceptionOptions`   | Constructor options bag: `{ status?, message?, cause? }`                   |
| `NOTIFICATION_ERROR_CODES`       | The stable `notification.*` codes — branch on these, not on messages       |
| `NOTIFICATION_ERROR_DEFINITIONS` | Server-side code → HTTP status + default English message                   |

Codes never change once published; default messages are English, so localize on the `code`. A code marked **reserved** is in the catalog but never thrown by the library. The OTP verify codes are reserved: `verify()` returns its failure as a result (`{ valid: false, reason }`) and never throws it, so your controller maps `reason` to the code it answers with. The SMS codes stay reserved until that channel exists.

**Which status says what.** A caller's mistake is 4xx. A backing service that is unavailable is **503**, and the caller may try again later: `OTP_STORAGE_UNAVAILABLE` when the OTP store cannot be reached, is closed, timed out, or is a Redis replica or still loading, and `EMAIL_SEND_FAILED` with status 503 when the email provider could not be reached, timed out or asked to be tried later: an SMTP relay's 4xx reply, a Resend 429 (the same code answers 502 when the provider answered and refused, and an SMTP 5xx is a refusal). A provider of your own gets the same rule from the error it throws: an error, or one of its causes, with a `responseCode` from `400` to `499`, or with one of the connection codes such as `ECONNREFUSED`, `ETIMEDOUT` or `EUNAVAILABLE`, answers 503, so a provider that wraps Nodemailer needs no mapping. A configuration fault or a defect is 500, and a failure of a store you implemented that is not an outage (a method that throws or rejects, or one that cannot be read) is `OTP_STORAGE_FAILED`, so it is never mistaken for an outage; the store's own error is its `cause` and its text is not in the message. `AUDIT_LOG_FAILED` is 500: the audit repository is yours, and the library cannot tell its outage from a bug.

| Code                                             | Status | Raised by                                                                                                                                                                                           |
| ------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `notification.email_provider_not_configured`     | 500    | `EmailService` — the provider reports `isConfigured() === false`                                                                                                                                    |
| `notification.email_send_failed`                 | 502    | `EmailService` — the provider rejected the send (503 when it could not be reached, timed out or asked to retry later)                                                                               |
| `notification.email_attachments_too_large`       | 413    | `EmailService` — the attachments exceed `maxAttachmentBytes`                                                                                                                                        |
| `notification.email_invalid_recipient`           | 400    | `OtpService.generate` and `resend` — an email recipient that is not one mailbox; `EmailService` — more than `maxRecipients`                                                                         |
| `notification.email_missing_body`                | 400    | `NotificationService.dispatch` — neither a template nor a subject and body; `EmailService` and both providers — an html or text part that is not a string                                           |
| `notification.template_not_found`                | 500    | `EmailService.sendTemplate` — no template for the locale or the fallback (for `otp_code`, `details.remedy` says how to register it)                                                                 |
| `notification.template_render_failed`            | 500    | `EmailService.sendTemplate` — the renderer threw                                                                                                                                                    |
| `notification.otp_storage_not_configured`        | 500    | `OtpService` — the OTP channel is absent                                                                                                                                                            |
| `notification.otp_email_delivery_not_configured` | 500    | `OtpService.generate` — email delivery without an email channel                                                                                                                                     |
| `notification.otp_manual_delivery_unavailable`   | 400    | `OtpService.generate` — manual delivery while `otp.codeSecret` is set                                                                                                                               |
| `notification.otp_cooldown_active`               | 429    | `OtpService.generate` and `resend` — inside the resend cooldown                                                                                                                                     |
| `notification.otp_not_found`                     | 404    | reserved — `verify()` returns `{ valid: false, reason: 'not_found' }`                                                                                                                               |
| `notification.otp_expired`                       | 410    | reserved — an expired code is reported as `not_found`                                                                                                                                               |
| `notification.otp_max_attempts_exceeded`         | 429    | reserved — `verify()` returns `{ valid: false, reason: 'max_attempts' }`                                                                                                                            |
| `notification.otp_invalid_code`                  | 401    | reserved — `verify()` returns `{ valid: false, reason: 'invalid_code' }`                                                                                                                            |
| `notification.otp_storage_unavailable`           | 503    | `OtpService` — the store's backing service is unreachable, closed or timed out                                                                                                                      |
| `notification.otp_storage_failed`                | 500    | `OtpService` — a method of the store threw, rejected or could not be read, and it was not an outage                                                                                                 |
| `notification.otp_invalid_length`                | 400    | module options validation and the code generator                                                                                                                                                    |
| `notification.sms_provider_not_configured`       | 500    | reserved — the SMS channel is not implemented                                                                                                                                                       |
| `notification.sms_send_failed`                   | 502    | reserved — the SMS channel is not implemented                                                                                                                                                       |
| `notification.sms_invalid_recipient`             | 400    | reserved — the SMS channel is not implemented                                                                                                                                                       |
| `notification.push_provider_not_configured`      | 500    | `isConfigured()` of the push provider threw, did not answer a boolean, or answered `false` at startup (the boot fails)                                                                              |
| `notification.push_send_failed`                  | 502    | the push provider failed and nothing was sent (503 with `details.retryable: true` when a retry can succeed); carries no provider text                                                               |
| `notification.audit_log_failed`                  | 500    | `EmailService`, `OtpService`, `PushService` and `NotificationAuditInterceptor` — only with `audit.swallowErrors: false`                                                                             |
| `notification.channel_disabled`                  | 501    | `NotificationService` — the channel is absent, or its provider or storage is not usable                                                                                                             |
| `notification.invalid_scope_identifier`          | 400    | `OtpService`, `EmailService` and `NotificationAuditInterceptor` — a blank or control-character tenant or recipient, or any send or OTP call made while `Object.prototype` holds a key it should not |

The library attaches the underlying error as the native `Error.cause`, as a **log-safe copy**: `name`, `message`, `stack` and the depth-bounded `cause` chain survive, and every other property is dropped, because SDK errors retain the request payload and, for an OTP email, that payload holds the code. The one exception is a failed send that publishes the provider's text (the default): the `cause` of `EMAIL_SEND_FAILED` is a fresh `Error` with the provider's message (secrets removed, every address-shaped token masked) and nothing else: no `code`, no chain. The provider's code is read for the status of the failure, and the reference adapters copy it to the error they throw unless it holds a value you declared secret. The cause never enters the HTTP response, and `details` stays client-safe. To attach one yourself, pass the options bag third: `new NotificationException('EMAIL_SEND_FAILED', { providerName }, { cause: error })`.

### Secrets in provider error text

A relay that quotes the rejected content puts the rendered body into the provider error, which rides the `cause` into your logs. Two controls, both per send:

- **Declare the secret.** `auditRedactValues: [code]` scrubs it from the `cause`, from the failed-audit `errorMessage`, and from the provider's own error logging (as `EmailSendOptions.redactValues`). Any run of 16+ characters of the rendered body found in a provider error is also redacted.
- **Withhold the provider text.** `publishProviderText: false` (the built-in OTP delivery already sets it) removes every byte the provider wrote: no `cause`, and an `errorMessage` of `[provider text withheld]`. It publishes only the SMTP reply code and the RFC 3463 enhanced code, which are independent of the secret. Each code is read only when it is the sole such token in the relay text, and only when it stands alone, not against a letter, digit, underscore or dot: `550 5.1.1 ... tenant=TEN456` yields `550` and `5.1.1`, and a text with two different reply-shaped numbers yields none. A number that stands alone (`port 587`, `tenant=250`) is still published when it is the only one, because the grammar cannot tell it from a reply code. The audit entry names them `deliveryStatus` / `deliveryEnhancedStatus`; the exception's `details` names them `status` / `enhanced`.

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

- **No SMS channel.** Email, OTP and push exist; the SMS error codes and token are reserved.
- **No device-token store.** The push channel keeps no token: your backend stores them and deletes the ones a result reports as `token_unregistered`.
- **No HTTP endpoints.** It ships no controller or route. Your controller resolves the tenant, calls the services, and maps `verify()` results to responses.
- **No rate limiting by IP.** It bounds failed attempts per recipient and purpose, not requests per client. Rate-limit the OTP endpoints yourself.
- **No database or ORM.** It never imports `@prisma/client`; persistence is behind `IOtpStorage` and `INotificationLogRepository`, which you implement or take from the bundled adapters.
- **No address validation beyond one rule.** An OTP delivered by email must go to exactly one mailbox (a list, a display name or a CRLF is refused with `email_invalid_recipient`), and a message is capped at `maxRecipients`. Any other bad address surfaces as `email_send_failed` from the provider.
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
