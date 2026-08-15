# Changelog

All notable changes to `@bymax-one/nest-notification` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.1] - 2026-08-15

### Fixed

- **A provider error that echoes the message body no longer carries the body's secrets into the
  attached `cause`.** Measured by a consumer on published 1.2.0 with a server-side control: a
  policy relay quoting the rejected content in its `550` put a live OTP into the ERROR-level log
  entry, in `err.cause.message` and `err.cause.stack` — a path 1.2.0 created by attaching the
  cause, upgrading a pre-existing `warn`-level leak. The 1.2.0 scrub only ran where THIS library
  issues the code (`OtpService`); a consumer-issued code sent through `EmailService.send` (e.g.
  `@bymax-one/nest-auth`'s OTP flows) was outside it.

  Three layers now close the delivery path:
  - `EmailService` scrubs the outgoing `cause` (not just the audit `errorMessage`) with the
    caller's declared `auditRedactValues`, on `EMAIL_SEND_FAILED` and `TEMPLATE_RENDER_FAILED`.
  - **Echo detection** (`collectEchoedExcerpts`): any run of 16+ characters of the rendered
    body found inside the provider error is treated as an echo and redacted — this is what makes
    the UNDECLARED case fail safe for the measured scenario, since the library knows the body it
    just handed to the provider even when it does not know which part is secret. Limits, stated
    plainly: matching is raw and literal (a re-encoded echo is missed) and a bare secret quoted
    without surrounding content is shorter than the window and is not caught. Declared values
    remain the precise control.
  - Declared values travel to the provider as `EmailSendOptions.redactValues`, and
    `SmtpEmailProvider` scrubs them plus detected body echoes from its `warn` line and thrown
    message — closing the pre-existing `warn`-level half of the same leak.

  **Boundary that this release does NOT close, so the note cannot read as "done":** a
  consumer-issued secret is fully covered only when the caller declares it. `@bymax-one/nest-auth`
  never calls `EmailService` itself — it defines an email-provider port that the consumer's own
  adapter implements — so the declaration belongs to that adapter: whoever calls
  `EmailService.send`/`sendTemplate` with a secret should pass it in `auditRedactValues`. Until
  then, a bare code echoed WITHOUT surrounding body content remains exposed on that path — the
  echo guard needs 16+ contiguous characters of body context to trigger.

- **Overlapping secrets can no longer leave a fragment behind after redaction.** `redactValues`
  used to replace value-by-value over its own output, so `['123', '1234']` over `1234` emitted
  `[redacted]4` — one digit of a live secret surviving — and two values overlapping without
  nesting (`['1234', '2345']` over `12345`) leaked a fragment under EVERY replacement order.
  Occurrences are now located against the original text and overlapping or nested matches merge
  into a single marker before anything is replaced; a value can also no longer match inside a
  marker inserted for an earlier one. Every scrub path (audit `errorMessage`, outgoing `cause`,
  SMTP credential/echo redaction) inherits the fix. Credit: the defect class was measured by a
  consuming team's review of their own scrub of the same shape.

- **`NotificationException` no longer exposes the constructor's `options` argument to
  serializers.** NestJS's `HttpException` keeps `options` as an enumerable own property, so
  structured log output showed `"options":{"cause":{}}` beside the real `cause` — a duplicate
  reference to the same sanitized copy (no additional secret exposure, but a second surface to
  audit). The property is now non-enumerable; deliberate reads still work.

## [1.2.0] - 2026-08-14

### Added

- **`NotificationException` now carries the underlying error as the native `Error.cause`.** A failed
  dispatch used to log _what_ failed and never _why_: `EMAIL_SEND_FAILED` discarded the provider's
  error, so a `connect ECONNREFUSED` existed only in a separate `warn` line — recoverable by
  request-id correlation, and entirely absent for a deployment logging at `error`. Since dispatch is
  fire-and-forget, the log is the only surface where the reason can appear at all. Reported by a
  consumer with a live reproduction (SMTP pointed at a closed port), and verified against this
  release the same way: the reason now sits nested inside the same serialized `err` object, with no
  change on the logging side — cause-walking serializers (e.g. pino's `err`) pick it up natively.

  The third constructor parameter accepts an options bag,
  `new NotificationException(key, details, { status?, message?, cause? })`, mirroring how
  `HttpException` itself evolved; the positional `(key, details, status, message)` form keeps
  working unchanged. All five sites that previously discarded the underlying error now attach it:
  `EMAIL_SEND_FAILED`, `TEMPLATE_RENDER_FAILED`, and the three `AUDIT_LOG_FAILED` throw sites.
  `NotificationExceptionOptions` is exported from the server subpath.

  The cause is stored as a **log-safe copy**, not the raw object: `name`, `message`, `stack`, and
  the nested `cause` chain survive (depth-bounded); every other property is dropped. Provider/SDK
  errors routinely retain the request payload in extra properties (an axios-style `config.data`),
  and for an OTP email that payload contains the code — attaching the raw object would have handed
  a cause-walking serializer exactly what the never-log-codes rule exists to keep out of logs.
  Non-Error object causes are flattened to their `String()` form for the same reason; primitives
  pass through. One nuance, inherited from Nest and documented on the option: `HttpException`
  installs only a _truthy_ cause, so a falsy cause is silently ignored.

### Fixed

- **`AUDIT_LOG_FAILED` no longer leaks internal error text into the HTTP response.** The three
  audit-failure sites stuffed the caught error's message into `details.cause` — and `details` is
  serialized into the response body, so storage/audit internals reached the HTTP client on a 502
  whenever `audit.swallowErrors` was `false`. The error now rides only on `Error.cause` (never
  serialized into the response) and those responses carry `details: null`. The security gate was
  extended to match: tests serialize thrown exceptions recursively — message, stack, response body,
  and every nested cause — and assert the plaintext OTP code appears at no depth.

- **A delivery error that echoes the plaintext code is scrubbed before it leaves `OtpService`.**
  The renderer receives the code inside its template `data` and the provider receives it inside
  the rendered body, so either may echo it in a thrown error's message or stack. On a failed OTP
  delivery the service now replaces every occurrence of the code with `[redacted]` — in the audit
  entry's `errorMessage` and across the rethrown error chain (message and stack at every link) —
  at the one layer that knows the secret. The scrub also covers `name` (serializers emit it like
  `message`), deletes payload-bearing own enumerable properties from arbitrary errors (a storage
  may reject with `Object.assign(new Error(...), { entry })` — and the entry carries the code —
  while a `NotificationException` keeps its contract properties, safe by construction), and
  flattens a non-`Error` `cause` link — a primitive string tail carries the secret verbatim and
  an object tail can carry it in a property, and neither can be walked as an Error.
  Traversal is identity-based (`WeakSet`), so a cyclic chain terminates and no depth limit leaves
  an unscrubbed tail; writes go through `Reflect.set`, so a frozen foreign error degrades to
  best-effort instead of throwing. Any non-`Error` rejection — a string, or an object a custom
  storage may reject with that retains the entry — is flattened to a redacted string, since a raw
  object could carry the code in its properties.

- **`EmailService` redacts declared secrets from its own failed-audit entry.** The email `failed`
  audit entry records the provider's message, which is written before `OtpService` can scrub the
  rethrown chain — so a provider that echoes the rendered body leaked the code into that one
  entry. `EmailSendInput`/`EmailSendTemplateInput` gain `auditRedactValues`: secret values the
  caller declares (only the caller knows them) that are replaced with `[redacted]` in the entry's
  `errorMessage`. OTP delivery passes `[code]` automatically; a real-path regression (real
  `EmailService`, echoing provider) asserts both audit entries and the rethrown chain are
  code-free.

## [1.1.2] - 2026-08-14

### Fixed

- **A failed optional-peer import no longer always blames a missing package.** `SmtpEmailProvider`
  and `ResendEmailProvider` both wrapped their lazy `import()` in a bare `catch` that mapped _every_
  failure to `` `<pkg>` package is not installed. Run `pnpm add <pkg>` ``. That is worse than no
  message: it names a fix that cannot work, so a consumer reinstalls a package that is already in
  `node_modules` and starts doubting their dependency tree.

  The case that actually bites, reported by a consumer and reproduced against the published 1.1.1
  tarball: a Jest suite running **without `--experimental-vm-modules`** cannot service a dynamic
  `import()` at all and fails with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` while the package
  is installed. Every consumer unit test reaching `send()` hit the wrong diagnosis.

  Now the install instruction requires two things: a module-resolution code —
  `ERR_MODULE_NOT_FOUND` (dynamic import) or `MODULE_NOT_FOUND` (the CommonJS `require` form) — **and**
  a message naming that exact specifier. The code alone is not enough: an _installed_ peer whose own
  evaluation fails because one of **its** dependencies is missing rejects with the very same codes,
  verified on Node 24 with a fixture package, and blaming the top-level peer there would be the same
  bug one level down. The specifier check degrades safely — when it cannot confirm the name, the
  honest message is used, so the worst case is a lost hint rather than a confident wrong claim.

  Anything else is surfaced as ``Failed to load `<pkg>`: <the real message>`` with the original error
  kept as `cause`. The loading logic now lives once in an internal `loadOptionalPeer` helper, so the
  two adapters cannot drift.

  **Apply to a derived backend:** none. If a unit suite needs to exercise a code path that reaches
  `send()`, run Jest with `--experimental-vm-modules` — that is the supported way to service a
  dynamic `import()` under Jest, and the error now says so instead of misdirecting.

## [1.1.1] - 2026-08-14

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
[1.2.1]: https://github.com/bymaxone/nest-notification/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/bymaxone/nest-notification/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/bymaxone/nest-notification/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/bymaxone/nest-notification/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/bymaxone/nest-notification/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/bymaxone/nest-notification/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/bymaxone/nest-notification/compare/v1.0.4...v1.0.5
[1.0.2]: https://github.com/bymaxone/nest-notification/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/bymaxone/nest-notification/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-notification/releases/tag/v1.0.0
