# Phase 2 — EmailService + OtpService (atomic)

> **Status**: 🔄 In Progress · **Progress**: 6 / 10 tasks · **Last updated**: 2026-06-19
> **Source roadmap**: [`docs/development_plan.md`](../development_plan.md) § 3 (Phase 2)
> **Source spec**: [`docs/technical_specification.md`](../technical_specification.md)

---

## Context

This phase implements the two central services (`EmailService`, `OtpService`), the `NotificationService` orchestrator, and the reference adapters (`ResendEmailProvider`, `RedisOtpStorage`, `InMemoryOtpStorage`). It is the **highest-complexity phase** and the home of the library's core security guarantee: the OTP attempt counter and the resend cooldown are **atomic**.

Verification goes through `storage.consumeAttempt()` — one Redis Lua script (or a single synchronous Map op in-memory) that does lookup → expiry/max check → increment → write indivisibly. Generation claims the cooldown with `storage.tryAcquireCooldown()` (`SET NX EX`) **before** issuing the code and **releases it on delivery failure**. A plain `get`+`update` would race and let `maxAttempts` be bypassed; setting the cooldown after a successful send would (a) race two concurrent resends and (b) lock the user out for 60s when an email bounces.

OTP email delivery is delegated to `EmailService` (which owns the renderer/escape/audit) — `OtpService` injects `EmailService` (optional), never the raw `IEmailProvider`.

---

## Rules-of-phase

1. **Atomic counter, atomic cooldown.** The attempt counter is mutated ONLY inside `storage.consumeAttempt`. The cooldown is acquired ONLY via `storage.tryAcquireCooldown` (`SET NX EX`). The service never does its own `get`+`update` to increment.
2. **Release on failure.** If email delivery fails inside `generate({ deliverVia: 'email' })`, clear the cooldown AND delete the OTP, then rethrow — no lockout, no orphan.
3. **Expired = `not_found`.** `consumeAttempt` reports an expired/missing entry as `not_found`; `OtpVerifyResult` has no `'expired'` reason (spec §11.5).
4. **OTP→email via `EmailService`.** `OtpService` injects `@Optional() EmailService`; `deliverVia:'email'` without it throws `OTP_EMAIL_DELIVERY_NOT_CONFIGURED`. Auto-injected template data: `{ code, expiresInMinutes, purpose }`.
5. **Codes never leave storage.** Never log the code; audit metadata never contains `code`; `getStatus` never returns it. Constant-time compare via `safeCompare`.
6. **Redis correctness.** `consumeAttempt` = Lua by SHA; `update` = `SET … KEEPTTL XX`; `tryAcquireCooldown` = `SET … NX EX`; keys hashed `sha256(tenantId:recipient)`; recipient passed pre-normalized by the caller.
7. **100% coverage** per file; mutation focus (target 100%) on `otp.service.ts` and `redis-otp.storage.ts`. English-only, timeless comments, fn ≤ 50 / file ≤ 800.

---

## Reference docs

- [`docs/technical_specification.md`](../technical_specification.md) — §2.3/§2.4 (OTP send/verify flows), §5.1.1 (ResendProvider), §5.2.1/§5.2.2 (Redis/InMemory storage with the atomic primitives), §6.1 (EmailService), §6.2 (OtpService), §6.5 (NotificationService + DispatchResult), §10 (Redis strategy / Lua), §11 (errors).
- [`docs/development_plan.md`](../development_plan.md) — §3.1–§3.10, Appendix E.
- `/bymax-workflow:standards`, `/bymax-quality:tdd`.

---

## Task index

