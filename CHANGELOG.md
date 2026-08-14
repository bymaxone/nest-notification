# Changelog

All notable changes to `@bymax-one/nest-notification` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-14

### Added

- **`SmtpEmailProvider` — a bundled `IEmailProvider` speaking SMTP through Nodemailer.** Until now
  the library shipped an adapter for one vendor's HTTP API (Resend) but none for the protocol every
  relay, Postfix, corporate gateway and SES SMTP endpoint understands — and none for the mail-capture
  servers (Mailpit, MailHog) that are the only way a consumer can exercise its email flows end to
  end. Every consumer was therefore hand-writing the same adapter. `nodemailer` was already declared
  as an optional peer dependency and marked external in the build; only the implementation was
  missing.

  ```typescript
  import { SmtpEmailProvider } from '@bymax-one/nest-notification'

  // Local capture server — open relay, plaintext.
  new SmtpEmailProvider({ host: 'localhost', port: 1025, secure: false })

  // Authenticated production relay — STARTTLS already mandatory by default.
  new SmtpEmailProvider({
    host: process.env.SMTP_HOST,
    port: 587,
    credentials: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  })
  ```

  Behaviour worth knowing before adopting:

  - **STARTTLS is mandatory by default for any non-loopback host.** On a connection that does not
    start out encrypted, whether TLS happens at all is decided by the _plaintext_ EHLO banner: an
    attacker with network position strips the `250-STARTTLS` line, the transport never upgrades,
    and the credentials plus the OTP-bearing body cross the network in the clear. `requireTls`
    therefore defaults to `true` unless the host is `localhost` / `127.0.0.1` / `::1`, or `secure`
    is already on. **A capture server reached by a compose service name rather than over loopback
    needs an explicit `requireTls: false`** — it will fail closed otherwise, which is the intended
    direction.
  - **A line break in `from`, `replyTo`, a recipient, or a custom header name/value is rejected
    before the send.** Nodemailer already neutralizes these, so this is defence in depth. The
    subject is exempt: a stray trailing newline from a template is plausible there.
  - **`isConfigured()` answers on real configuration.** A host is required; credentials are required
    only when a `credentials` object was supplied at all, which is how a deployment declares that it
    logs in. An open capture server is configured; a relay whose `SMTP_PASS` failed to load is not,
    and the send fails closed rather than silently going out anonymously.
  - **The option is `credentials`, not `auth`** — this is a notification library, not an
    authentication one. Nodemailer's own wire key stays `auth` inside the adapter.
  - **Nodemailer is loaded lazily** on the first `send()`, so a consumer on another transport never
    installs it. Concurrent first sends share one initialization; a failed init is retried.
  - **No startup `verify()`** — a briefly unreachable relay must not stop the application booting.
  - **Timeouts are bounded** at `10s` connection / `10s` greeting / `20s` socket, because
    Nodemailer's own defaults run into minutes and would pin a request path.
  - **The `messageId` is the RFC-5322 `Message-ID`**, angle brackets included, so an audit entry
    correlates with the header the recipient received.
  - **A base64 string attachment is tagged `encoding: 'base64'`.** `EmailAttachment.content` is
    documented as a `Buffer` **or** a base64 string; untagged, Nodemailer would deliver the base64
    text as the literal file contents.
  - **`tags` are not forwarded** — SMTP has no tag facility. They still reach the audit log.
  - **Neither credential is ever exposed**: both live in an ECMAScript private field (so
    `JSON.stringify`, object spread and `util.inspect` cannot reach them) and both are scrubbed out
    of any transport error before it is logged or re-thrown into the audit entry. The **user** is
    scrubbed too, because it is not always a public login — an SES SMTP username is itself generated
    secret material. Matching is literal, so a very short credential over-redacts the message; that
    is the deliberate direction, since the other failure mode is persisting a secret.

  **Apply to a derived backend:** none required — this is additive. To adopt, `pnpm add nodemailer`
  and swap the hand-written adapter for `SmtpEmailProvider`.

### Changed

- `docs/technical_specification.md` §5.1.5 is no longer an "example adapter" sketch: it documents the
  shipped provider, its options, and the reasoning behind each design decision that had a plausible
  alternative. The sketch's `isConfigured(): return Boolean(this.transporter)` was always `true` and
  is explicitly not what the implementation does.

## [1.1.0] - 2026-08-11

### Changed

- **BREAKING: `ioredis` peer dependency moved to `^6.0.0`** (was `^5.0.0`; the ranges are
  disjoint, so an ioredis 5 consumer no longer satisfies the contract). This lets a consumer that
  also installs `@bymax-one/nest-queue@1.2.0` (which peers `ioredis ^6.0.0`) resolve a single
  ioredis version instead of two. `RedisOtpStorage` never imports `ioredis`: it depends on the
  locally declared structural `RedisLike` surface, so no runtime path changed. ioredis 6 keeps
  `replyMapping: "legacy"` by default, so the reply shapes the Lua/TTL paths rely on are
  unchanged. **Apply to a derived backend:** none — this is a library peer range; a consumer on
  ioredis 5 must move to ioredis 6 to satisfy the new peer.
- **Stryker mutation gate raised to 100%.** `thresholds.break`, `thresholds.high`, and
  `thresholds.low` in `stryker.config.json` are now all `100`, so any surviving (non-equivalent)
  mutant fails the run rather than being tolerated above 95%. The score was already 100% with no
  survivors; this makes the standard the gate.

## [1.0.6] - 2026-08-10

Remediation of a local audit's development-log privacy finding (merged in #55). No API changed.

