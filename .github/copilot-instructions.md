# Copilot Review Instructions — Bymax org baseline

Organization-wide baseline for GitHub Copilot code review across `bymaxone`
repositories. It captures the invariants that hold in **every** repo, regardless
of stack. Each repository **appends its own domain rules** below this baseline
(supply-chain contract, crypto/tenant rules, PII handling, pixel parity, fiscal
math, …) — those live in the consuming repo, not here.

Path-specific rules live alongside this file:

- `.github/instructions/code.library.instructions.md` — publishable `@bymax-one/*` libraries
- `.github/instructions/tests.instructions.md` — test suites
- `.github/agents/agent-code-reviewer.agent.md` — the reviewer agent definition

> **These files do not propagate automatically.** Unlike community health files,
> GitHub reads Copilot instructions only from the repository being reviewed. Copy
> the ones you need into a new repo, then extend them. The universal core below is
> also mirrored in **Org → Settings → Copilot → Custom instructions**, which _does_
> apply to every repository's Copilot code review automatically.

## CRITICAL — block the PR

- **Zero `any`** (`any`, `as any`) in TypeScript; use `unknown` with type guards.
- **No suppression comments** without a written justification: `@ts-ignore`,
  `@ts-expect-error`, `eslint-disable`, Rust `#[allow(...)]`, or `unsafe`.
- **Rust** (where present): edition 2024; `#![forbid(unsafe_code)]` +
  `#![deny(missing_docs)]` per crate; **no `unwrap`, `expect`, `panic!`, `todo!`,
  or `unreachable!`** in non-test code — return a typed `thiserror` error instead.
- **No secrets, tokens, or credentials** in any committed file — only local/dev
  fixtures (Mailpit, test values). **Never log** secrets, tokens, OTP codes, or PII.
- The HTTP/transport layer **maps internal errors to a stable envelope** and never
  leaks an internal error string to the client.

## HIGH — block unless justified

- Every exported symbol carries **JSDoc / rustdoc** (with an `@example` where non-trivial).
- **Functions ≤ 50 lines; files ≤ 800 lines**; one responsibility per unit.
- **100% coverage** (statements, branches, functions, lines) on files that carry
  logic; non-executable glue is out of scope.
- **Reuse `@bymax-one/*` libraries verbatim** — never reimplement a shared
  capability. The shared design system is reused, never re-styled.

## MEDIUM — flag for discussion

- **Conventional Commits**; never a `Co-Authored-By` or any AI-attribution trailer.
- **English-only, timeless** comments and identifiers — describe what the code does
  and why, never which roadmap step or task produced it.
- **Mutation-aware tests** — no generic matchers (`toBeDefined()`, `toBeTruthy()`)
  where a concrete value assertion is possible.

---

# Domain rules — `@bymax-one/nest-notification`

This package delivers transactional notifications (email + OTP) for multi-tenant
NestJS apps. Its threat model is codes leaking and tenants bleeding into each
other, so the rules below are additive to the baseline and rank **CRITICAL**.

## CRITICAL — block the PR

- **A code is never written anywhere it can be read back.** Not to a logger or
  `console`, not into a `NotificationLogEntry`, not into a `NotificationException`
  message or `details`. An `errorMessage` carries the message only — never a stack
  trace, which can hold the code in a frame argument. The gate is
  `JSON.stringify(auditEntry).includes(realCode) === false`.
- **`node:crypto` only.** `randomInt` for code generation (built character by
  character — never `10 ** length`, which loses uniformity and overflows), and
  `timingSafeEqual` for every comparison of a code or token. `crypto-js`,
  `otpauth`, `uuid`, and `nanoid` are forbidden imports.
- **The attempt counter and the resend cooldown mutate only inside the storage.**
  `storage.consumeAttempt` is the sole writer of `attempts`;
  `storage.tryAcquireCooldown` (`SET NX EX`) is the sole acquirer of the cooldown.
  A service-side `get` + `update` races, and the race is exactly how `maxAttempts`
  and the anti-resend window get bypassed — flag any such pair.
- **Storage keys are `sha256(tenantId:recipient)`.** No recipient PII in a key, no
  key shape that lets two tenants collide. `tenantId` is resolved from a trusted
  source (the validated request context), never from the request body.
- **No ORM or provider SDK import in `src/`.** Persistence lives behind
  `IOtpStorage` and `INotificationLogRepository`; delivery behind `IEmailProvider`.
  `@prisma/client` is gated in CI by `pnpm check:no-prisma`; the same reasoning
  applies to every other database client.

## HIGH — block unless justified

- **`dependencies` stays `{}`.** Anything new is a peer dependency, and optional
  unless every consumer needs it. A reference adapter imports its SDK lazily.
- **A public signature must not name a type from a peer package** — the emitted
  `.d.ts` would import it, and a consumer compiling with `skipLibCheck: false`
  then needs a package it does not use. Declare a structural contract instead.
- **Injection tokens are `Symbol()`**, never strings; providers are singletons —
  no `Scope.REQUEST`. Only configured channels register, and configuring an
  unconfigured channel throws at startup rather than failing on first use.
- **Equivalent mutants carry a reason.** A `Stryker disable next-line` comment is
  acceptable only when no test could kill the mutant, and only with the reason
  written out. Flag a blanket disable, and flag one placed over a mutant a test
  could reach.