| ID | Task | Status | Priority | Size | Depends on |
|---|---|---|---|---|---|
| 2.1 | `ResendEmailProvider` — lazy-loaded reference adapter | ✅ | P0 | M | 1.3 |
| 2.2 | `InMemoryOtpStorage` — atomic dev/test storage | ✅ | P0 | M | 1.3 |
| 2.3 | `RedisOtpStorage` — Lua `consumeAttempt` + NX cooldown (production) | ✅ | P0 | L | 1.3, 1.7 |
| 2.4 | `EmailService` — send + sendTemplate + attachment guard + audit (mask) | ✅ | P0 | M | 1.4, 1.5 |
| 2.5 | `OtpService` — generate/verify/consume/resend/getStatus (atomic) | ✅ | P0 | L | 2.3, 2.4 |
| 2.6 | `NotificationService` — channel-agnostic dispatch (discriminated) | ✅ | P0 | M | 2.4, 2.5 |
| 2.7 | Module wiring — register services conditionally | ⬜ | P0 | S | 2.4, 2.5, 2.6 |
| 2.8 | Phase 2 barrel exports | ⬜ | P1 | S | 2.1–2.7 |
| 2.9 | Tests for Phase 2 (100% + atomic concurrency regressions) | ⬜ | P0 | L | 2.1–2.8 |
| 2.10 | Phase 2 validation + smoke | ⬜ | P0 | S | 2.9 |

---

## Tasks

### Task 2.1 — `ResendEmailProvider` (lazy-loaded reference adapter)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.3

#### Description

Implement the Resend adapter for `IEmailProvider`, lazy-loading the `resend` SDK so consumers who use another provider don't need it installed.

#### Acceptance criteria

- [x] `isConfigured()` false without `apiKey`; `send()` without `apiKey` throws "Missing API key"
- [x] `send()` lazy-`import('resend')`; if missing throws a "package not installed — run `pnpm add resend`" message
- [x] Builds `from` as `'Name <email>'` when `fromName` provided; returns `{ messageId }`; throws "Resend returned no message ID" when absent
- [x] NEVER logs `html`/`text`; propagates SDK errors as `Error` (mapped to `NotificationException` in EmailService)
- [x] Coverage 100% (lazy import mocked, incl. the not-installed path)

#### Files to create / modify

- `src/server/providers/resend-email.provider.ts`

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Providers are reference adapters
behind `IEmailProvider`; the `resend` SDK is an optional peer dep loaded lazily.

CURRENT PHASE: 2 (Services) — Task 2.1 of 10

PRECONDITIONS
- Task 1.3 done: `IEmailProvider`/`EmailSendOptions`/`EmailSendResult`.

REQUIRED READING (only these):
- `docs/technical_specification.md` §5.1.1 (ResendProvider pattern).
- `docs/development_plan.md` §3.1.

TASK
Implement `ResendEmailProvider` with a lazy `import('resend')`.

DELIVERABLES
1. `resend-email.provider.ts` — `ResendEmailProviderOptions { apiKey? }`; `name='resend'`; `isConfigured`
   = `Boolean(apiKey)`; `send()` lazy-loads `resend`, builds `from`, calls `client.emails.send`, maps
   `result.error`→Error (no body in the message), returns `{ messageId: result.data.id }`. Local
   `ResendLike` forward-declared type (no compile-time `resend` import).

Constraints:
- Never log `html`/`text`. No `any`. English-only, timeless comments.

Verification:
- `pnpm test src/server/providers/resend-email.provider.spec.ts` (mock `resend`; test missing-apiKey,
  missing-package, from-formatting, error propagation) at 100%.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `1/10`. 4. Update Phase 2 row in the
plan. 5. Append `- 2.1 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 2.2 — `InMemoryOtpStorage` (atomic dev/test storage)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.3

#### Description

Implement `IOtpStorage` over two `Map`s — atomic by construction (no `await` between read and write). Includes `consumeAttempt`, `tryAcquireCooldown`, `clearCooldown`, self-evicting `get`, and `clear()`/`size()` test helpers.

#### Acceptance criteria

- [x] `consumeAttempt` returns `not_found` (missing/expired, deleting expired), `max_attempts` (deletes at limit), or `ok` with `attempts` incremented by exactly 1
- [x] `tryAcquireCooldown` true first then false while active; `getCooldown` remaining secs; `clearCooldown` resets
- [x] `update` no-op for a missing key; `delete` idempotent; `get` self-evicts past `expiresAt`; tuples never collide
- [x] `clear()`/`size()` helpers are NOT part of `IOtpStorage`
- [x] Coverage 100%

#### Files to create / modify

- `src/server/providers/in-memory-otp.storage.ts`

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. `InMemoryOtpStorage` is the
dev/test backend; atomic by virtue of the single-threaded event loop.

CURRENT PHASE: 2 (Services) — Task 2.2 of 10

PRECONDITIONS
- Task 1.3 done: `IOtpStorage` (atomic contract).

REQUIRED READING (only these):
- `docs/technical_specification.md` §5.2.2 (InMemory impl with consumeAttempt/tryAcquireCooldown/clearCooldown).
- `docs/development_plan.md` §3.2.

TASK
Implement `InMemoryOtpStorage`.

DELIVERABLES
1. `in-memory-otp.storage.ts` — two Maps (`store`, `cooldowns`); key `${tenantId}::${recipient}::${purpose}`;
   `set`, `get` (self-evict), `consumeAttempt` (read→checks→increment→set, no await between → atomic),
   `update` (no-op if absent), `delete` (idempotent), `tryAcquireCooldown` (set if not active), `getCooldown`,
   `clearCooldown`; `clear()`/`size()` test helpers (not in the interface).

Constraints:
- No `await` between the read and the write inside `consumeAttempt`. English-only, timeless comments.

Verification:
- `pnpm test src/server/providers/in-memory-otp.storage.spec.ts` at 100% (incl. boundary cases).

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `2/10`. 4. Update Phase 2 row.
5. Append `- 2.2 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 2.3 — `RedisOtpStorage` (production)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 1.3, 1.7

