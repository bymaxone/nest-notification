# Phase 6 — Adoption in bymax-fitness-ai

> **Status**: ⬜ Not started · **Progress**: 0 / 6 tasks · **Last updated**: 2026-06-19
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 7 (Phase 6)
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md) § 1.8 (coverage parity)

---

## Context

Replace `bymax-fitness-ai`'s `_commons_/notification/` with `@bymax-one/nest-notification`, validating the package against its **first real consumer before publishing**. This dissolves the Prisma coupling in `EmailVerificationService`, ports the 6 hardcoded production templates into an `IEmailTemplateRenderer`, and exercises the full registration + email-verification + password-reset + resend-cooldown flow against the real app.

> **Scope note:** the code in this phase lives in the **`bymax-fitness-ai` repo** (`~/Documents/MyApps/bymax-one/bymax-fitness`), not in the lib. The lib stays consumer-agnostic; this phase proves the contract end-to-end. Anything discovered here that needs a lib change feeds back into the spec/plan before Phase 7.

---

## Rules-of-phase

1. **Consumer-side only.** No lib changes (unless a gap is found — then fix the lib spec/plan/code first, then continue).
2. **Two behavior changes to account for:** the resend **cooldown is new** (the FE must handle `OTP_COOLDOWN_ACTIVE`), and **recipient must be normalized** by the caller (`email.trim().toLowerCase()`).
3. **Port all 6 templates** faithfully (shared base/header/footer preserved; trial pair keep their plain-text body + provider tags).
4. **`perPurpose` replaces the two-OTP-instance hack** (`email_verification:3600`, `password_reset:600`).
5. **Delete only after green E2E.** Remove `_commons_/notification/` and its imports once the flow passes.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — § 1.8 (fitness→lib coverage parity map), §5.6.2 (Prisma fragment), §9.2 (canonical templates), §17 (integrated registration + OTP flow).
- [`docs/development_plan.md`](../development_plan.md) — § 7.1–§7.6.
- Source being replaced: `~/Documents/MyApps/bymax-one/bymax-fitness/_commons_/notification/` (`email.service.ts`, `otp/otp.service.ts`, `otp/otp-redis.service.ts`, `verification/email-verification.service.ts`).

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 6.1 | `PrismaNotificationLogRepository` (fitness backend) | ⬜ | P0 | S | — |
| 6.2 | `BymaxFitnessTemplateRenderer` — port the 6 production templates | ⬜ | P0 | L | — |
| 6.3 | Refactor `EmailVerificationService` → `OtpService` | ⬜ | P0 | M | 6.1, 6.2 |
| 6.4 | Wire the frontend resend to `OTP_COOLDOWN_ACTIVE` | ⬜ | P1 | S | 6.3 |
| 6.5 | Remove `_commons_/notification/` + E2E smoke | ⬜ | P0 | M | 6.3, 6.4 |
| 6.6 | Phase 6 validation | ⬜ | P0 | S | 6.5 |

---

## Tasks

### Task 6.1 — `PrismaNotificationLogRepository` (fitness backend)

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: S
- **Depends on**: —

#### Description

Implement `INotificationLogRepository` over the fitness Prisma client and register it under `audit.repository`. (The lib never imports Prisma — the consumer does.)

#### Acceptance criteria

