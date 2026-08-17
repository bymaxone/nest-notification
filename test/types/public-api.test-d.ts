/**
 * @fileoverview Compile-time type tests for the public API of `@bymax-one/nest-notification`.
 * @layer test
 *
 * The published contracts are part of the product: a consumer writing an
 * `IOtpStorage` or narrowing an `OtpVerifyResult` depends on these shapes being
 * exactly what the documentation promises. These assertions lock the discriminated
 * unions, the storage primitives that must stay atomic, and the hook state objects,
 * so a refactor that silently widens or loosens a signature fails `pnpm test:types`
 * (`tsc`). There is no runtime here — everything is checked by the compiler.
 */
import type { DynamicModule } from '@nestjs/common'

import type {
  IOtpStorage,
  IEmailProvider,
  IEmailTemplateRenderer,
  INotificationLogRepository,
  OtpVerifyResult,
  ConsumeAttemptResult,
  OtpGenerateResult,
  OtpService,
  EmailService,
  NotificationLogEntry,
  BymaxNotificationModuleOptions,
  SmtpEmailProviderOptions
} from '@bymax-one/nest-notification'
import {
  BymaxNotificationModule,
  SmtpEmailProvider,
  hashTenantRecipient,
  safeCompare,
  toRetryAfterHeader
} from '@bymax-one/nest-notification'
import type { NotificationErrorCode, OtpPurpose } from '@bymax-one/nest-notification/shared'
import { NOTIFICATION_ERROR_CODES } from '@bymax-one/nest-notification/shared'
import type { UseOtpInputState, UseOtpCountdownState } from '@bymax-one/nest-notification/react'
import type { OtpStorageContractCase } from '@bymax-one/nest-notification/testing'
import { otpStorageContract } from '@bymax-one/nest-notification/testing'

/** Exact (invariant) type equality — stricter than mutual assignability. */
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
/** Compiles only when the assertion holds; a false assertion is a type error. */
type Expect<T extends true> = T

// ---------------------------------------------------------------------------
// Module surface
// ---------------------------------------------------------------------------

// Both registration entry points resolve to a NestJS `DynamicModule` — consumers
// spread the result straight into an `imports` array.
type _ForRoot = Expect<Equal<ReturnType<typeof BymaxNotificationModule.forRoot>, DynamicModule>>
type _ForRootAsync = Expect<
  Equal<ReturnType<typeof BymaxNotificationModule.forRootAsync>, DynamicModule>
>
// `forRoot` takes the public options object, not a resolved/internal shape.
type _ForRootArg = Expect<
  Equal<Parameters<typeof BymaxNotificationModule.forRoot>[0], BymaxNotificationModuleOptions>
>

// ---------------------------------------------------------------------------
// OTP verification — the discriminated unions consumers switch on
// ---------------------------------------------------------------------------

declare const otp: OtpService

// `verify` never resolves a bare boolean: the failure reason is part of the contract
// so a consumer can distinguish "wrong code" (with attempts left) from "locked out".
type _Verify = Expect<Equal<ReturnType<typeof otp.verify>, Promise<OtpVerifyResult>>>
// `generate` never returns the plaintext code — only when it expires and when the
// caller may ask again.
type _Generate = Expect<Equal<ReturnType<typeof otp.generate>, Promise<OtpGenerateResult>>>
type _GenerateShape = Expect<
  Equal<OtpGenerateResult, { expiresAt: number; cooldownSeconds: number }>
>
// `consume` is fire-and-forget: it resolves `void` and throws on failure.
type _Consume = Expect<Equal<ReturnType<typeof otp.consume>, Promise<void>>>

// Narrowing on `valid` must expose `remainingAttempts` only in the invalid-code
// branch — that is the only outcome where a countdown is meaningful.
declare const result: OtpVerifyResult
if (!result.valid && result.reason === 'invalid_code') {
  type _Remaining = Expect<Equal<typeof result.remainingAttempts, number>>
}
// The success branch carries nothing else: no code, no metadata.
type _ValidBranch = Expect<Equal<Extract<OtpVerifyResult, { valid: true }>, { valid: true }>>

// The storage-level primitive keeps its own union — `ok` is the only branch that
// hands back an entry, so a custom storage cannot forget to return one.
type _ConsumeOk = Expect<
  Equal<Extract<ConsumeAttemptResult, { status: 'ok' }>['entry']['code'], string>
>
type _ConsumeStatuses = Expect<
  Equal<ConsumeAttemptResult['status'], 'not_found' | 'max_attempts' | 'ok'>
>

// ---------------------------------------------------------------------------
// Storage contract — the atomic primitives a custom implementation must provide
// ---------------------------------------------------------------------------

// `consumeAttempt` is the only way to spend an attempt; it must stay async and
// keyed by the (tenant, recipient, purpose) triple.
type _ConsumeAttempt = Expect<
  Equal<
    Parameters<IOtpStorage['consumeAttempt']>,
    [tenantId: string, recipient: string, purpose: string]
  >
>
type _ConsumeAttemptRet = Expect<
  Equal<ReturnType<IOtpStorage['consumeAttempt']>, Promise<ConsumeAttemptResult>>