#### Description

Implement `IOtpStorage` over Redis with sha256 key hashing and the atomic primitives: `consumeAttempt` as a single Lua script (`EVALSHA`), `tryAcquireCooldown` as `SET NX EX`, `update` as `SET … KEEPTTL XX`, `clearCooldown` as `DEL`. `RedisLike` is forward-declared (incl. `eval`/`pttl`).

#### Acceptance criteria

- [x] Keys `{namespace}:otp:{purpose}:{sha256(tenantId:recipient)}` / `…:otp_cd:…` — never contain plaintext recipient/tenantId; different tenants → different keys
- [x] `consumeAttempt` Lua: GET → expiry/max check → INCR → `SET … PX {PTTL}`; returns `not_found`/`max_attempts`/`ok`; two interleaved calls never exceed `maxAttempts`
- [x] `update` uses `SET … KEEPTTL XX` (no resurrection, preserves TTL); `tryAcquireCooldown` uses `SET … NX EX` (true then false); `getCooldown` 0 when absent; `clearCooldown` deletes
- [x] `get` returns parsed entry / deletes corrupted JSON; `RedisLike` declares `eval`/`pttl`
- [x] Coverage 100% (hand-rolled faithful Redis double whose `eval` replicates the Lua atomically)

#### Files to create / modify

- `src/server/providers/redis-otp.storage.ts`

#### Agent prompt

````
You are a senior NestJS/Redis engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. `RedisOtpStorage` is the
default production OTP backend; correctness of the atomic Lua + key hashing is the security crux.

CURRENT PHASE: 2 (Services) — Task 2.3 of 10 (HARDEST storage)

PRECONDITIONS
- Tasks 1.3, 1.7 done: `IOtpStorage`, `hashTenantRecipient`.

REQUIRED READING (only these):
- `docs/technical_specification.md` §5.2.1 (Redis impl incl. the CONSUME_ATTEMPT_LUA, KEEPTTL update,
  NX cooldown) + §10.3/§10.4 (key table + ops).
- `docs/development_plan.md` §3.3, Appendix E.

TASK
Implement `RedisOtpStorage` with the atomic Lua + NX cooldown.

DELIVERABLES
1. `redis-otp.storage.ts` — `RedisLike` (get/set/setex/del/ttl/pttl/eval), `RedisOtpStorageOptions
   { redisClient; namespace? }`; sha256-hashed `otpKey`/`cooldownKey`; `set` (SETEX); `consumeAttempt`
   (`EVALSHA` of the Lua: GET→expiry/max→INCR→`SET … PX {PTTL}`, returns JSON status); `update`
   (`SET … KEEPTTL XX`); `delete`; `tryAcquireCooldown` (`SET '1' NX EX`→`res==='OK'`); `getCooldown`;
   `clearCooldown` (DEL). The Lua is a `private static readonly` string.

Constraints:
- Multi-step transition = single Lua. Keys carry only hashes. No `any`. English-only, timeless comments.

