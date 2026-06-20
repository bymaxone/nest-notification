# Phase 4 — Multi-tenant + Audit Log

> **Status**: 🔄 In Progress · **Progress**: 1 / 8 tasks · **Last updated**: 2026-06-20
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 5 (Phase 4)
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md)

---

## Context

Consolidate multi-tenancy (tenant-isolation regression tests, the `tenantIdResolver` anti-spoofing convenience typed `NotificationRequest`) and complete the audit system (the opt-in `NotificationAuditInterceptor`, the Prisma fragment + example, the README security section). Also complete `forRootAsync()` (left as a stub in Phase 1) so every channel provider is wired through DI. The hashing isolation already exists from Phase 2 — here it is proven with regression tests and documented.

---

## Rules-of-phase

1. **Isolation is provable.** Tests assert no OTP/cooldown collision across tenants and no cross-tenant verify leak; Redis keys are hex-encoded (no PII).
2. **Anti-spoofing.** `tenantIdResolver` (typed `NotificationRequest`, Express+Fastify compatible) is the source of truth in the interceptor — `payload.tenantId` is a suggestion.
3. **Audit never crashes the flow.** Fire-and-forget, swallowed by default; OTP codes never appear in any audit entry (security gate).
4. **`forRootAsync` v0.1 supports `useFactory` only** (`useClass`/`useExisting` rejected with an explicit message); services use `@Optional()` for unconfigured channels.
5. **100% coverage** on the interceptor; e2e suites green. English-only, timeless comments.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — §7 (multi-tenant), §5.6.2 (Prisma fragment), §4.6 (forRoot/forRootAsync), §11.5 (error security).
- [`docs/development_plan.md`](../development_plan.md) — §5.1–§5.8.

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 4.1 | Tenant-isolation E2E suite | ✅ | P0 | M | 2.3, 2.5 |
| 4.2 | `NotificationAuditInterceptor` (opt-in, anti-spoofing) | ⬜ | P1 | M | 2.6 |
| 4.3 | Complete `forRootAsync()` | ⬜ | P0 | M | 1.8, 2.7 |
| 4.4 | Prisma fragment + `PrismaNotificationLogRepository` example | ⬜ | P2 | S | 1.3 |
| 4.5 | Multi-tenant security section in README (draft) | ⬜ | P2 | S | — |
| 4.6 | Tests — interceptor + audit-log E2E (never-log-code gate) | ⬜ | P0 | M | 4.1, 4.2, 4.3 |
| 4.7 | Barrel export (interceptor) | ⬜ | P1 | S | 4.2 |
| 4.8 | Phase 4 validation + smoke | ⬜ | P0 | S | 4.6 |

---

## Tasks

### Task 4.1 — Tenant-isolation E2E suite

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.3, 2.5

#### Description

A regression suite proving cross-tenant isolation for both `InMemoryOtpStorage` and `RedisOtpStorage`.

#### Acceptance criteria

