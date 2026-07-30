# Changelog

All notable changes to `@bymax-one/nest-notification` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-07-30

### Security

- **`@nestjs/common` peer floor raised to `^11.0.16`.** The declared `^11.0.0`
  admitted 11.0.0–11.0.15, which carry
  [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) —
  remote code execution via the `Content-Type` header, first patched in 11.0.16.

  `@nestjs/core` already sat at `^11.1.18` and needed no change. This gap is worth
  recording precisely: the ranges here were audited and clean when `1.0.0` was cut,
  and stopped being clean when the advisory was published, with no commit and no
  alert in between. Dependabot does not catch it — it looks at what is _installed_
  in this repository, never at what the package _declares it supports_.

  Shipped as a patch, which is where a security fix belongs.

---

## [Unreleased]

## [1.0.0] - 2026-07-30

First public release. Email + OTP channels, multi-tenant by design, pluggable
providers and storage, zero runtime dependencies, and never an `@prisma/client`
import.

### Added

- **`BymaxNotificationModule`** — dynamic NestJS 11 module with `forRoot` and
  `forRootAsync` (`useFactory`). Conditional provider registration: only the channels
  you configure are wired into the container; configuring an unconfigured channel throws
  at startup.
- **Email channel** — `EmailService` plus the `IEmailProvider` contract. Bundled
  `ResendEmailProvider` (Resend) and `NoOpEmailProvider` (dev/test — logs subject and
  recipient only, never the body). Attachment size guard (`maxAttachmentBytes`, default
  10 MiB).
- **OTP channel** — `OtpService` (`generate` / `verify` / `consume` / status) plus the
  `IOtpStorage` contract. Codes via `node:crypto.randomInt` (numeric / alpha /
  alphanumeric, built character-by-character to preserve leading zeros and avoid integer
  overflow); verification via `crypto.timingSafeEqual`. **Atomic** attempt counting
  (`consumeAttempt`) and resend cooldown (`tryAcquireCooldown`, `SET NX EX`) so
  `maxAttempts` and anti-resend cannot be bypassed under concurrency.
- **Reference storages** — `RedisOtpStorage` (keys hashed `sha256(tenantId:recipient)`,
  Lua-atomic primitives) and `InMemoryOtpStorage` (single-threaded atomicity for dev/test).
- **Templating** — `IEmailTemplateRenderer` plus the bundled `DefaultTemplateRenderer`
  (`{{var}}` interpolation with automatic HTML escaping in the HTML body; subject and
  plaintext left raw). `CANONICAL_EMAIL_TEMPLATES` constant for stable template names.
- **Multi-tenant** — every operation scoped by `tenantId`; SHA-256 store keys;
  `tenantIdResolver` (anti-spoofing) read by the audit interceptor as the trusted source.
- **Audit log** — opt-in `INotificationLogRepository` (fire-and-forget,
  `swallowErrors: true` by default; optional `maskRecipient`) and a
  `NotificationAuditInterceptor` for HTTP-level `sent` / `failed` entries. OTP codes are
  never written to any audit entry.
- **`NotificationService`** — uniform dispatch façade over the configured channels.
- **`NotificationException`** + a 22-entry error catalog (`NOTIFICATION_ERROR_DEFINITIONS`)
  with stable codes and HTTP statuses; response shape `{ error: { code, message, details } }`.
- **`./shared` subpath** — zero-dependency types and constants (`NOTIFICATION_ERROR_CODES`,
  `DEFAULT_TTLS`, `OtpPurpose`, `NotificationChannel`) importable in any environment.
- **`./react` subpath** — `useOtpInput` (multi-slot input with paste, Backspace, and
  Arrow navigation) and `useOtpCountdown` (expiry countdown) hooks. UX/state only — no
  HTTP client, no Node builtins.
- **Adapter examples** — Handlebars, MJML, and React Email renderers
  (`docs/templates/`); a Prisma `INotificationLogRepository` and schema fragment
  (`docs/schemas/`). Not imported by the library.
- **Supply chain** — published with npm provenance (OIDC); CodeQL `security-extended`,
  OpenSSF Scorecard, and a `check:no-prisma` CI gate.

### Not implemented

The interfaces below ship so you can plan your dispatch code paths against them,
but the services behind them do not exist yet and configuring those channels is
rejected at startup rather than failing on the first send.

- **SMS channel** — `ISmsProvider` is declared; configuring the `sms` channel throws.
- **Push channel** — `IPushProvider` is declared on the same terms; configuring the
  `push` channel throws.
- **`forRootAsync` `useClass` / `useExisting`** — only `useFactory` is wired.
- **Multi-provider failover and routing.**

[Unreleased]: https://github.com/bymaxone/nest-notification/compare/v1.0.0...HEAD
[1.0.1]: https://github.com/bymaxone/nest-notification/releases/tag/v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-notification/releases/tag/v1.0.0