Verification:
- `pnpm test src/server/providers/redis-otp.storage.spec.ts` (ioredis-mock) at 100%, incl. a test that
  two interleaved `consumeAttempt` calls never exceed `maxAttempts`, and key-has-no-PII assertions.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `3/10`. 4. Update Phase 2 row.
5. Append `- 2.3 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 2.4 — `EmailService`

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 1.4, 1.5

#### Description

Implement `send()` (raw body) and `sendTemplate()` (delegates to the renderer), with default application, the `maxAttachmentBytes` guard, fire-and-forget audit (applying `maskRecipient`), and `isConfigured()`.

#### Acceptance criteria

- [x] `send` returns `messageId`; throws `EMAIL_PROVIDER_NOT_CONFIGURED` (no provider), `EMAIL_SEND_FAILED` (provider throws), `EMAIL_ATTACHMENTS_TOO_LARGE` (sum > `maxAttachmentBytes`)
- [x] applies `defaultFrom/defaultFromName/defaultReplyTo`; concatenates `defaultTags`+caller tags
- [x] `sendTemplate` → `hasTemplate(template, locale)` + `en` fallback → `TEMPLATE_NOT_FOUND`/`TEMPLATE_RENDER_FAILED`; appends `{name:'template',value}`
- [x] audit on success + failure; `recipient` passes through `maskRecipient`; never propagates audit error when `swallowErrors:true`; propagates `AUDIT_LOG_FAILED` when false; never logs body
- [x] Coverage 100%

#### Files to create / modify

- `src/server/services/email.service.ts`

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. `EmailService` wraps
`IEmailProvider` adding defaults, attachment-size enforcement, optional template rendering (the
renderer escapes the html body), and fire-and-forget audit.

CURRENT PHASE: 2 (Services) — Task 2.4 of 10

PRECONDITIONS
- Tasks 1.4–1.5 done: errors + resolved options. Renderer/log injected by token.

REQUIRED READING (only these):
- `docs/technical_specification.md` §6.1 (EmailService) + §2.5 (transactional flow).
- `docs/development_plan.md` §3.4.

TASK
Implement `EmailService`.

DELIVERABLES
1. `email.service.ts` — inject `BYMAX_NOTIFICATION_OPTIONS`, `…_EMAIL_PROVIDER`, `…_TEMPLATE_RENDERER`,
   `…_LOG_REPOSITORY`. `send(input)`: configured-check; attachment-byte guard → `EMAIL_ATTACHMENTS_TOO_LARGE`;
   apply defaults + concat tags; provider.send → audit `sent` → return `{messageId}`; on throw → audit
   `failed` + `EMAIL_SEND_FAILED` (no provider message to caller). `sendTemplate(input)`: locale resolve +
   `en` fallback → render → forward to `send`. private `audit(entry)` applies `maskRecipient` and swallows
   per `swallowErrors`.

Constraints:
- Never log/audit the body. English-only, timeless comments.

Verification:
- `pnpm test src/server/services/email.service.spec.ts` at 100% (mock provider/renderer/log).

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `4/10`. 4. Update Phase 2 row.
5. Append `- 2.4 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 2.5 — `OtpService` (atomic)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: L
- **Depends on**: 2.3, 2.4

#### Description

Implement `generate`/`verify`/`consume`/`resend`/`getStatus` per the atomic flows: NX-acquire-first generate with release-on-failure and `EmailService` delegation, `consumeAttempt`+`safeCompare` verify, consume clearing the cooldown.

#### Acceptance criteria

- [x] `generate`: `tryAcquireCooldown` BEFORE persisting → false → `OTP_COOLDOWN_ACTIVE` (with `remainingSeconds`); persist `attempts:0`; `deliverVia:'email'` → `EmailService.sendTemplate` with `{code, expiresInMinutes, purpose, …emailData}`; no EmailService → `OTP_EMAIL_DELIVERY_NOT_CONFIGURED`; send failure → clear cooldown + delete OTP, rethrow; `manual` keeps cooldown; returns `{expiresAt, cooldownSeconds}`
- [x] `verify`: `consumeAttempt` (atomic) → `not_found`/`max_attempts`; `safeCompare` → `invalid_code` with `remainingAttempts`; success → `validated:true` (or delete+clearCooldown if `consumeOnVerify`)
- [x] `consume`: delete + clearCooldown (idempotent); `resend` aliases `generate`; `getStatus` returns truncated entry (no `code`)
- [x] config via `options.otp.resolveForPurpose`; audit on every op; `code` never in audit metadata
- [x] Coverage 100%; interleaved consumeAttempt never exceeds `maxAttempts` (storage regression)

