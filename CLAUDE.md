# @bymax-one/nest-notification — AI Agent Quick Reference

> **Type:** npm public library (NOT an application)
> **Package:** `@bymax-one/nest-notification` — multi-channel notification for NestJS 11 (email, OTP) + React 19 hooks
> **Runtime:** Node.js 24+ | All crypto via `node:crypto` — zero direct dependencies (functionality via peer deps)

---

## Critical Rules

**1. npm Library — Not an App** (uses pnpm)

- Zero direct dependencies (`"dependencies": {}`). Everything is a `peerDependency` or a `node:` builtin.
- **NEVER import `@prisma/client`** — or any ORM/db client. Persistence lives behind `IOtpStorage` and `INotificationLogRepository`. The `check:no-prisma` CI gate fails the build on any `@prisma/client` import in `src/`.
- Define interfaces (`IEmailProvider`, `IOtpStorage`, `IEmailTemplateRenderer`, `INotificationLogRepository`) — never import a concrete provider/store/ORM.
- Export the public API from `src/{subpath}/index.ts`. `export type` for interfaces/types, `export` for classes/constants.

**2. English Only**

- All code, comments, JSDoc, identifiers, and docs in English. JSDoc on every public export.
- Default error messages in `NOTIFICATION_ERROR_DEFINITIONS` are English; consumers localize on the `code`.

**3. TypeScript — Zero `any`**

- Never `any` in production code. Use `unknown`, generics, or explicit types.
- `interface` for contracts, `type` for unions/intersections, `I` prefix for the persistence/provider interfaces.
- `strict: true` (with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) — no exceptions.

**4. Security — Non-Negotiable**

- `node:crypto` only — `randomInt` for codes (built character-by-character; never `10 ** length`), `timingSafeEqual` for comparison. Never `crypto-js`, `otpauth`, `uuid`, or `nanoid`.
- **Atomic OTP.** The attempt counter is mutated only by `storage.consumeAttempt`; the resend cooldown is acquired only by `storage.tryAcquireCooldown` (`SET NX EX`) and released on delivery failure. Never a service-side `get` + `update` — that races and lets `maxAttempts` / anti-resend be bypassed.
- **Never log codes.** OTP codes are never written to an audit entry, console/logger line, or `errorMessage` (message only — never a stack trace). Gate: `JSON.stringify(auditEntry).includes(realCode) === false`.
- **SHA-256 keys.** Store keys are `sha256(tenantId:recipient)` — no recipient PII in keys, no cross-tenant collision.

**5. NestJS Patterns**

- Injection tokens are `Symbol()` — never strings. Singletons only (no `Scope.REQUEST`).
- Conditional registration: only configured channels are registered; an unconfigured channel throws at startup. `@Optional()` for cross-channel injections (e.g. `EmailService` inside `OtpService`).
- Controllers stay thin (validate → delegate → return). Resolve `tenantId` from a trusted source and pass it down.

**6. Code Style**

- Single quotes, no semicolons, 2-space indent. camelCase files, PascalCase classes.
- Import order: `node:` → external → internal → relative → types. One responsibility per file/function (functions ≤ 50 lines, files ≤ 800).
- Every file carries an `@fileoverview` + `@layer` header. Timeless comments — no roadmap-stage references.

**7. Testing — TDD, 100% Coverage (hard gate)**

- Co-located tests (`*.spec.ts`). AAA pattern. Mock external deps — never real Redis/email in unit tests.
- **100% statements / branches / functions / lines** per file (`pnpm test:cov:all`). Not a target — a pre-publish gate.
- **Mutation score ≥ 95% (Stryker `break: 95`), driven toward 100%** — the deeper gate against weak tests. Critical paths (`code-generator`, `timing-safe-compare`, `hash`, `redis-otp.storage`, `otp.service`) at 100%. Not in per-PR CI — a manual/release gate.

**8. Build** — tsup builds 3 subpaths → ESM (`.mjs`) + CJS (`.cjs`) + `.d.ts`. `sideEffects: false`. Peer deps always external.

---

## Subpaths

| Subpath      | Purpose                                          | Peer Deps                              |
| ------------ | ------------------------------------------------ | -------------------------------------- |
| `.` (server) | NestJS module — services, providers, interceptor | NestJS 11 (+ your provider/store SDKs) |
| `./shared`   | Types + constants                                | none                                   |
| `./react`    | OTP-input + countdown hooks (UX/state only)      | react ^19                              |

`shared` is independent; `react` depends only on `react`; `server` is independent.

---

## Verification — Run Before Completing Any Task

```bash
pnpm typecheck && pnpm lint && pnpm check:no-prisma && pnpm test:cov && pnpm build && pnpm size
```

### Mutation testing (before tagging a release)

Line coverage is 100%, but mutation testing is the real gate against weak tests. Run under Node 24:

```bash
pnpm mutation:dry-run   # validate config
pnpm mutation           # full run; writes reports/mutation/mutation.html
```

Equivalent mutants are documented inline with `// Stryker disable next-line <Mutator>: <reason>`
— acceptable **only** for genuinely equivalent mutants (no test can kill them), each carrying a
reason. Minimize them, and **never** disable a mutant a test could kill. Do **not** add mutation
testing to `prepublishOnly` or the per-PR CI — it is a manual/release gate.

---

## Where Things Live

| Concern                     | Path                                            |
| --------------------------- | ----------------------------------------------- |
| Dynamic module              | `src/server/bymax-notification.module.ts`       |
| Services                    | `src/server/services/`                          |
| Reference providers/storage | `src/server/providers/`                         |
| Crypto utils                | `src/server/utils/`                             |
| Interfaces (contracts)      | `src/server/interfaces/`                        |
| Error catalog + exception   | `src/server/errors/`                            |
| React hooks                 | `src/react/`                                    |
| Full architecture deep-dive | [AGENTS.md](./AGENTS.md) (load on demand)       |
| Spec / plan                 | `docs/technical_specification.md`, `docs/development_plan.md` |
