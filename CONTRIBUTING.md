# Contributing to @bymax-one/nest-notification

Thank you for your interest in contributing! This document describes the workflow
and quality gates for this library. By participating, you agree to abide by our
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting security issues

**Do not open public issues for security vulnerabilities.** Follow the private
reporting process described in [SECURITY.md](./SECURITY.md). A leaked OTP code, a
cross-tenant read, or a way around the attempt / cooldown limits is a security
report, not a bug report.

## Prerequisites

- Node.js >= 24
- pnpm 10.8.1 (`corepack enable`)

## Getting started

```bash
pnpm install
pnpm build
```

## Development workflow

This is a published npm library, not an application. Keep `dependencies` empty —
everything ships as a `peerDependency` or a `node:` builtin, and the library never
imports an ORM or a provider SDK: persistence lives behind `IOtpStorage` and
`INotificationLogRepository`, delivery behind `IEmailProvider`. Conventions live in
[CLAUDE.md](./CLAUDE.md) and [AGENTS.md](./AGENTS.md); the architecture is in
[docs/technical_specification.md](./docs/technical_specification.md).

1. Create a branch from `main`.
2. Make your change; add or update co-located `*.spec.ts` tests (TDD — 100%
   coverage is a hard gate, not a target). Mock every external dependency —
   never a real Redis connection or a real email send in a unit test.
3. If you change or add a public type, update `test/types/public-api.test-d.ts`:
   the published signatures are part of the contract.
4. Run the full verification suite before opening a PR.

### Invariants a change must preserve

- **Codes never leave the process in readable form** — not in a log line, an audit
  entry, an exception message, or a stack trace.
- **The attempt counter and the resend cooldown mutate only inside the storage**
  (`consumeAttempt`, `tryAcquireCooldown`). A service-side `get` + `update` races
  and lets the limits be bypassed under concurrency.
- **`node:crypto` only** — `randomInt` for codes, `timingSafeEqual` for
  comparisons. No `crypto-js`, `otpauth`, `uuid`, or `nanoid`.
- **Storage keys stay `sha256(sha256(tenantId):sha256(recipient))`** — each component hashed
  before the join, so the encoding admits no ambiguity; no recipient PII in a key,
  no cross-tenant collision.

## Verification — run before every PR

```bash
pnpm typecheck && pnpm test:types && pnpm lint && pnpm check:no-prisma && \
  pnpm test:cov:all && pnpm build && pnpm size && pnpm check:exports
```

All of the following must pass:

- **Typecheck** — `tsc --noEmit` (strict, zero errors)
- **Type API** — `test/types/` compiles, locking the published signatures
- **Lint** — ESLint (zero `any`, import order, security rules)
- **Prisma-free** — no `@prisma/client` import anywhere in `src/`
- **Coverage** — 100% statements / branches / functions / lines
- **Build** — tsup produces ESM + CJS + `.d.ts` + `.d.cts` for every subpath
- **Size** — every subpath stays within the budget in `scripts/check-size.mjs`
- **Exports** — `attw` resolves every entrypoint correctly in ESM and CJS

Mutation testing (`pnpm mutation`) is a **release gate**, run manually before
tagging a version — never on every PR.

## Commits — Conventional Commits

Commit messages are validated by commitlint via the `commit-msg` hook:

```
<type>(<scope>): <subject>
```

Types: `feat | fix | docs | refactor | perf | test | build | ci | chore | revert`.
The `pre-commit` hook runs lint-staged (ESLint + Prettier on staged files).

## Pull requests

- Keep PRs focused and small.
- Record user-facing changes under the `Unreleased` section of `CHANGELOG.md`.
- All CI checks (`ci`, `codeql`, `scorecard`) must be green.

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](./LICENSE).