#### Files to create / modify

- `src/server/services/otp.service.ts`

#### Agent prompt

````
You are a senior NestJS security engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. `OtpService` is the security
core: atomic attempt counting and an atomic cooldown lock with release-on-failure.

CURRENT PHASE: 2 (Services) — Task 2.5 of 10 (HARDEST)

PRECONDITIONS
- Tasks 2.3–2.4 done: storages + EmailService. `safeCompare`/`generateOtpCode` available.

REQUIRED READING (only these):
- `docs/technical_specification.md` §2.3/§2.4 (generate/verify flows) + §6.2 (OtpService).
- `docs/development_plan.md` §3.5, §4.4 (cooldown details).

TASK
Implement `OtpService` per the atomic flows.

DELIVERABLES
1. `otp.service.ts` — inject `BYMAX_NOTIFICATION_OPTIONS`, `…_OTP_STORAGE`, `…_LOG_REPOSITORY`,
   `@Optional() EmailService`. `generate` (tryAcquireCooldown→generate→set→deliver→release-on-failure),
   `verify` (consumeAttempt→safeCompare→validated/consume), `consume` (delete+clearCooldown),
   `resend` (alias), `getStatus` (no code). Use `options.otp.resolveForPurpose(purpose)`. `OTP_COOLDOWN_ACTIVE`
   carries `remainingSeconds`/`retryAfter`/`expiresAt`.

Constraints:
- The attempt counter is mutated ONLY by `consumeAttempt`. Never log/audit the `code`. English-only.

Verification:
- `pnpm test src/server/services/otp.service.spec.ts` at 100%, incl. the OTP_EMAIL_DELIVERY_NOT_CONFIGURED
  path, send-failure cooldown release, consume-clears-cooldown, and an interleaved-verify max-attempts test.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `5/10`. 4. Update Phase 2 row.
5. Append `- 2.5 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 2.6 — `NotificationService` (channel-agnostic dispatch)

- **Status**: ✅ Done
- **Priority**: P0
- **Size**: M
- **Depends on**: 2.4, 2.5

#### Description

Implement the orchestrator: `dispatch(input)` with a channel-discriminated `DispatchResult`, `getEnabledChannels()`, and throwing `getEmail()`/`getOtp()`.

#### Acceptance criteria

- [x] `dispatch({channel:'email'})` routes to `sendTemplate` (template) or `send` (subject+html), else `EMAIL_INVALID_RECIPIENT`; returns `{channel:'email', messageId}`
- [x] `dispatch({channel:'otp'})` routes by `payload.action` (generate/verify/consume); returns `{channel:'otp', result}`
- [x] `CHANNEL_DISABLED` when the channel's service is absent; `getEnabledChannels()` lists configured channels
- [x] `DispatchResult` is the channel-discriminated union (matches spec §6.5)
- [x] Coverage 100%

#### Files to create / modify

- `src/server/services/notification.service.ts`

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. `NotificationService` is a
uniform façade over the channel services using `@Optional()` injection.

CURRENT PHASE: 2 (Services) — Task 2.6 of 10

PRECONDITIONS
- Tasks 2.4–2.5 done: EmailService + OtpService.

REQUIRED READING (only these):
- `docs/technical_specification.md` §6.5 (NotificationService, DispatchInput/Result, payloads).
- `docs/development_plan.md` §3.6.

TASK
Implement `NotificationService`.

DELIVERABLES
1. `notification.service.ts` — `DispatchInput`/`DispatchResult` (channel-discriminated), `EmailDispatchPayload`,
   `OtpDispatchPayload` (with `action?`/`code?`), `dispatch` (email → sendTemplate/send; otp → generate/
   verify/consume by `action`), `getEnabledChannels`, throwing `getEmail`/`getOtp` (`CHANNEL_DISABLED`).

Constraints:
- `@Optional()` for unconfigured channels. English-only, timeless comments.

Verification:
- `pnpm test src/server/services/notification.service.spec.ts` at 100%.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `6/10`. 4. Update Phase 2 row.
5. Append `- 2.6 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 2.7 — Module wiring

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: S
- **Depends on**: 2.4, 2.5, 2.6