- [ ] `NotificationLog` model added to the fitness `schema.prisma` (from the lib's `docs/schemas/notification-log.prisma`); migration applied
- [ ] `PrismaNotificationLogRepository.create(entry)` persists every `NotificationLogEntry` field; fire-and-forget honored (never throws into the caller when `swallowErrors:true`)

#### Files to create / modify

- (fitness) `prisma/schema.prisma`, `src/notification/prisma-notification-log.repository.ts`, the app module registration

#### Agent prompt

````
You are a senior NestJS/Prisma engineer working on the bymax-fitness-ai project (the consumer).

PROJECT: bymax-fitness-ai — a NestJS app adopting @bymax-one/nest-notification to replace its legacy
`_commons_/notification/`. The lib is DB-agnostic; the app provides the Prisma-backed audit repository.

CURRENT PHASE: 6 (Adoption) — Task 6.1 of 6

PRECONDITIONS
- @bymax-one/nest-notification v0.1 (Phases 1–5) is built and installable.

REQUIRED READING (only these):
- nest-notification `docs/schemas/notification-log.prisma` + `docs/schemas/prisma-repository.example.md`.
- nest-notification `docs/technical_specification.md` §5.6 (INotificationLogRepository).

TASK
Add the `NotificationLog` model + `PrismaNotificationLogRepository` and register it.

DELIVERABLES
1. Add the `NotificationLog` model to `prisma/schema.prisma`; run `prisma migrate dev`.
2. `PrismaNotificationLogRepository implements INotificationLogRepository` (`create` maps all fields).
3. Register `audit: { repository: new PrismaNotificationLogRepository(prisma), swallowErrors: true }`.

Constraints:
- The lib must NOT import Prisma; only the app does. English-only, timeless comments.

Verification:
- `prisma migrate status` clean; a unit test inserts and reads back a log row.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `1/6`. 4. Update the Phase 6 row in
nest-notification `docs/development_plan.md`. 5. Append `- 6.1 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.2 — `BymaxFitnessTemplateRenderer` (port the 6 templates)

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: L
- **Depends on**: —

#### Description

Port the 6 hardcoded production templates from `_commons_/notification/email/email.service.ts` into an `IEmailTemplateRenderer`.

#### Acceptance criteria

- [ ] Templates registered: `otp_code` (email verification, hours+minutes formatting), `otp_password_reset` (with optional `verificationLink` CTA), `welcome`, `password_reset_success`, `trial_expiring` (html+text+tags), `trial_expired` (html+text+tags)
- [ ] Shared base/header/footer preserved; trial templates return `{subject, html, text}` and the call sites pass `tags`
- [ ] Variables escaped in the html body only

#### Files to create / modify

- (fitness) `src/notification/bymax-fitness-template-renderer.ts`

#### Agent prompt

````
You are a senior NestJS/email engineer working on the bymax-fitness-ai project (the consumer).

PROJECT: bymax-fitness-ai — adopting @bymax-one/nest-notification. The hardcoded PT-BR HTML must move
into an `IEmailTemplateRenderer` (the lib ships no HTML).

CURRENT PHASE: 6 (Adoption) — Task 6.2 of 6

PRECONDITIONS
- The legacy templates live in `_commons_/notification/email/email.service.ts` (generate*Template methods).

REQUIRED READING (only these):
- The legacy `email.service.ts` template generators (source of the HTML).
- nest-notification `docs/technical_specification.md` §5.5 (IEmailTemplateRenderer) + §9.2 (canonical names).

TASK
Implement `BymaxFitnessTemplateRenderer` porting the 6 templates.

DELIVERABLES
1. `BymaxFitnessTemplateRenderer implements IEmailTemplateRenderer` with: `otp_code`, `otp_password_reset`
   (verificationLink CTA), `welcome`, `password_reset_success`, `trial_expiring`, `trial_expired`
   (latter two with text body + tags). Register via `email.templateRenderer`.

Constraints:
- Escape variables in the html body only. English-only code/comments (template copy stays PT-BR as the
  product requires). Functions ≤ 50 lines (split per template).

Verification:
- Unit test renders each template name and asserts subject/html (and text/tags for trial).

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `2/6`. 4. Update the Phase 6 row.
5. Append `- 6.2 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.3 — Refactor `EmailVerificationService` → `OtpService`

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: M
- **Depends on**: 6.1, 6.2

#### Description

Replace the legacy OTP/Prisma coupling with `OtpService`, keeping only the user-activation business logic; map the two TTL policies onto `otp.perPurpose`.

#### Acceptance criteria

- [ ] `EmailVerificationService` no longer imports `PrismaService` for OTP storage; uses `OtpService.generate/verify/consume`
- [ ] `recipient = email.trim().toLowerCase()`; a constant `tenantId` (e.g. `'default'`)
- [ ] `otp.perPurpose` = `{ email_verification: { ttlSeconds: 3600 }, password_reset: { ttlSeconds: 600 } }`
- [ ] Email verification + password reset both work via the lib

#### Files to create / modify

- (fitness) `src/.../email-verification.service.ts`, the app module `BymaxNotificationModule.forRootAsync({...})`

#### Agent prompt

````
You are a senior NestJS engineer working on the bymax-fitness-ai project (the consumer).

PROJECT: bymax-fitness-ai — adopting @bymax-one/nest-notification. Dissolve the Prisma/OTP coupling in
`EmailVerificationService`; the lib owns OTP storage behind `IOtpStorage`.

CURRENT PHASE: 6 (Adoption) — Task 6.3 of 6

PRECONDITIONS
- Tasks 6.1–6.2 done: audit repo + template renderer.

REQUIRED READING (only these):
- The legacy `verification/email-verification.service.ts` (current behavior).
- nest-notification `docs/technical_specification.md` §6.2 (OtpService) + §17 (integrated flow) + §1.8 (parity map).

TASK
Refactor to delegate OTP to `OtpService`; configure `forRootAsync` with `perPurpose` + RedisOtpStorage +
the audit repo + the template renderer.

DELIVERABLES
1. Rewrite `EmailVerificationService` to call `OtpService.generate({ purpose:'email_verification',
   deliverVia:'email', emailTemplate:'otp_code', recipient: email.trim().toLowerCase(), tenantId:'default' })`,
   `verify`, `consume`; keep only the user-activation/DB-status logic.
2. App module: `BymaxNotificationModule.forRootAsync` with `otp.perPurpose` (3600/600), `RedisOtpStorage`,
   the audit repo, and `BymaxFitnessTemplateRenderer`.

Constraints:
- Normalize the recipient (the lib does not). No Prisma in the OTP path. English-only.

Verification:
- Existing verification/reset flows pass against the lib (integration test).

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `3/6`. 4. Update the Phase 6 row.
5. Append `- 6.3 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.4 — Wire the frontend resend to `OTP_COOLDOWN_ACTIVE`

- **Status**: ⬜ Not started
- **Priority**: P1
- **Size**: S
- **Depends on**: 6.3

#### Description

Handle the new cooldown response in the fitness frontend (cooldown did not exist before).

#### Acceptance criteria

- [ ] On `429 OTP_COOLDOWN_ACTIVE`, the FE shows `details.remainingSeconds` and disables resend until it elapses (may use `useOtpCountdown`/`formatCooldown` from `@bymax-one/nest-notification/react`)
- [ ] The verification screen uses `useOtpInput` for code entry

#### Files to create / modify

- (fitness frontend) the verification screen + resend handler

#### Agent prompt

````
You are a senior React engineer working on the bymax-fitness-ai frontend (the consumer).

PROJECT: bymax-fitness-ai — adopting @bymax-one/nest-notification. The resend cooldown is NEW; the FE
must handle `OTP_COOLDOWN_ACTIVE`.

CURRENT PHASE: 6 (Adoption) — Task 6.4 of 6

PRECONDITIONS
- Task 6.3 done: backend delegates to the lib (cooldown active).

REQUIRED READING (only these):
- nest-notification `docs/technical_specification.md` §16 (react hooks) + §17.3 (frontend flow).

TASK
Wire the verification screen + resend to the cooldown.

DELIVERABLES
1. Verification screen uses `useOtpInput`; resend handler reads `OTP_COOLDOWN_ACTIVE` `details.remainingSeconds`,
   shows a countdown (`useOtpCountdown`/`formatCooldown`), disables resend until it elapses.

Constraints:
- English-only code/comments.

Verification:
- Manual check: resend within the window is blocked with a countdown; after it, resend works.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `4/6`. 4. Update the Phase 6 row.
5. Append `- 6.4 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.5 — Remove `_commons_/notification/` + E2E smoke

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: M
- **Depends on**: 6.3, 6.4

#### Description

Prove the full flow end-to-end against the lib, then delete the legacy module and its imports.

#### Acceptance criteria

- [ ] E2E: registration → email-verification OTP; password-reset OTP; resend-cooldown rejection — all green
- [ ] `_commons_/notification/` removed; no remaining imports of it; no `@prisma/client` import runs through the lib

#### Files to create / modify

- (fitness) E2E specs; delete `_commons_/notification/`

#### Agent prompt

````
You are a senior NestJS engineer working on the bymax-fitness-ai project (the consumer).

PROJECT: bymax-fitness-ai — finishing the adoption: prove end-to-end, then delete the legacy module.

CURRENT PHASE: 6 (Adoption) — Task 6.5 of 6

PRECONDITIONS
- Tasks 6.3–6.4 done.

REQUIRED READING (only these):
- nest-notification `docs/technical_specification.md` §17 (integrated flow).

TASK
Write the E2E smoke; remove `_commons_/notification/` once green.

DELIVERABLES
1. E2E: register → verify OTP; password-reset OTP; resend within cooldown → 429.
2. Delete `_commons_/notification/` and update all imports to `@bymax-one/nest-notification`.

Constraints:
- Delete ONLY after E2E is green. English-only.

Verification:
- `pnpm test:e2e` (fitness) green; `grep -r "_commons_/notification" src/` empty.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `5/6`. 4. Update the Phase 6 row.
5. Append `- 6.5 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 6.6 — Phase 6 validation

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: S
- **Depends on**: 6.5

#### Description

Confirm fitness builds + its notification E2E passes against the lib; feed any gaps back into the lib before Phase 7.

#### Acceptance criteria

- [ ] Fitness builds and its notification E2E passes against `@bymax-one/nest-notification`
- [ ] All 6 templates render correctly (manual check); audit rows land in the fitness DB
- [ ] Any lib gap discovered is fixed in the lib spec/plan/code first
- [ ] PR (fitness repo) reviewed and merged

#### Files to create / modify

- (validation only)

#### Agent prompt

````
You are a senior NestJS engineer working on the bymax-fitness-ai project (the consumer).

PROJECT: bymax-fitness-ai — adoption validation gate before the lib's v0.1 release.

CURRENT PHASE: 6 (Adoption) — Task 6.6 of 6 (LAST)

PRECONDITIONS
- Tasks 6.1–6.5 done.

REQUIRED READING (only these):
- nest-notification `docs/technical_specification.md` §1.8 (parity map — confirm full coverage).

TASK
Validate the adoption end-to-end; record any lib gaps.

DELIVERABLES
- Fitness build + notification E2E green; manual template check; audit rows verified; gaps (if any) fed
  back into the lib.

Verification:
- Fitness `pnpm build` + `pnpm test:e2e` green.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `6/6`. 4. Mark the Phase 6 row ✅ in
nest-notification `docs/development_plan.md`. 5. Append `- 6.6 ✅ <YYYY-MM-DD> — <summary>`.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.
