# Phase 3 — Templating + Rate Limiting

> **Status**: ✅ Done · **Progress**: 8 / 8 tasks · **Last updated**: 2026-06-20
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 4 (Phase 3)
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md)

---

## Context

Refine the `DefaultTemplateRenderer` (robust i18n fallback chain, nested paths, missing-variable modes, **escape only the html body**, construction-time validation), expose the cooldown UX helpers, surface `details.retryAfter`/`expiresAt` on `OTP_COOLDOWN_ACTIVE`, and document the canonical template names (matching the set a typical consumer ships). The atomic cooldown primitives already exist from Phase 2 — this phase tests their edges and exposes them to consumers building `Retry-After` headers and countdown UIs.

---

## Rules-of-phase

1. **Escape the html body only.** Interpolated variables are HTML-escaped in `html`, never in `subject`/`text` (those aren't HTML contexts) and never the author's static markup.
2. **No template engine bundled.** `{{var}}` interpolation only — no `{{#if}}`/`{{#each}}`/partials. Consumers plug Handlebars/MJML/React Email via `IEmailTemplateRenderer` (documented, not implemented).
3. **Canonical template names match reality.** The convention list includes `otp_code`, `otp_password_reset`, `otp_resent`, `welcome`, `password_reset_success`, `trial_expiring`, `trial_expired`, plus `new_login_alert`/`mfa_*`.
4. **100% coverage** on the renderer and the cooldown helpers. English-only, timeless comments, fn ≤ 50 / file ≤ 800.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — §5.5 (renderer + adapters), §8 (rate limiting), §9 (templating + canonical names).
- [`docs/development_plan.md`](../development_plan.md) — §4.1–§4.8.

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 3.1 | `DefaultTemplateRenderer` refinement (fallback chain, nested paths, missing-var modes, html-only escape) | ✅ | P0 | M | 1.6 |
| 3.2 | Template adapter docs (Handlebars / React Email / MJML) in `docs/templates/` | ✅ | P2 | S | — |
| 3.3 | Cooldown helpers (`toRetryAfterHeader`, `cooldownExpiresAt`, `formatCooldown`) | ✅ | P1 | S | — |
| 3.4 | `OtpService` cooldown details (`retryAfter`, `expiresAt` on `OTP_COOLDOWN_ACTIVE`) | ✅ | P1 | S | 2.5, 3.3 |
| 3.5 | Barrel exports (cooldown helpers + renderer types) | ✅ | P1 | S | 3.1, 3.3 |
| 3.6 | `CANONICAL_EMAIL_TEMPLATES` naming convention | ✅ | P1 | S | — |
| 3.7 | Tests for Phase 3 (renderer extensions + cooldown helpers) | ✅ | P0 | M | 3.1, 3.3, 3.4 |
| 3.8 | Phase 3 validation + close | ✅ | P0 | S | 3.7 |

---

## Tasks

### Task 3.1 — `DefaultTemplateRenderer` refinement

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.6

#### Description

Upgrade the minimal renderer: configurable `fallbackLocales`, `onMissingVar` (`empty`/`throw`), opt-in `enableNestedPaths`, construction-time template validation — and keep HTML escaping to the html body only.

#### Acceptance criteria

- [x] Construction validates every registered template (invalid shape throws on construction)
- [x] Fallback chain `[locale, ...fallbackLocales]`; `fallbackLocales:['pt','en']` for `pt-BR` → `['pt-BR','pt','en']`
- [x] `onMissingVar:'empty'` → `''`; `'throw'` → error with the variable name
- [x] `enableNestedPaths:true` resolves `{{user.name}}`; default treats it as a flat key
- [x] Escape applies to interpolated values **in the html body only** (subject/text raw; author markup untouched); `text`-only templates supported
- [x] Coverage 100%

#### Files to create / modify

- `src/server/providers/default-template-renderer.ts`

#### Agent prompt

````
You are a senior NestJS/TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. The default renderer is a
safe `{{var}}` interpolator; anything richer is a pluggable `IEmailTemplateRenderer`.

CURRENT PHASE: 3 (Templating + Rate Limiting) — Task 3.1 of 8

PRECONDITIONS
- Task 1.6 done: the minimal renderer.

REQUIRED READING (only these):
- `docs/technical_specification.md` §5.5.1 (DefaultTemplateRenderer — `fill(str, escape)`).
- `docs/development_plan.md` §4.1.

TASK
Refine `DefaultTemplateRenderer` with the fallback chain, nested paths, missing-var modes, and
construction validation — keeping html-only escaping.

DELIVERABLES
1. `default-template-renderer.ts` (overwrite) — `DefaultTemplateRendererOptions { templates?, fallbackLocales?
   (=['en']), onMissingVar? (='empty'), enableNestedPaths? (=false) }`; constructor validates shapes; `render`
   resolves via the chain, `fill(str, escape)` (escape only html), `enableNestedPaths` path resolution.

Constraints:
- No conditionals/loops/partials (document the limitation). Escape html body only. English-only.

Verification:
- `pnpm test src/server/providers/default-template-renderer.spec.ts` at 100% (incl. escape-scope test).

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `1/8`. 4. Update Phase 3 row in the plan.
5. Append `- 3.1 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 3.2 — Template adapter docs

- **Status**: ✅ Done
- **Priority**: P2
- **Size**: S
- **Depends on**: —

#### Description

Add reference adapter examples (Handlebars, React Email, MJML) under `docs/templates/` — documentation only, not implemented in the lib.

#### Acceptance criteria

- [x] `docs/templates/{handlebars,react-email,mjml}-renderer.example.md` created
- [x] Each: setup (`pnpm add`), full `IEmailTemplateRenderer` adapter, engine-specific security caveats (e.g. Handlebars `{{var}}` vs `{{{var}}}`), module registration snippet

#### Files to create / modify

- `docs/templates/handlebars-renderer.example.md`, `docs/templates/react-email-renderer.example.md`, `docs/templates/mjml-renderer.example.md`

#### Agent prompt

````
You are a senior NestJS/TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Templates are the consumer's
responsibility; the lib documents adapter examples but ships none.

CURRENT PHASE: 3 (Templating + Rate Limiting) — Task 3.2 of 8

REQUIRED READING (only these):
- `docs/technical_specification.md` §5.5.2/§5.5.3 (Handlebars / React Email adapters).
- `docs/development_plan.md` §4.2.

TASK
Write the three adapter example docs.

DELIVERABLES
1. Three `*.example.md` files (Handlebars, React Email, MJML): disclaimer ("reference only"), setup,
   full adapter class, security caveats, registration snippet.

Constraints:
- Examples must be valid TypeScript (not CI-tested). English-only.

Verification:
- Files exist; each contains setup + code + caveats + registration.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `2/8`. 4. Update Phase 3 row.
5. Append `- 3.2 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 3.3 — Cooldown helpers

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: —

#### Description

Implement pure helpers: `toRetryAfterHeader(remainingSeconds)`, `cooldownExpiresAt(remainingSeconds)`, `formatCooldown(remainingSeconds)`.

#### Acceptance criteria

- [x] `toRetryAfterHeader(47.3)='48'`, `(-5)='0'`; `cooldownExpiresAt(60)≈now+60000`, `(0)≈now`; `formatCooldown` → `'0s'`/`'47s'`/`'2m 5s'`/`'1h 2m 5s'`/`'2m'`/`'1h'`
- [x] Coverage 100%; no date library dependency

#### Files to create / modify

- `src/server/utils/cooldown-helpers.ts`

#### Agent prompt

````
You are a senior TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. These helpers let consumers
build `Retry-After` headers and countdown strings without a date library.

CURRENT PHASE: 3 (Templating + Rate Limiting) — Task 3.3 of 8

REQUIRED READING (only these):
- `docs/development_plan.md` §4.3.

TASK
Implement the three cooldown helpers.

DELIVERABLES
1. `cooldown-helpers.ts` — `toRetryAfterHeader` (ceil, clamp ≥0, string), `cooldownExpiresAt` (epoch ms),
   `formatCooldown` (`'1h 2m 5s'`-style, omitting zero parts, `'0s'` floor).

Constraints:
- Pure functions, no deps. English-only, timeless comments.

Verification:
- `pnpm test src/server/utils/cooldown-helpers.spec.ts` at 100%.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `3/8`. 4. Update Phase 3 row.
5. Append `- 3.3 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 3.4 — `OtpService` cooldown details

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 2.5, 3.3

#### Description

Enrich the `OTP_COOLDOWN_ACTIVE` exception with `details.retryAfter` (string) and `details.expiresAt` (number) computed from `getCooldown()`.

#### Acceptance criteria

- [x] `OTP_COOLDOWN_ACTIVE` carries `remainingSeconds`, `retryAfter`, `expiresAt`
- [x] The `max_attempts` branch has no immediate cooldown (entry already deleted by `consumeAttempt`)
- [x] `otp.service.spec.ts` updated to assert `details`

#### Files to create / modify

- `src/server/services/otp.service.ts`

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 3 (Templating + Rate Limiting) — Task 3.4 of 8

PRECONDITIONS
- Tasks 2.5, 3.3 done: OtpService + cooldown helpers.

REQUIRED READING (only these):
- `docs/development_plan.md` §4.4.

TASK
Add `retryAfter`/`expiresAt` to the cooldown exception.

DELIVERABLES
1. In `generate`, when `tryAcquireCooldown` returns false: read `getCooldown`, throw `OTP_COOLDOWN_ACTIVE`
   with `{ remainingSeconds, retryAfter: toRetryAfterHeader(...), expiresAt: cooldownExpiresAt(...) }`.

Constraints:
- English-only, timeless comments.

Verification:
- `pnpm test src/server/services/otp.service.spec.ts` asserts the three `details` fields.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `4/8`. 4. Update Phase 3 row.
5. Append `- 3.4 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 3.5 — Barrel exports

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: 3.1, 3.3

#### Description

Export the cooldown helpers and the refined renderer types from `src/server/index.ts`.

#### Acceptance criteria

- [x] `toRetryAfterHeader`, `cooldownExpiresAt`, `formatCooldown`, `TemplateDefinition`, `DefaultTemplateRendererOptions` exported
- [x] `pnpm build` clean

#### Files to create / modify

- `src/server/index.ts`

#### Agent prompt

````
You are a senior TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 3 (Templating + Rate Limiting) — Task 3.5 of 8

PRECONDITIONS
- Tasks 3.1, 3.3 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §4.5.

TASK
Extend the server barrel.

DELIVERABLES
1. Export the cooldown helpers + `TemplateDefinition`/`DefaultTemplateRendererOptions`.

Verification:
- `pnpm build` + `Object.keys` includes the new symbols.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `5/8`. 4. Update Phase 3 row.
5. Append `- 3.5 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 3.6 — `CANONICAL_EMAIL_TEMPLATES`

- **Status**: ✅ Done
- **Priority**: P1
- **Size**: S
- **Depends on**: —

#### Description

Document the canonical template names (no HTML shipped) — the typical consumer set: `otp_code`, `otp_password_reset`, `otp_resent`, `welcome`, `password_reset_success`, `trial_expiring`, `trial_expired`, `new_login_alert`, `mfa_enabled`/`mfa_disabled`.

#### Acceptance criteria

- [x] `CANONICAL_EMAIL_TEMPLATES` const + `CanonicalEmailTemplate` type, JSDoc per template listing variables (incl. `verificationLink` for the password-reset deep link; `daysLeft`/`durationDays` for trial)
- [x] Exported from the barrel

#### Files to create / modify

- `src/server/constants/canonical-templates.ts`, `src/server/index.ts`

#### Agent prompt

````
You are a senior TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Template names are a typed
convention; the lib ships no HTML.

CURRENT PHASE: 3 (Templating + Rate Limiting) — Task 3.6 of 8

REQUIRED READING (only these):
- `docs/technical_specification.md` §9.2 (canonical template table).
- `docs/development_plan.md` §4.6.

TASK
Add `CANONICAL_EMAIL_TEMPLATES`.

DELIVERABLES
1. `canonical-templates.ts` — `CANONICAL_EMAIL_TEMPLATES` (the full set incl. `otp_password_reset`,
   `trial_expiring`, `trial_expired`) with per-template variable JSDoc; `CanonicalEmailTemplate` type;
   export from the barrel.

Constraints:
- English-only, timeless comments.

Verification:
- `pnpm typecheck`; type infers the literal union.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `6/8`. 4. Update Phase 3 row.
5. Append `- 3.6 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 3.7 — Tests for Phase 3

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 3.1, 3.3, 3.4

#### Description

100% coverage on the refined renderer (fallback chain, nested paths, missing-var modes, escape scope) and the cooldown helpers; assert the new `OTP_COOLDOWN_ACTIVE` details.

#### Acceptance criteria

- [x] `default-template-renderer.ts` + `cooldown-helpers.ts` at 100%; global 100%
- [x] Escape-scope test (html escaped, subject/text raw); cooldown formatting matrix; cooldown-details assertion

#### Files to create / modify

- `src/server/providers/default-template-renderer.spec.ts` (expand), `src/server/utils/cooldown-helpers.spec.ts`, `src/server/services/otp.service.spec.ts` (expand)

#### Agent prompt

````
You are a senior NestJS test engineer working on the nest-notification project. Use /bymax-quality:tdd
or `tester`.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. 100% coverage.

CURRENT PHASE: 3 (Templating + Rate Limiting) — Task 3.7 of 8

PRECONDITIONS
- Tasks 3.1, 3.3, 3.4 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §4.7.

TASK
Write/expand the Phase 3 tests to 100%.

DELIVERABLES
- Renderer extensions (fallback, nested, missing-var modes, escape scope, construction validation),
  cooldown helpers (full matrix), OtpService cooldown details.

Verification:
- `pnpm test:cov` 100% on the two new/updated files + global.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `7/8`. 4. Update Phase 3 row.
5. Append `- 3.7 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 3.8 — Phase 3 validation + close

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: S
- **Depends on**: 3.7

#### Description

Run gates + a renderer/cooldown smoke; close the phase with `/bymax-quality:code-review`.

#### Acceptance criteria

- [x] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size` green
- [x] Smoke: renderer fallback + `formatCooldown`/`toRetryAfterHeader`; adapters documented
- [x] Code-review findings applied

#### Files to create / modify

- (validation only)

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 3 (Templating + Rate Limiting) — Task 3.8 of 8 (LAST)

PRECONDITIONS
- Tasks 3.1–3.7 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §4.8.

TASK
Run the Phase 3 gate + smoke; apply code-review findings.

DELIVERABLES
- Gate green; smoke per §4.8.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `8/8`. 4. Mark the Phase 3 row ✅ in
the plan. 5. Append `- 3.8 ✅ <YYYY-MM-DD> — <summary>`.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 3.1 ✅ 2026-06-20 — Refined `DefaultTemplateRenderer`: fallback-locale chain, opt-in nested paths, `onMissingVar` empty/throw, construction-time validation; html-body-only escaping preserved; 100% coverage.
- 3.3 ✅ 2026-06-20 — Added pure cooldown helpers (`toRetryAfterHeader`, `cooldownExpiresAt`, `formatCooldown`) with no date-library dependency; 100% coverage.
- 3.6 ✅ 2026-06-20 — Added `CANONICAL_EMAIL_TEMPLATES` constant + `CanonicalEmailTemplate` type (no HTML shipped), per-template variable JSDoc; exported from the barrel.
- 3.4 ✅ 2026-06-20 — `OTP_COOLDOWN_ACTIVE` now carries `retryAfter` (via `toRetryAfterHeader`) and `expiresAt` (via `cooldownExpiresAt`) alongside `remainingSeconds`; spec asserts the three details.
- 3.5 ✅ 2026-06-20 — Barrel now exports the cooldown helpers and the refined renderer types (`TemplateDefinition`, `DefaultTemplateRendererOptions`, `MissingVariableMode`); build clean, symbols verified in the bundle.
- 3.2 ✅ 2026-06-20 — Wrote Handlebars / React Email / MJML adapter example docs (verified against handlebars@4, @react-email/render@1, mjml@4) with setup, full adapter, security caveats, and module registration.
- 3.7 ✅ 2026-06-20 — Phase 3 tests consolidated: renderer extensions (fallback/nested/missing-var/escape-scope/construction), cooldown matrix, OTP cooldown-details; full suite 245 tests at 100% line/branch global.
- 3.8 ✅ 2026-06-20 — Phase gates green (typecheck · lint · test:cov 100% · build · check:no-prisma · size); smoke validated renderer fallback/nested/escape-scope + `formatCooldown`/`toRetryAfterHeader`; code-review + security-review at zero findings.