#### Description

Update `forRoot()` to register `EmailService` (if email), `OtpService` (if otp), and always `NotificationService`; export all.

#### Acceptance criteria

- [ ] `EmailService`/`OtpService` registered only when their channel is configured; `NotificationService` always; all exported
- [ ] Smoke: an email-only consumer can `app.get(EmailService)`; `app.get(OtpService)` throws

#### Files to create / modify

- `src/server/bymax-notification.module.ts`

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 2 (Services) — Task 2.7 of 10

PRECONDITIONS
- Tasks 2.4–2.6 done. The Phase-1 `forRoot` left a timeless TODO where services register.

REQUIRED READING (only these):
- `docs/development_plan.md` §3.7.

TASK
Wire the services into `forRoot` (conditional) and export them.

DELIVERABLES
1. Update `forRoot`: `if (resolved.email) providers.push(EmailService)`; `if (resolved.otp)
   providers.push(OtpService)`; always `providers.push(NotificationService)`; export all provider tokens
   + service classes.

Constraints:
- English-only, timeless comments.

Verification:
- `pnpm test src/server/bymax-notification.module.spec.ts` — email-only fixture resolves EmailService;
  OtpService unavailable.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `7/10`. 4. Update Phase 2 row.
5. Append `- 2.7 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 2.8 — Phase 2 barrel exports

- **Status**: ⬜ Not started
- **Priority**: P1
- **Size**: S
- **Depends on**: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7

#### Description

Add to `src/server/index.ts`: services + dispatch types, reference providers (`ResendEmailProvider`, `InMemoryOtpStorage`, `RedisOtpStorage` + `RedisLike`/options), and the public utils (`hashTenantRecipient`, `generateOtpCode`, `safeCompare`).

#### Acceptance criteria

- [ ] `EmailService`, `OtpService`, `NotificationService` + dispatch types exported; reference providers + storage types exported; utils exported
- [ ] `pnpm build` emits all 3 subpaths; `Object.keys` lists the expected set

#### Files to create / modify

- `src/server/index.ts`

#### Agent prompt

````
You are a senior TypeScript engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 2 (Services) — Task 2.8 of 10

PRECONDITIONS
- Tasks 2.1–2.7 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §3.8.

TASK
Extend the server barrel with the Phase 2 public symbols.

DELIVERABLES
1. Export services + `DispatchInput`/`DispatchResult`/payload types; `ResendEmailProvider`(+options),
   `InMemoryOtpStorage`, `RedisOtpStorage`(+`RedisOtpStorageOptions`/`RedisLike`); `hashTenantRecipient`,
   `generateOtpCode`, `safeCompare`.

Constraints:
- English-only, timeless comments.

Verification:
- `pnpm build` + `node -e "import('./dist/server/index.mjs').then(m=>console.log(Object.keys(m).sort()))"`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `8/10`. 4. Update Phase 2 row.
5. Append `- 2.8 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 2.9 — Tests for Phase 2

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: L
- **Depends on**: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8

#### Description

100% coverage on all services/providers, including the atomic concurrency regressions (interleaved `consumeAttempt`/`verify`), the never-log-code security gate, and the OTP→email delivery paths.

#### Acceptance criteria

- [ ] `pnpm test:cov` = 100% global + per file (email/otp/notification services, resend provider, redis/in-memory storage)
- [ ] OtpService: cooldown-active, NX-before-persist, OTP_EMAIL_DELIVERY_NOT_CONFIGURED, send-failure release, consume-clears-cooldown, expired→not_found, interleaved max-attempts, never-log-code
- [ ] RedisOtpStorage: KEEPTTL/NX/eval arg-order, no-PII keys, interleaved consumeAttempt
- [ ] Mutation (target 100%) on `otp.service.ts` + `redis-otp.storage.ts`

#### Files to create / modify

- `src/server/services/*.spec.ts`, `src/server/providers/{resend-email.provider,in-memory-otp.storage,redis-otp.storage}.spec.ts`

#### Agent prompt