- [x] No OTP collision across tenants with the same recipient; no cooldown collision; no cross-tenant verify leak (`tenant_b` verifying `tenant_a`'s code → `not_found`)
- [x] Redis keys are hex-encoded (no plaintext recipient/tenantId)
- [x] Suite passes in CI (in-repo Redis double); does not affect unit coverage

#### Files to create / modify

- `test/e2e/tenant-isolation.e2e-spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Multi-tenancy via
`sha256(tenantId:recipient)` keys; isolation is a security property that must be regression-tested.

CURRENT PHASE: 4 (Multi-tenant + Audit) — Task 4.1 of 8

PRECONDITIONS
- Tasks 2.3, 2.5 done: RedisOtpStorage + OtpService.

REQUIRED READING (only these):
- `docs/technical_specification.md` §7 (multi-tenant model).
- `docs/development_plan.md` §5.1.

TASK
Write the tenant-isolation E2E suite.

DELIVERABLES
1. `test/e2e/tenant-isolation.e2e-spec.ts` — InMemory: no OTP/cooldown collision, no cross-tenant verify
   leak; Redis (ioredis-mock): keys hex-encoded with no PII.

Constraints:
- Use `@nestjs/testing`; English-only.

Verification:
- `pnpm test:e2e -- tenant-isolation` passes.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `1/8`. 4. Update Phase 4 row in the plan.
5. Append `- 4.1 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 4.2 — `NotificationAuditInterceptor`

- **Status**: ⬜ Not started
- **Priority**: P1
- **Size**: M
- **Depends on**: 2.6

#### Description

An opt-in interceptor that records audit entries for `NotificationService.dispatch()` calls, resolving `tenantId` via `global.tenantIdResolver` (anti-spoofing).

#### Acceptance criteria

- [ ] Logs `verb:'sent'` + `providerName:'__interceptor__'` on success; `verb:'failed'` + `errorMessage` then re-throws on failure
- [ ] When `tenantIdResolver` is set, extracts `tenantId` from the request, overriding `payload.tenantId`
- [ ] Failures swallowed by default; recognizes the dispatch input by shape; not auto-registered (consumer opts in via `APP_INTERCEPTOR`)
- [ ] Coverage 100%

#### Files to create / modify

- `src/server/interceptors/notification-audit.interceptor.ts`

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. The audit interceptor is
opt-in and uses `tenantIdResolver` (typed `NotificationRequest`) as the trusted tenant source.

CURRENT PHASE: 4 (Multi-tenant + Audit) — Task 4.2 of 8

PRECONDITIONS
- Task 2.6 done: NotificationService + dispatch types.

REQUIRED READING (only these):
- `docs/technical_specification.md` §2.6 (audit flow), §7.3 (tenantIdResolver).
- `docs/development_plan.md` §5.2.

TASK
Implement `NotificationAuditInterceptor`.

DELIVERABLES
1. `notification-audit.interceptor.ts` — `intercept` taps success → `recordMeta('sent')`, catches error →
   `recordMeta('failed', msg)` + rethrow; `recordMeta` extracts the request + dispatch input, prefers
   `tenantIdResolver(req)` over `payload.tenantId`, writes a `NotificationLogEntry` (`providerName:'__interceptor__'`),
   swallows per `swallowErrors`.

Constraints:
- Not auto-registered (document opt-in). English-only, timeless comments.

Verification:
- `pnpm test src/server/interceptors/notification-audit.interceptor.spec.ts` at 100% (mock ExecutionContext).

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `2/8`. 4. Update Phase 4 row.
5. Append `- 4.2 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 4.3 — Complete `forRootAsync()`

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.8, 2.7

#### Description

Finish `forRootAsync()`: resolve options via `useFactory`, then wire all channel providers (factory-based, depending on the resolved options token) and the services.

#### Acceptance criteria

- [ ] `forRootAsync({useFactory})` resolves options from another module (e.g. `ConfigService`); `useClass`/`useExisting` throw an explicit "not yet implemented (v0.2)"
- [ ] Async-wired EmailService/OtpService inject correctly; audit defaults to NoOp
- [ ] Coverage 100% on the `forRootAsync` path

#### Files to create / modify

- `src/server/bymax-notification.module.ts`

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 4 (Multi-tenant + Audit) — Task 4.3 of 8

PRECONDITIONS
- Tasks 1.8 (sync forRoot + async stub), 2.7 (service wiring) done.

REQUIRED READING (only these):
- `docs/technical_specification.md` §4.6.
- `docs/development_plan.md` §5.3.

TASK
Complete `forRootAsync()`.

DELIVERABLES
1. `optionsProvider` (validate+resolve inside the factory; reject `useClass`/`useExisting`); factory-based
   channel providers depending on `BYMAX_NOTIFICATION_OPTIONS`; always-register the services; export all.

Constraints:
- English-only, timeless comments.

Verification:
- `pnpm test src/server/bymax-notification.module.spec.ts` (async cases) at 100%.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `3/8`. 4. Update Phase 4 row.
5. Append `- 4.3 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 4.4 — Prisma fragment + repository example

- **Status**: ⬜ Not started
- **Priority**: P2
- **Size**: S
- **Depends on**: 1.3

#### Description

Distribute the `NotificationLog` Prisma fragment and a `PrismaNotificationLogRepository` example — reference only; the lib never imports Prisma.

#### Acceptance criteria

- [ ] `docs/schemas/notification-log.prisma` covers all `NotificationLogEntry` fields with appropriate indexes; comment warns the lib never imports Prisma
- [ ] `docs/schemas/prisma-repository.example.md` shows the consumer-side `INotificationLogRepository` impl

#### Files to create / modify

- `docs/schemas/notification-log.prisma`, `docs/schemas/prisma-repository.example.md`

#### Agent prompt

````
You are a senior NestJS/database engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Persistence is the consumer's;
the lib ships a Prisma fragment as reference and never imports `@prisma/client`.

CURRENT PHASE: 4 (Multi-tenant + Audit) — Task 4.4 of 8

REQUIRED READING (only these):
- `docs/technical_specification.md` §5.6.2 (Prisma fragment).
- `docs/development_plan.md` §5.4.

TASK
Write the Prisma fragment + repository example.

DELIVERABLES
1. `docs/schemas/notification-log.prisma` — `NotificationLog` model (all fields + 3 indexes), English
   comment that the lib never imports Prisma.
2. `docs/schemas/prisma-repository.example.md` — consumer `PrismaNotificationLogRepository implements
   INotificationLogRepository`.

Verification:
- Files exist; schema covers every `NotificationLogEntry` field.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `4/8`. 4. Update Phase 4 row.
5. Append `- 4.4 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 4.5 — Multi-tenant security section in README (draft)

- **Status**: ⬜ Not started
- **Priority**: P2
- **Size**: S
- **Depends on**: —

#### Description

Draft the README "Multi-tenant Security" section (finalized in the Release phase): why sha256 keys, why `tenantIdResolver`, least-privilege logging.

#### Acceptance criteria

- [ ] Covers the hashing rationale, the spoofing scenario + resolver mitigation (`(req) => req.hostname?.split('.')[0] ?? 'default'`, `req: NotificationRequest`), and the never-log-codes guarantee

#### Files to create / modify

- `README.md` (draft section)

#### Agent prompt

````
You are a senior NestJS engineer/technical writer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 4 (Multi-tenant + Audit) — Task 4.5 of 8

REQUIRED READING (only these):
- `docs/development_plan.md` §5.5.

TASK
Draft the README "Multi-tenant Security" section.

DELIVERABLES
1. README section: sha256 key rationale; `tenantIdResolver` anti-spoofing (with the typed example);
   least-privilege logging (codes never logged).

Verification:
- Section present with the three subsections + the resolver example.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `5/8`. 4. Update Phase 4 row.
5. Append `- 4.5 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 4.6 — Tests (interceptor + audit-log E2E)

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: M
- **Depends on**: 4.1, 4.2, 4.3

#### Description

100% coverage on the interceptor + an audit-log E2E suite, including the never-log-code security gate.

#### Acceptance criteria

- [ ] `notification-audit.interceptor.ts` at 100%; anti-spoofing override tested; swallow/propagate tested
- [ ] audit-log E2E: logs `generated`+`sent` for OTP-via-email, `cooldown_blocked`, `max_attempts_exceeded`; **`JSON.stringify(entry).includes(realCode) === false`**
- [ ] `pnpm test:e2e` green; global coverage 100%

#### Files to create / modify

- `src/server/interceptors/notification-audit.interceptor.spec.ts`, `test/e2e/audit-log.e2e-spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on the nest-notification project. Use /bymax-quality:tdd
or `tester`.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. The never-log-codes gate is a
hard security requirement.

CURRENT PHASE: 4 (Multi-tenant + Audit) — Task 4.6 of 8

PRECONDITIONS
- Tasks 4.1–4.3 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §5.6.

TASK
Write the interceptor unit tests + the audit-log E2E.

DELIVERABLES
- `notification-audit.interceptor.spec.ts` (sent/failed, anti-spoofing override, swallow/propagate);
  `audit-log.e2e-spec.ts` (generated+sent, cooldown_blocked, max_attempts_exceeded, never-log-code gate).

Verification:
- `pnpm test:cov` 100%; `pnpm test:e2e` green; never-log-code assertion passes.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `6/8`. 4. Update Phase 4 row.
5. Append `- 4.6 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 4.7 — Barrel export (interceptor)

- **Status**: ⬜ Not started
- **Priority**: P1
- **Size**: S
- **Depends on**: 4.2

#### Description

Export `NotificationAuditInterceptor` from `src/server/index.ts`.

#### Acceptance criteria

- [ ] `NotificationAuditInterceptor` exported; `pnpm build` clean

#### Files to create / modify

- `src/server/index.ts`

#### Agent prompt

````
You are a senior TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 4 (Multi-tenant + Audit) — Task 4.7 of 8

PRECONDITIONS
- Task 4.2 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §5.7.

TASK
Export the interceptor.

DELIVERABLES
1. Add `export { NotificationAuditInterceptor } from './interceptors/notification-audit.interceptor'`.

Verification:
- `pnpm build`; `Object.keys` includes it.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `7/8`. 4. Update Phase 4 row.
5. Append `- 4.7 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 4.8 — Phase 4 validation + smoke

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: S
- **Depends on**: 4.6

#### Description

Run gates (incl. e2e) and a `forRootAsync` fixture smoke with audit + tenantIdResolver.

#### Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm test:e2e && pnpm build && pnpm size` green
- [ ] Smoke: `forRootAsync` with `tenantIdResolver` + Resend + Redis + a memory audit repo; audit rows recorded via supertest
- [ ] Code-review findings applied

#### Files to create / modify

- (validation only)

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 4 (Multi-tenant + Audit) — Task 4.8 of 8 (LAST)

PRECONDITIONS
- Tasks 4.1–4.7 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §5.8.

TASK
Run the Phase 4 gate + the forRootAsync smoke.

DELIVERABLES
- Gate (incl. e2e) green; the smoke per §5.8.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm test:e2e && pnpm build && pnpm size`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `8/8`. 4. Mark the Phase 4 row ✅ in
the plan. 5. Append `- 4.8 ✅ <YYYY-MM-DD> — <summary>`.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 4.1 ✅ 2026-06-20 — Tenant-isolation E2E suite: per-tenant OTP/cooldown independence, no cross-tenant verify leak, hex-only Redis keys.