>
// `tryAcquireCooldown` resolves the acquire/reject decision — never `void`, or the
// caller could not tell that a cooldown is already running.
type _Cooldown = Expect<Equal<ReturnType<IOtpStorage['tryAcquireCooldown']>, Promise<boolean>>>
// A read-only `get` is nullable: absent and expired are indistinguishable.
type _StorageGet = Expect<
  Equal<Awaited<ReturnType<IOtpStorage['get']>>, Awaited<ReturnType<IOtpStorage['get']>> | null>
>

// ---------------------------------------------------------------------------
// Provider contracts — implemented by the consumer, so every member is checked
// ---------------------------------------------------------------------------

declare const emailProvider: IEmailProvider
declare const renderer: IEmailTemplateRenderer
declare const logRepository: INotificationLogRepository
declare const email: EmailService

// The adapter surface is closed: adding a member here is a breaking change for
// every consumer-written provider, so the member set is asserted exactly. Each
// carries a `name` because it is what the audit trail and startup logs identify.
type _ProviderKeys = Expect<Equal<keyof typeof emailProvider, 'send' | 'isConfigured' | 'name'>>
type _RendererKeys = Expect<Equal<keyof typeof renderer, 'render' | 'hasTemplate' | 'name'>>
type _LogKeys = Expect<Equal<keyof typeof logRepository, 'create' | 'name'>>
// The startup readiness check is synchronous — it runs during module init, before
// anything can be awaited on the request path.
type _IsConfigured = Expect<Equal<ReturnType<typeof emailProvider.isConfigured>, boolean>>

// The bundled SMTP adapter satisfies the same closed contract a consumer implements.
const _smtpIsAProvider: IEmailProvider = new SmtpEmailProvider({ host: 'localhost', port: 1025 })
// Credentials read straight from `process.env` are `string | undefined`. They must
// type-check as supplied — `isConfigured()` is what reports a variable that failed to
// load, so a consumer never needs a non-null assertion to wire the provider up.
declare const envValue: string | undefined
const _smtpAcceptsEnvCredentials: SmtpEmailProviderOptions = {
  host: envValue,
  credentials: { user: envValue, pass: envValue }
}
// The audit sink receives entries, never raw OTP material.
type _LogCreate = Expect<Equal<Parameters<typeof logRepository.create>[0], NotificationLogEntry>>
type _LogEntryHasNoCode = Expect<
  Equal<'code' extends keyof NotificationLogEntry ? true : false, false>
>
// `EmailService.send` resolves only the provider's `messageId`: delivery failures
// surface as a thrown `NotificationException`, never as a status field the caller
// might forget to read.
type _EmailSend = Expect<Equal<ReturnType<typeof email.send>, Promise<{ messageId: string }>>>
type _EmailSendTemplate = Expect<
  Equal<ReturnType<typeof email.sendTemplate>, Promise<{ messageId: string }>>
>

// ---------------------------------------------------------------------------
// Utilities re-exported for consumers writing their own adapters
// ---------------------------------------------------------------------------

type _Hash = Expect<
  Equal<typeof hashTenantRecipient, (tenantId: string, recipient: string) => string>
>
type _SafeCompare = Expect<Equal<typeof safeCompare, (expected: string, actual: string) => boolean>>
// `Retry-After` is a header value, so it must be a string even though the input is
// a number of seconds.
type _RetryAfter = Expect<Equal<typeof toRetryAfterHeader, (remainingSeconds: number) => string>>

// ---------------------------------------------------------------------------
// Shared subpath — must stay usable from a browser bundle with zero deps
// ---------------------------------------------------------------------------

// Error codes are a closed set derived from the catalog, not a widened `string`.
type _ErrorCode = Expect<
  Equal<
    NotificationErrorCode,
    (typeof NOTIFICATION_ERROR_CODES)[keyof typeof NOTIFICATION_ERROR_CODES]
  >
>
type _ErrorCodeNotString = Expect<Equal<string extends NotificationErrorCode ? true : false, false>>
// `OtpPurpose` stays open so consumers can define their own purposes alongside the
// canonical ones.
type _OtpPurpose = Expect<Equal<string extends OtpPurpose ? true : false, true>>

// ---------------------------------------------------------------------------
// React subpath — state/UX only, no transport
// ---------------------------------------------------------------------------

declare const inputState: UseOtpInputState
declare const countdownState: UseOtpCountdownState

// The hooks expose handlers and state, never a verify/submit call — talking to the
// backend is the consumer app's job.
type _NoVerify = Expect<Equal<'verify' extends keyof UseOtpInputState ? true : false, false>>
type _Values = Expect<Equal<typeof inputState.values, string[]>>
type _Reset = Expect<Equal<typeof inputState.reset, () => void>>
type _Remaining = Expect<Equal<typeof countdownState.remainingSeconds, number>>

// ---------------------------------------------------------------------------
// Testing subpath — an executable contract for consumer-supplied storages
// ---------------------------------------------------------------------------

declare const consumerStorage: IOtpStorage

// The factory may be sync or async, and the result is a plain array the
// consumer feeds to whatever runner they use — no test framework in the type.
const contractCases = otpStorageContract(() => consumerStorage)
const asyncContractCases = otpStorageContract(async () => consumerStorage)

type _ContractCases = Expect<Equal<typeof contractCases, OtpStorageContractCase[]>>
type _AsyncContractCases = Expect<Equal<typeof asyncContractCases, OtpStorageContractCase[]>>
type _CaseRun = Expect<Equal<OtpStorageContractCase['run'], () => Promise<void>>>
type _CaseName = Expect<Equal<OtpStorageContractCase['name'], string>>