````
You are a senior NestJS test engineer working on the nest-notification project. Use /bymax-quality:tdd
or `tester`.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib. Bymax standard: 100% coverage;
mutation target 100% on the OTP service + Redis storage.

CURRENT PHASE: 2 (Services) — Task 2.9 of 10

PRECONDITIONS
- Tasks 2.1–2.8 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §3.9 (per-file test-case lists).

TASK
Write Phase 2 tests to 100% coverage with the atomic regressions.

DELIVERABLES
- email.service.spec (defaults, attachment guard, audit mask, swallow/propagate, template fallback),
  otp.service.spec (all atomic cases above), notification.service.spec (dispatch routing), 
  resend-email.provider.spec (lazy SDK mocked), in-memory-otp.storage.spec, redis-otp.storage.spec
  (ioredis-mock; KEEPTTL/NX/eval; no-PII; interleaved consumeAttempt).

Constraints:
- `InMemoryOtpStorage` used directly in OtpService tests; mock `EmailService`/log. English-only.

Verification:
- `pnpm test:cov` 100%; `JSON.stringify(auditEntry).includes(realCode) === false` gate passes.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `9/10`. 4. Update Phase 2 row.
5. Append `- 2.9 ✅ <YYYY-MM-DD> — <summary>`.
````

---

### Task 2.10 — Phase 2 validation + smoke

- **Status**: ⬜ Not started
- **Priority**: P0
- **Size**: S
- **Depends on**: 2.9

#### Description

Run gates and a fixture smoke test exercising `email.send` + `otp.generate(deliverVia:'email')` + `otp.getStatus` end-to-end.

#### Acceptance criteria

- [ ] `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size && pnpm check:no-prisma` green
- [ ] Smoke (NoOp email + DefaultTemplateRenderer + InMemory storage) shows send + generate + getStatus working
- [ ] `/bymax-quality:code-review` findings applied

#### Files to create / modify

- (validation only)

#### Agent prompt

````
You are a senior NestJS engineer working on the nest-notification project.

PROJECT: @bymax-one/nest-notification — public NestJS notification lib.

CURRENT PHASE: 2 (Services) — Task 2.10 of 10 (LAST)

PRECONDITIONS
- Tasks 2.1–2.9 done.

REQUIRED READING (only these):
- `docs/development_plan.md` §3.10.

TASK
Run the Phase 2 gate + the end-to-end smoke.

DELIVERABLES
- All gate commands green; the fixture smoke (send + generate + getStatus).

Constraints:
- Run `/bymax-quality:code-review`; apply findings. English-only.

Verification:
- `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build && pnpm size && pnpm check:no-prisma`.

Completion Protocol:
1. Status ✅ (block + index). 2. Tick AC. 3. Index row + progress `10/10`. 4. Mark the Phase 2 row ✅
in `docs/development_plan.md`. 5. Append `- 2.10 ✅ <YYYY-MM-DD> — <summary>`.
````

---

## Completion log

> Append-only. One line per completed task: `- <task-id> ✅ YYYY-MM-DD — <one-line summary>`.

- 2.1 ✅ 2026-06-19 — ResendEmailProvider with lazy `import('resend')`, from-header formatting, body-safe error logging; 100% coverage incl. not-installed path.
- 2.2 ✅ 2026-06-19 — InMemoryOtpStorage over two Maps, atomic consumeAttempt, self-evicting get/cooldown, clear()/size() helpers; 100% coverage.
- 2.3 ✅ 2026-06-19 — RedisOtpStorage with sha256 PII-free keys, atomic Lua consumeAttempt, SET NX EX cooldown, KEEPTTL XX update; 100% coverage + interleaving regression.
- 2.4 ✅ 2026-06-19 — EmailService send/sendTemplate with defaults, attachment guard, en fallback, masked fire-and-forget audit; body never logged; 100% coverage.
- 2.5 ✅ 2026-06-19 — OtpService generate/verify/consume/resend/getStatus; NX-first cooldown with release-on-failure, atomic consumeAttempt + safeCompare, code never logged/audited; 100% coverage.
- 2.6 ✅ 2026-06-19 — NotificationService channel-discriminated dispatch (email send/sendTemplate, otp generate/verify/consume), getEnabledChannels + throwing getEmail/getOtp; 100% coverage.
