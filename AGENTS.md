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

Codex takes its review rules from the [Code Review Rules](#code-review-rules) section at the
end of this file — that heading, in `AGENTS.md`, is the only repository-level review
configuration it reads. The block between the `shared:` markers there is the canonical copy
from `bymaxone/.github` and is replaced wholesale by the `agents-sync` workflow; edit it
there, not here.

---

## 1. Project Overview

A transactional notification library for **NestJS 11**. It ships **email** and **OTP**
channels. The defining constraint is decoupling: every external boundary — email
transport, OTP store, template renderer, audit sink — is a TypeScript **interface** the
consumer implements or picks from the bundled reference adapters. The library ships
`"dependencies": {}`; NestJS, the email SDK, the Redis client, and React are all peer
dependencies. OTP cryptography uses `node:crypto` exclusively.

`ISmsProvider` and `IPushProvider` are declared so consumers can plan dispatch code paths
against a stable shape, but no service implements them; configuring the `sms` / `push`
channels is rejected at startup.

## 2. Architecture

### Layered structure

```
src/
├── server/                         layer: api / domain / infra
│   ├── bymax-notification.module.ts   dynamic module — conditional registration
│   ├── services/                      EmailService · OtpService · NotificationService
│   ├── providers/                     Resend · SMTP · Redis · InMemory · NoOp · DefaultRenderer
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
"not yet implemented" message). `resolveOptions` then merges consumer values over defaults,
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
{
  "error": {
    "code": "notification.otp_invalid_code",
    "message": "Invalid OTP code",
    "details": null
  }
}
```

Consumers match on the stable `code`. The catalog (`NOTIFICATION_ERROR_DEFINITIONS`) maps
each key to a `code`, an HTTP status, and a default English message; `shared` re-exports
the codes (byte-identical) so the frontend can match without importing the server bundle.

### OTP store key patterns (RedisOtpStorage)

```
{namespace}:otp:{purpose}:{sha256(sha256(tenantId):sha256(recipient))}       # the OTP entry (TTL = ttlSeconds)
{namespace}:otp_cd:{purpose}:{sha256(sha256(tenantId):sha256(recipient))}    # the resend lock (TTL = cooldownSeconds)
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

1. **SHA-256 store keys** — `sha256(sha256(tenantId):sha256(recipient))`. Privacy (no
   recipient enumeration from `KEYS`) + isolation. The isolation is a property of the
   **encoding**, not of the digest: each component is hashed to a fixed length before the
   join, so distinct pairs cannot share an input. Joining the raw values around a delimiter
   maps `('a:b', 'c')` and `('a', 'b:c')` to one key while every hash property still holds.
   An empty component is refused for the same reason — it collapses callers into one scope.
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

| Channel / feature | Peer dep(s)                                                  |
| ----------------- | ------------------------------------------------------------ |
| NestJS module     | `@nestjs/common`, `@nestjs/core`, `reflect-metadata`, `rxjs` |
| Resend email      | `resend`                                                     |
| SMTP email        | `nodemailer`                                                 |
| Redis OTP store   | `ioredis`                                                    |
| React hooks       | `react ^19`                                                  |
| `./shared`        | none                                                         |

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
- **The `./testing` subpath** ships `otpStorageContract(factory)`: 21 executable cases a consumer
  runs against their own `IOtpStorage` in any runner (the package depends on none). It covers the
  obligations a type cannot check — `consumeAttempt` and `tryAcquireCooldown` must be atomic, the
  TTL must survive `update`, and both entry and cooldown keys must be scoped by tenant, recipient
  and purpose. Each case is itself pinned by a storage that violates exactly that obligation, one
  per operand where the check is composite; a contract that cannot fail is decoration.
- **`publishProviderText: false`** on a send makes the failure carry no provider-authored byte — no
  `cause`, and `[provider text withheld]` in the audit entry — publishing instead only the SMTP
  reply codes a fixed grammar can express (`deliveryStatus` / `deliveryEnhancedStatus`). It exists
  because value redaction is a blacklist: it removes the shapes it predicts and loses to a body
  quoted in another transfer encoding. The built-in OTP delivery sets it; the default stays `true`
  so ordinary mail keeps its diagnosis.
- **Mutation testing** (Stryker, `break: 100`) is the deeper gate against weak tests; the score
  is 100%, with critical paths (`code-generator`, `timing-safe-compare`, `hash`,
  `redis-otp.storage`, `otp.service`) at 100%. Runs automatically post-merge on `main` via the shared reusable (`bymaxone/.github` → node-lib-ci), never on PRs; plus an optional manual `pnpm mutation`.
- **Mocking** — never real Redis or a real email API in unit tests (`ioredis-mock` and
  in-memory fakes). E2E specs in `test/e2e/` cover tenant isolation and audit behavior.
- **Security gate test** — the never-log-codes invariant is asserted directly against a
  serialized audit entry.

## 9. Build and Publish

- **tsup** builds 3 subpaths → ESM (`.mjs`) + CJS (`.cjs`) + `.d.ts` + `.d.cts`;
  `sideEffects: false`; peer deps always external. The `.mjs` ships unminified (readable
  stack traces inside a consumer's `node_modules`).
- **Exports map** — `types` is declared **inside each condition**: `import` resolves to
  `.d.ts`, `require` to `.d.cts`. A single shared `types` key would hand ESM declarations
  to a CommonJS consumer; the runtime keeps working, so only `pnpm check:exports` (attw
  against the packed tarball) catches it. `main` / `module` / `types` at the top level
  cover the legacy `node` resolution algorithm, which ignores `exports` entirely, and
  `typesVersions` covers the subpaths in that same mode.
- **Bundle budgets** (`pnpm size`, brotli): server < 30 KB, shared < 4 KB, react < 8 KB.
- **CI** — `ci.yml` is a thin caller of the org-wide `bymaxone/.github` reusable pipeline
  (lint · typecheck · `test:cov:all` · mutation on main), plus a local `verify` job for
  `check:no-prisma` · `test:types` · build · build-output integrity · `check:exports` ·
  `size`. `codeql.yml` and `scorecard.yml` run on push + weekly. `release.yml` is
  **tag-driven only** (`v*.*.*`): it runs `prepublishOnly`, the release-shape gates
  (`size`, `check:exports`, dogfood smoke), then `pnpm publish --provenance` via OIDC.
- **Provenance** — published with npm provenance so consumers can `npm audit signatures`.
  npm trusted publishing requires the package to already exist, so the very first release
  is published from a maintainer's machine without provenance; every release after that
  is published by CI with a SLSA attestation.

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

---

## Code Review Rules

<!-- shared:begin -->
<!--
  CANONICAL COPY: bymaxone/.github → agents/code-review-rules.md
  Do not edit this block in a consuming repository. It is replaced wholesale by
  the `agents-sync` reusable workflow, so a local edit is reverted on the next
  run. Change it here, cut a release, and every repository is offered the update.

  Repository-specific rules go OUTSIDE this block, below the closing marker.

  FOR WHOEVER EDITS THIS FILE, not for the reviewer who reads it:

  Codex reads one AGENTS.md per directory, root to nested, within
  project_doc_max_bytes (32 KiB default). Never name a template or fixture
  AGENTS.md below the root: a change under it is read as the repo's guidance.

  This block is charged against every consumer's budget. A rule added here must
  be worth the bytes in the smallest-headroom repository, not only in this one;
  agents-sync reports each consumer's headroom and fails when it is exceeded.

  When you scope a rule, scope every rule in its paragraph or split the
  paragraph -- an unscoped neighbour reads as deliberate.
-->

These rules hold in every Bymax repository. What is specific to this one is written after this
block, and the two are read together.

The pipeline already enforces formatting, linting, dependency policy, coverage and — where the
repository has one — the mutation gate. Do not spend a review on a **violation** of one of those: it
is a red check, not a comment. What follows is what CI cannot see.

A violation of a rule in this block is reported at **P1** at minimum. Codex surfaces only P0 and P1
on a pull request, so a rule whose violations land at P2 is a rule nobody sees.

**When a rule moves from here into a check, it leaves here.** A red check is proportionate to a
correctness failure that is invisible without it, and disproportionate to style enforced at an
inconvenient moment. Never carry both: a rule stated here _and_ enforced by CI spends a reviewer's
attention on what a gate already reports.

**A change to the enforcing configuration is the opposite case, and it is in scope.** Every gate runs
the configuration from the branch under review — that branch's lint config, its coverage thresholds,
its mutation thresholds. So a pull request that deletes a rule, lowers a threshold or widens an
ignore glob turns the check **green**, because a gate reports on the rules it was handed. For those
diffs the review is the only independent check there is, and a weakened gate needs the same
justification a suppression does.

### A finding names what it read

Every factual claim in a review — about a library's API, about this repository's history, about what
a file contains — has to come from something read in the tree under review, and the finding should
say which. A claim assembled from recollection is likely to describe a previous version of whatever
it is about.

**Safe path**, by the kind of claim:

| Claim about                             | Read this                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| A library's API **shape**               | `node_modules/<pkg>/dist/**/*.d.ts` in this tree                               |
| A library's **runtime behaviour**       | that version's changelog entry, its documentation, or a test that exercises it |
| A commit's author or committer identity | out of scope: it is not text a change introduces                               |
| What a file contains                    | the file at the revision under review, not an earlier one                      |

The first two rows are separate on purpose, and the rule below says why: a field can stay optional
in the published type while becoming mandatory in behaviour. A `.d.ts` settles what a signature
accepts and nothing about what the implementation does with it, so a behavioural claim resting on
one is unfounded.

Weight the checking by what acting on the finding would cost. A comment that asks for a reworded
sentence is cheap to be wrong about; one that asks for history to be rewritten, a merge reverted, or
a release pulled is not — verify that class before raising it, and raise it at the severity the
evidence supports rather than the severity the consequence would deserve if true.

### A dependency upgrade migrates every call site, not only the ones that fail to compile

When an upgrade tightens a contract, the compiler catches only the call sites whose **shape**
changed. A field that stays optional in the published type while becoming mandatory in behaviour
compiles, passes the unit suite, and fails in production.

A `@bymax-one/*` version number carries **no compatibility information** while the libraries are
pre-stable: breaking changes ship in minor and patch releases by explicit policy, so `^` and `~`
protect against nothing. The migration note under **Apply to a derived backend** in the library's own
changelog is the compatibility contract.

**Safe path:** read **every** changelog entry from the version being replaced up to the proposed
one, not only the proposed one's, and check every call site they name — not only the ones the
compiler rejected. Upgrades routinely skip releases, and the entry that matters is often not the
last one: adopting `@bymax-one/nest-cache` 1.1.0 → 1.2.1 skipped 1.2.0, where a namespace-validation
security fix lives; 1.2.1's own entry is a field rename. Diff the `.d.ts` of the **previously adopted** version against
the **proposed** one — `npm pack` both, and name the two versions. Reaching for "the installed
declarations" is the trap: in a checkout of the branch under review the installed tree is already
the new version, so that diff compares a release with itself and shows nothing.

### Settled decisions are not review findings

Both are settled deliberately, and reopening either costs a round trip and changes nothing:

- **Do not propose a major version bump** for a breaking change in a `@bymax-one/*` library, and do
  not assert that this ecosystem follows strict SemVer. Until an API is declared stable, breaking
  changes ship in minor and patch releases; the migration note carries the compatibility information
  the number does not. If a document claims strict SemVer, the finding is that the claim is wrong —
  not that the version should be raised.
- **Do not propose pinning `bymaxone/.github` reusable workflows to a commit SHA.** They are
  referenced by the `@v1` alias on purpose: a fix has to land once and reach every repository, the
  tag is immutable and the alias moves only on a release, and pinning was measured to cost ~58
  dependency pull requests to propagate one change. Third-party actions are the opposite case and
  **are** pinned by SHA.

**Safe path:** if you believe a settled decision is now wrong, say so as a question in the pull
request rather than as a finding.

### Suppressions are refusals, not exceptions

`@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable` in any form,
`as unknown as` laundering a real type error, `istanbul ignore`, and in Rust `#[allow(...)]` over a
lint gate or `unsafe` without a `// SAFETY:` comment are blocking findings.

Anything a configured gate already reports belongs to the gate, not to a review: where a repository
lints `no-explicit-any` as an error — most do — an `as any` is a red check, and raising it here only
duplicates it. Check the repository's lint configuration before reporting a suppression rather than
assuming the list is exhaustive in either direction.

A failing gate means the code is wrong, the type is wrong, or the rule is wrong. **Safe path:** fix
whichever it is. Changing a rule's configuration with a stated reason is legitimate; scattering
per-call-site silencers is not.

### Comments state constraints, never history

A comment must read as true for whoever opens the file next. Flag any comment that narrates what a
previous version did, names a phase, task, ticket or review round, or explains a change rather than
the code. **Safe path:** state the constraint that still holds, and let `git log` carry the history.

### Size and layering

Functions over **50 lines** and nesting deeper than four levels are findings **for what a change
introduces** — a new function, or a change that pushes an existing one past the limit — in the
repository's own source and test directories. A test-suite grouping construct (`describe`, `context`,
`mod tests`, a table of cases) is not a function; the unit under the limit is the body of a single
`it`/`test`/`#[test]`. On the same terms, every non-trivial source file a change introduces opens
with a header stating its purpose and its layer, and every exported symbol a change introduces
carries a doc comment.

**The 800-line file limit applies to what a change introduces, not to what it inherits.** A
repository that already carries a file past the line — a generator, a long end-to-end suite — would
otherwise produce a finding on every pull request touching three lines of it, which the author
cannot act on and did not cause. Raise it for a **new** file over the limit, or when a change pushes
a file past it or materially grows one already over.

Markdown, generated output and lockfiles are **out of scope**: a changelog is an append-only log that
only grows, a lockfile is generated, and neither has layers. Reporting their length is a false
positive on every dependency bump and every release note.

**Safe path:** extract by responsibility rather than by line count — the limit is a symptom, and one
file doing two jobs is the defect.

### Language and attribution

Everything published is English — source, comments, tests, commit messages, pull request titles and
bodies, `README.md`, `CHANGELOG.md` and everything under `.github/`.

Each repository states its language policy for `docs/` below this block. Report a language finding in
`docs/` only against what the repository states; where it states nothing, `docs/` is English like
everything else. A `docs/` language other than English is a repository-owner decision recorded in the
narrowings, not a convention a contributor may introduce.

No commit, pull request, comment or code may attribute authorship to an AI assistant or coding tool,
in any form. **Only text the change introduces is in scope** — a trailer, a "generated with" line, a
signature in a comment or a description.

A commit's author and committer fields are not that: they come from the contributor's git
configuration rather than from the diff, and a review reading the diff cannot see them. Never report
an identity field, and never present a command's reconstructed output as evidence for one. Measured:
eight P1 findings in a single day across four pull requests, each naming a commit SHA that does not
exist in the repository it was reported against and quoting `git log` output no review had run. What
each one asked for was a force-push rewriting published history.

<!-- shared:end -->

### The audit entry never records what was dispatched

`NotificationLogEntry` carries the tenant, channel, verb, masked recipient, purpose, provider
name, message id and a failure **message** — never the subject, never the rendered body, never a
stack trace. A consumer template can interpolate a one-time code into either, so a finding that
asks for the subject or the body "for debuggability" asks for a credential in an audit row. The
logging surface says the same: `NoOpEmailProvider` logs a masked recipient at `debug` and nothing
else, and the SMTP and Resend providers log a failure reason with no recipient at all.

**Safe path:** diagnose from `messageId`, `deliveryStatus` / `deliveryEnhancedStatus` and the
`verb` — the fields that are independent of the message body. The invariant is asserted directly,
against a serialized entry: `JSON.stringify(auditEntry).includes(realCode) === false`.

### A send that can carry a secret sets `publishProviderText: false`

`OtpService` sets it on every delivery it builds, alongside `auditRedactValues: [code]`. The two
are not redundant: declaring the value covers the shapes redaction can predict, and the flag
covers the ones it cannot — value redaction is a blacklist and loses to a body quoted in another
transfer encoding. With the flag off, the failure carries no provider-authored byte — no `cause`,
`[provider text withheld]` in the audit entry — and publishes only the reply codes a fixed grammar
can express.

So a new path that mails a secret and leaves the flag at its default (`true`) is a finding even
when nothing in that diff visibly leaks. The default stays `true` on purpose, so ordinary mail
keeps its diagnosis; do not report that default as the defect.

### The audit entry and the exception name the reply codes differently, and that is settled

The audit entry carries `deliveryStatus` / `deliveryEnhancedStatus`; the exception's `details`
carries `status` / `enhanced`. Both shipped in 1.3.0 and both are public API, so unifying the
names is a breaking change — `CHANGELOG.md` records it as an open 1.4.0 question, not an
oversight for a patch to quietly correct.

**Safe path:** if a document describes the two surfaces as the same pair, the finding is that the
document is wrong. Renaming a field is a release decision, and it is already taken.

### `useClass` / `useExisting` are reserved, not missing

`forRootAsync` wires the `useFactory` + `inject` form only. `assertUseFactory` **rejects**
`useClass` and `useExisting` at registration rather than ignoring them, so a consumer never boots
believing an unwired form took effect; `BymaxNotificationModuleOptionsFactory` is declared for the
same reason and documented as reserved. A reviewer meeting the factory interface reads the gap as
an omission and asks for the branch.

**Safe path:** treat the rejection as the behaviour under review — that it throws, with a message
naming the supported form, is what the tests assert. Wiring the form is an API decision, not a fix.