### Fixed

- **The no-op email provider no longer logs the recipient in clear, the subject, or the body.** The
  development provider now logs only a first-initial mask of each recipient (`m***@example.com`).
  The subject is dropped entirely: it is rendered from a consumer template that can interpolate an
  OTP code, so logging it could persist a real code in a developer's log, violating the
  never-log-codes invariant.

## [1.0.5] - 2026-08-08

**Documentation only.** `dist/` is byte-identical to `1.0.4`; no source file changed.

### Fixed

- **The README understated the mutation score.** The badge and
  `docs/mutation_testing_results.md` both record **100%** with no survivors, measured in the
  2026-08-06 re-run — but the prose bullet beside them still said **98.17%**, and cited "857
  of 873 viable seeded faults killed" from the pass before it. The badge and the report were
  updated and the sentence between them was not, so the npm page has been claiming less than
  the package delivers.
- The `[Unreleased]` compare link still pointed at `v1.0.3` after `1.0.4` shipped.

## [1.0.4] - 2026-08-06

**Published-artifact change, not a behavioural one.** `dist/` differs from `1.0.3` — this
bundler preserves comments and the source gained mutation-suppression notes — but no runtime
path changed. Measured by building both revisions and diffing the output.

### Documentation

- The mutation badge said **98%**; the measured score is **100.00%**.

### Tests

- OTP expiry is `now + ttlSeconds * 1000` and only its order of magnitude was checked. Dividing
  instead of multiplying would expire a 300-second code 0.3 milliseconds after minting it, and
  every failure would read as a delivery problem rather than an arithmetic one.
- A dotted template path stops at the first non-object. Without that guard `{{ name.0 }}` renders
  the first letter of the string, and the same slip against `{{ token.0 }}` would put the first
  character of a secret in an email.

## [1.0.3] - 2026-08-05

### Fixed

- **`NotificationService` never received its channel services, and said the channels were
  disabled.** Both constructor parameters carried `@Optional()` and no `@Inject`. Nest
  reads three separate metadata keys here — `self:paramtypes` from `@Inject()`,
  `design:paramtypes` from TypeScript, and `optional:paramtypes` from `@Optional()` — and
  the third only says a dependency may be missing; it carries no token. The published
  bundle is built by tsup/esbuild, which documents that it cannot emit `design:paramtypes`,
  so neither key that names a dependency was present and both parameters resolved to
  `undefined`.

  With both channels configured, the module logged `Initialized with channels: email, otp`
  while `getEnabledChannels()` returned `[]` and `dispatch()` threw `CHANNEL_DISABLED` —
  an error that blamed a configuration that was correct. Both parameters now carry
  `@Inject`, keeping `@Optional()`, which is the shape `@nestjs/jwt` uses for the same
  situation.

### Changed

- `emitDecoratorMetadata` is `false` in `tsconfig.json`. It was `true`, which was never
  true of the artifact — tsup printed this on every build of this package:

  ```
  You have emitDecoratorMetadata enabled but @swc/core was not installed, skipping swc plugin
  ```

  The source now compiles the way the bundle is built, so a parameter that depends on
  reflected types fails where it is cheap to see rather than in a consumer's process.

## [1.0.2] - 2026-08-04

### Security

- The Resend API key and the Redis client are no longer disclosed when the provider or
  the OTP storage that holds them is serialized. `ResendEmailProvider` kept its adapter
  options — which carry `apiKey` — and `RedisOtpStorage` kept its client in TypeScript
  `private` properties, which are erased at runtime and leave enumerable own properties.
  `JSON.stringify`, object spread and `util.inspect` therefore emitted the API key in
  plaintext, and reached `options.password` on the ioredis instance. Both move to
  ECMAScript private fields. That matters because these are registered providers: a
  structured logger rendering its arguments, or an error reporter capturing the scope of
  a throw, walks them without being asked to.

Reading on purpose is unchanged and no public type or export moved.

## [1.0.1] - 2026-08-01

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

- **`handlebars` peer floor raised to `^4.7.9`.** The declared `^4.7.7` admitted
  4.7.7 and 4.7.8, which carry eight advisories, the worst of them **critical**:
  [GHSA-2w6w-674q-4c4q](https://github.com/advisories/GHSA-2w6w-674q-4c4q)
  (JavaScript injection via AST type confusion), alongside four further injection
  and denial-of-service findings, all first patched in 4.7.9.

  `handlebars` is an _optional_ peer — the library never imports it, and the
  Handlebars renderer is an adapter example under `docs/templates/`. Optional
  does not make the range harmless: it is still the version this package tells
  anyone who opts in that it supports, and a consumer wiring that renderer
  resolves it against exactly this floor.

  Found by the scheduled `peer-advisory-drift` check on its first run, not by
  the manual sweep that raised the NestJS floor — that sweep went looking for
  NestJS specifically and never asked the question of the other eleven peers.

  Shipped as a patch, which is where a security fix belongs.

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

[1.0.4]: https://github.com/bymaxone/nest-notification/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/bymaxone/nest-notification/compare/v1.0.2...v1.0.3
[Unreleased]: https://github.com/bymaxone/nest-notification/compare/v1.0.6...HEAD
[1.1.0]: https://github.com/bymaxone/nest-notification/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/bymaxone/nest-notification/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/bymaxone/nest-notification/compare/v1.0.4...v1.0.5
[1.0.2]: https://github.com/bymaxone/nest-notification/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/bymaxone/nest-notification/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-notification/releases/tag/v1.0.0
