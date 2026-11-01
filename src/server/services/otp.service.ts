/**
 * @fileoverview Public OTP lifecycle service — the library's security core.
 * @layer application
 *
 * Two atomic guarantees are enforced here and never weakened:
 *
 * 1. **Atomic attempt counting** — the per-OTP attempt counter is mutated ONLY by
 *    `storage.consumeAttempt` (a Redis Lua script / a single synchronous Map op).
 *    The service never does its own `get`+`update` to increment.
 * 2. **Atomic cooldown with release-on-failure** — `generate` claims the resend
 *    cooldown with `storage.tryAcquireCooldown` (`SET NX EX`) BEFORE issuing a code,
 *    and releases it (plus deletes the orphan OTP) if persistence OR delivery fails,
 *    so a storage outage or a bounced email never locks the user out and concurrent
 *    resends cannot both reset the counter.
 *
 * The plaintext code never leaves storage: it is never logged, never placed in an
 * audit entry, and `getStatus` never returns it. Verification compares in constant
 * time via `safeCompare`.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { OnModuleInit } from '@nestjs/common'

import {
  BYMAX_NOTIFICATION_LOG_REPOSITORY,
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_OTP_STORAGE
} from '../bymax-notification.constants'
import { EmailService } from './email.service'
import type { EmailSendTemplateInput } from './email.service'
import type { ResolvedNotificationOptions, ResolvedOtpOptions } from '../config/resolved-options'
import { CANONICAL_EMAIL_TEMPLATES } from '../constants/canonical-templates'
import { NotificationException } from '../errors/notification-exception'
import type {
  INotificationLogRepository,
  NotificationLogEntry,
  NotificationLogVerb
} from '../interfaces/notification-log-repository.interface'
import type { OtpPurposeConfig } from '../interfaces/notification-module-options.interface'
import type { IOtpStorage, OtpEntry, OtpVerifyResult } from '../interfaces/otp-storage.interface'
import { isCodeDigest } from '../utils/code-digest'
import { generateOtpCode } from '../utils/code-generator'
import { cooldownExpiresAt, toRetryAfterHeader } from '../utils/cooldown-helpers'
import { describeError } from '../utils/describe-error'
import { normalizeRecipient } from '../utils/recipient'
import {
  attachCauseIfAbsent,
  coerceRedacted,
  isSafeError,
  readRedactedMessage,
  scrubValuesFromErrorChain
} from '../utils/redact'
import { assertIdentifies } from '../utils/tenant-scope'
import { safeCompare } from '../utils/timing-safe-compare'

/** Milliseconds in one second. */
const MS_PER_SECOND = 1000
/** Seconds in one minute — used to derive `expiresInMinutes` for the OTP email. */
const SECONDS_PER_MINUTE = 60
/** Default template name used when the caller does not name one. */
const DEFAULT_OTP_TEMPLATE = CANONICAL_EMAIL_TEMPLATES.OTP_CODE
/** Log code of the warning for an OTP channel whose default email template cannot be found. */
const TEMPLATE_WARNING_CODE = 'BYMAX_NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED'
/** Common `(tenant, recipient, purpose)` reference shared by every OTP operation. */
interface OtpRecipientRef {
  tenantId: string
  recipient: string
  purpose: string
  /** Associated user id, recorded in the audit entry. */
  userId?: string
}

/** Input for {@link OtpService.generate} / {@link OtpService.resend}. */
export interface OtpGenerateInput extends OtpRecipientRef {
  /** `'email'` delivers via {@link EmailService}; `'manual'` lets the caller deliver. */
  deliverVia?: 'email' | 'manual'
  /** Template to render for email delivery. Default: `'otp_code'`. */
  emailTemplate?: string
  /** Extra template variables merged under the auto-injected `{ code, expiresInMinutes, purpose }`. */
  emailData?: Record<string, unknown>
  /** Email locale. */
  locale?: string
}

/** Input for {@link OtpService.verify}. */
export interface OtpVerifyInput extends OtpRecipientRef {
  code: string
}

/** Input for {@link OtpService.consume}. */
export type OtpConsumeInput = OtpRecipientRef

/** Input for {@link OtpService.getStatus}. */
export interface OtpStatusInput {
  tenantId: string
  recipient: string
  purpose: string
}

/** Result of a successful {@link OtpService.generate}. */
export interface OtpGenerateResult {
  expiresAt: number
  cooldownSeconds: number
}

/** A storage that implements all three optional failure methods, which only work together. */
type FailureCarryingStorage = IOtpStorage &
  Required<Pick<IOtpStorage, 'getFailures' | 'recordFailure' | 'clearFailures'>>

/**
 * Whether the storage carries failed attempts across a re-issue. Counting without the means to
 * read and clear the count would lock a recipient out for good, so a storage with only some of
 * the methods is treated as having none.
 */
function carriesFailures(storage: IOtpStorage): storage is FailureCarryingStorage {
  return (
    storage.getFailures !== undefined &&
    storage.recordFailure !== undefined &&
    storage.clearFailures !== undefined
  )
}

/** Result of {@link OtpService.getStatus} — never carries the plaintext code. */
export interface OtpStatusResult {
  exists: boolean
  expiresAt?: number
  attempts?: number
  maxAttempts?: number
  cooldownSeconds: number
  validated?: boolean
}

/** OTP generation, verification, consumption, and status. */
@Injectable()
export class OtpService implements OnModuleInit {
  private readonly logger = new Logger(OtpService.name)
  private warnedFailuresNotCarried = false
  private warnedTemplate = false

  /**
   * @param options - The resolved, frozen module options.
   * @param storage - The configured OTP storage.
   * @param auditLog - The audit-log repository (no-op when none configured).
   * @param emailService - The email service; present only when the email channel is configured.
   */
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS)
    private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_OTP_STORAGE)
    private readonly storage: IOtpStorage,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY)
    private readonly auditLog: INotificationLogRepository,
    @Optional()
    @Inject(EmailService)
    private readonly emailService?: EmailService
  ) {}

  /**
   * Whether the OTP channel is configured and its storage is ready.
   *
   * @returns `true` when both hold.
   */
  isConfigured(): boolean {
    return Boolean(this.options.otp) && this.storage.isConfigured()
  }

  /**
   * Generates, persists, and (optionally) delivers an OTP by email.
   *
   * @param input - The recipient, purpose, and delivery options.
   * @returns The expiry timestamp and the resend cooldown length.
   * @throws NotificationException `OTP_STORAGE_NOT_CONFIGURED`, `OTP_COOLDOWN_ACTIVE`,
   * `OTP_EMAIL_DELIVERY_NOT_CONFIGURED`, or rethrows a persistence/delivery error after
   * releasing the cooldown lock.
   */
  async generate(input: OtpGenerateInput): Promise<OtpGenerateResult> {
    const otp = this.requireOtpOptions()
    this.assertScope(input)
    const scope = this.keyed(input)
    this.assertDeliverable(input, otp.digestCode)
    const cfg = otp.resolveForPurpose(input.purpose)
    await this.acquireCooldownOrThrow(scope, cfg.resendCooldownSeconds)
    const code = generateOtpCode(cfg.length, cfg.codeType)
    const expiresAt = Date.now() + cfg.ttlSeconds * MS_PER_SECOND
    const entry: OtpEntry = {
      // What the store holds is the digest when a secret is configured; the delivery
      // carries the plaintext code the recipient has to type.
      code: otp.digestCode ? otp.digestCode(code) : code,
      expiresAt,
      attempts: 0,
      maxAttempts: cfg.maxAttempts
    }
    await this.persistAndDeliver(input, scope, code, entry, cfg)
    await this.audit(this.otpAuditEntry('generated', scope, undefined))
    return { expiresAt, cooldownSeconds: cfg.resendCooldownSeconds }
  }

  /**
   * Verifies a guessed code against the stored OTP (constant-time).
   *
   * @param input - The recipient, purpose, and guessed code.
   * @returns The discriminated verification result.
   * @throws NotificationException `OTP_STORAGE_NOT_CONFIGURED` when the channel is absent.
   */
  async verify(input: OtpVerifyInput): Promise<OtpVerifyResult> {
    const otp = this.requireOtpOptions()
    this.assertScope(input)
    const scope = this.keyed(input)
    const cfg = otp.resolveForPurpose(scope.purpose)
    // The stored count is the only thing that outlives a code, so it alone decides whether the
    // recipient is locked out, and the lockout ends when the counter lapses. The attempt is
    // counted before the code is compared: the increment is atomic, so guesses that arrive
    // together each get their own number and only those within the ceiling are compared. An
    // attempt is counted only while a code is live.
    const attempt = await this.countAttempt(scope, cfg.ttlSeconds)
    if (attempt === null) {
      await this.audit(this.otpAuditEntry('failed', scope, { reason: 'not_found' }))
      return { valid: false, reason: 'not_found' }
    }
    if (attempt !== undefined && attempt > cfg.maxAttempts) {
      await this.audit(
        this.otpAuditEntry('max_attempts_exceeded', scope, { reason: 'max_attempts' })
      )
      return { valid: false, reason: 'max_attempts' }
    }
    const result = await this.storage.consumeAttempt(scope.tenantId, scope.recipient, scope.purpose)
    if (result.status === 'not_found') {
      await this.audit(this.otpAuditEntry('failed', scope, { reason: 'not_found' }))
      return { valid: false, reason: 'not_found' }
    }
    if (result.status === 'max_attempts') {
      await this.audit(
        this.otpAuditEntry('max_attempts_exceeded', scope, { reason: 'max_attempts' })
      )
      return { valid: false, reason: 'max_attempts' }
    }
    const { entry } = result
    if (!this.matchesStoredCode(entry.code, scope.code, otp.digestCode)) {
      await this.audit(this.otpAuditEntry('failed', scope, { reason: 'invalid_code' }))
      const ofCode = entry.maxAttempts - entry.attempts
      return {
        valid: false,
        reason: 'invalid_code',
        // The code's own budget and the recipient's failure budget both run out; the nearer wins.
        remainingAttempts:
          attempt === undefined ? ofCode : Math.min(ofCode, cfg.maxAttempts - attempt)
      }
    }
    await this.storage.clearFailures?.(scope.tenantId, scope.recipient, scope.purpose)
    await this.finalizeVerifySuccess(scope, entry, otp.consumeOnVerify)
    return { valid: true }
  }

  /**
   * Deletes an OTP and clears its resend cooldown. Idempotent.
   *
   * @param input - The recipient and purpose.
   * @throws NotificationException `OTP_STORAGE_NOT_CONFIGURED` when the channel is absent.
   */
  async consume(input: OtpConsumeInput): Promise<void> {
    this.requireOtpOptions()
    this.assertScope(input)
    const scope = this.keyed(input)
    await this.storage.delete(scope.tenantId, scope.recipient, scope.purpose)
    await this.storage.clearCooldown(scope.tenantId, scope.recipient, scope.purpose)
    await this.storage.clearFailures?.(scope.tenantId, scope.recipient, scope.purpose)
  }

  /**
   * Explicit resend — a functional alias of {@link OtpService.generate}.
   *
   * @param input - The recipient, purpose, and delivery options.
   * @returns The expiry timestamp and the resend cooldown length.
   */
  async resend(input: OtpGenerateInput): Promise<OtpGenerateResult> {
    return this.generate(input)
  }

  /**
   * Returns the current OTP status without ever exposing the plaintext code.
   *
   * @param input - The recipient and purpose.
   * @returns Existence, expiry, attempt counters, validation flag, and cooldown.
   */
  async getStatus(input: OtpStatusInput): Promise<OtpStatusResult> {
    this.assertScope(input)
    const scope = this.keyed(input)
    const [entry, cooldownSeconds] = await Promise.all([
      this.storage.get(scope.tenantId, scope.recipient, scope.purpose),
      this.storage.getCooldown(scope.tenantId, scope.recipient, scope.purpose)
    ])
    if (!entry) {
      return { exists: false, cooldownSeconds }
    }
    return {
      exists: true,
      expiresAt: entry.expiresAt,
      attempts: entry.attempts,
      maxAttempts: entry.maxAttempts,
      cooldownSeconds,
      ...(entry.validated !== undefined ? { validated: entry.validated } : {})
    }
  }

  /** Acquires the cooldown lock or throws `OTP_COOLDOWN_ACTIVE` with retry hints. */
  private async acquireCooldownOrThrow(
    ref: OtpRecipientRef,
    cooldownSeconds: number
  ): Promise<void> {
    const hasCooldownLock = await this.storage.tryAcquireCooldown(
      ref.tenantId,
      ref.recipient,
      ref.purpose,
      cooldownSeconds
    )
    if (hasCooldownLock) {
      return
    }
    const remainingSeconds = await this.storage.getCooldown(
      ref.tenantId,
      ref.recipient,
      ref.purpose
    )
    await this.audit(this.otpAuditEntry('cooldown_blocked', ref, { remainingSeconds }))
    throw new NotificationException('OTP_COOLDOWN_ACTIVE', {
      remainingSeconds,
      retryAfter: toRetryAfterHeader(remainingSeconds),
      expiresAt: cooldownExpiresAt(remainingSeconds)
    })
  }

  /**
   * Persists the OTP then delivers it, releasing the cooldown lock (and deleting the
   * orphan entry) if EITHER step fails — so a storage outage or a bounced email can
   * never leave the recipient locked out behind a cooldown with no live code. The
   * plaintext code is never placed in the failure audit entry. The original typed
   * error is re-thrown after the lock is released.
   */
  private async persistAndDeliver(
    input: OtpGenerateInput,
    scope: OtpGenerateInput,
    code: string,
    entry: OtpEntry,
    cfg: OtpPurposeConfig
  ): Promise<void> {
    try {
      await this.storage.set(scope.tenantId, scope.recipient, scope.purpose, entry)
      await this.deliverOtp(input, code, cfg)
    } catch (error) {
      throw await this.failedOutgoing(scope, error, code)
    }
  }

  /**
   * Releases the cooldown and the orphan entry after a failed persist or delivery, audits the
   * failure, and returns what the caller must throw.
   *
   * A failed cleanup supersedes the delivery error — the cooldown/OTP may now be orphaned,
   * which the caller must see — and it must NOT bypass the scrub below. The delivery error is
   * preserved as its cause when the cleanup error can verifiably carry one; a hostile trap
   * inside the attachment is contained by the helper.
   *
   * The scrub runs BEFORE the audit write and the rethrow, so neither the entry's
   * `errorMessage` nor the outgoing chain can carry the plaintext code. An Error chain is
   * scrubbed (in place, or via redacted copies when a node resists mutation); ANY other
   * rejection (string, object from a custom storage, number) is flattened to a redacted
   * string, because a raw object could carry the code in its properties and a primitive
   * cannot be mutated.
   */
  private async failedOutgoing(
    scope: OtpGenerateInput,
    error: unknown,
    code: string
  ): Promise<unknown> {
    let failure: unknown = error
    try {
      await this.releaseOtp(scope)
    } catch (cleanupError) {
      attachCauseIfAbsent(cleanupError, error)
      failure = cleanupError
    }
    const outgoing: unknown = isSafeError(failure)
      ? scrubValuesFromErrorChain(failure, [code])
      : coerceRedacted(failure, [code])
    await this.audit(
      this.otpAuditEntry('failed', scope, {
        // `outgoing` is already fully redacted by the scrub above; this read
        // only needs the fail-closed guard, not a second redaction pass.
        errorMessage: readRedactedMessage(outgoing)
      })
    )
    return outgoing
  }

  /**
   * Runs the two startup checks. Neither depends on the other, and neither can fail or delay
   * boot: the template check is started detached, so a renderer that never answers holds
   * nothing.
   */
  onModuleInit(): void {
    this.warnFailuresNotCarried()
    void this.warnUnresolvedDefaultTemplate()
  }

  /**
   * Warns once when the storage cannot carry failed attempts across a re-issue, naming the
   * deviation from NIST SP 800-63B-4 §3.1.3.2 and the methods that remove it.
   */
  private warnFailuresNotCarried(): void {
    const storage = this.storage
    if (carriesFailures(storage) || this.warnedFailuresNotCarried) {
      return
    }
    this.warnedFailuresNotCarried = true
    this.logger.warn(
      `[BYMAX_NOTIFICATION_OTP_FAILURES_NOT_CARRIED] The ${storage.name} OTP storage does not implement ` +
        'getFailures, recordFailure and clearFailures, so issuing a new code gives it a fresh attempt budget; ' +
        'NIST SP 800-63B-4 §3.1.3.2 says generating a new secret SHALL NOT reset the failed authentication count. ' +
        'Implement the three optional methods to carry the count across re-issues.'
    )
  }

  /**
   * Warns once when the OTP email would fail on its first use because the renderer has no
   * `otp_code` template for the default locale or `en`. It only ever logs: it catches
   * everything, so it cannot reject, and a renderer that answers late or never leaves boot
   * untouched because the caller does not wait for it.
   */
  private async warnUnresolvedDefaultTemplate(): Promise<void> {
    if (this.warnedTemplate || !this.options.otp || !this.emailService) {
      return
    }
    this.warnedTemplate = true
    const locale = this.options.global.defaultLocale
    try {
      if (
        !this.emailService.isConfigured() ||
        (await this.emailService.resolvesTemplate(DEFAULT_OTP_TEMPLATE, locale))
      ) {
        return
      }
      this.logger.warn(
        `[${TEMPLATE_WARNING_CODE}] The email template '${DEFAULT_OTP_TEMPLATE}' resolves for neither '${locale}' nor 'en', ` +
          'so the first generate() that delivers by email fails with TEMPLATE_NOT_FOUND. ' +
          `Register '${DEFAULT_OTP_TEMPLATE}' in your template renderer (DefaultTemplateRenderer takes it under 'otp_code::en'). ` +
          'Ignore this line if every generate() call passes emailTemplate, if you deliver manually, ' +
          'or if your renderer loads its templates after startup.'
      )
    } catch (error) {
      this.logger.warn(
        `[${TEMPLATE_WARNING_CODE}] Could not check whether the email template '${DEFAULT_OTP_TEMPLATE}' resolves ` +
          `(${describeError(error)}); if it does not, the first generate() that delivers by email fails with TEMPLATE_NOT_FOUND.`
      )
    }
  }

  /**
   * Counts one verification attempt against the recipient. Returns `undefined` when the storage
   * does not carry failures, and `null` when no code is live: a verification with no code guesses
   * at nothing, so it spends no budget, and the caller must answer `not_found` instead of going on
   * to consume an attempt from a code issued in the meantime, which would then go uncounted.
   */
  private async countAttempt(
    scope: OtpRecipientRef,
    ttlSeconds: number
  ): Promise<number | null | undefined> {
    const storage = this.storage
    if (!carriesFailures(storage)) {
      return undefined
    }
    const live = await storage.get(scope.tenantId, scope.recipient, scope.purpose)
    if (live === null) {
      return null
    }
    return storage.recordFailure(scope.tenantId, scope.recipient, scope.purpose, ttlSeconds)
  }

  /** How a generated code reaches the recipient: by email when asked or when an email channel exists. */
  private deliveryOf(input: OtpGenerateInput): 'email' | 'manual' {
    // Stryker disable next-line StringLiteral: when no email service is present the default is any non-'email' value; both 'manual' and an emptied string fall into the `!== 'email'` early return, so the literal is equivalent.
    return input.deliverVia ?? (this.emailService ? 'email' : 'manual')
  }

  /**
   * Refuses a manual delivery while codes are stored as digests, before the cooldown is taken
   * or anything is stored. `generate` never returns the code and a digest cannot be handed to
   * a person, so the call would otherwise succeed with nothing deliverable.
   *
   * @throws NotificationException `OTP_MANUAL_DELIVERY_UNAVAILABLE`.
   */
  private assertDeliverable(
    input: OtpGenerateInput,
    digestCode: ((code: string) => string) | undefined
  ): void {
    if (digestCode && this.deliveryOf(input) !== 'email') {
      throw new NotificationException('OTP_MANUAL_DELIVERY_UNAVAILABLE', {
        remedy:
          'unset otp.codeSecret to read the code from the store, or configure an email channel and deliver by email'
      })
    }
  }

  /** Delivers the code by email when requested; throws on failure (release is handled by the caller). */
  private async deliverOtp(
    input: OtpGenerateInput,
    code: string,
    cfg: OtpPurposeConfig
  ): Promise<void> {
    if (this.deliveryOf(input) !== 'email') {
      return
    }
    if (!this.emailService) {
      throw new NotificationException('OTP_EMAIL_DELIVERY_NOT_CONFIGURED')
    }
    await this.emailService.sendTemplate(this.buildOtpEmail(input, code, cfg))
  }

  /** Clears the cooldown and deletes the OTP — used to undo a failed delivery. */
  private async releaseOtp(ref: OtpRecipientRef): Promise<void> {
    await this.storage.clearCooldown(ref.tenantId, ref.recipient, ref.purpose)
    await this.storage.delete(ref.tenantId, ref.recipient, ref.purpose)
  }

  /** Builds the OTP email payload with the auto-injected `{ code, expiresInMinutes, purpose }`. */
  private buildOtpEmail(
    input: OtpGenerateInput,
    code: string,
    cfg: OtpPurposeConfig
  ): EmailSendTemplateInput {
    const expiresInMinutes = Math.ceil(cfg.ttlSeconds / SECONDS_PER_MINUTE)
    return {
      tenantId: input.tenantId,
      to: input.recipient.trim(),
      template: input.emailTemplate ?? DEFAULT_OTP_TEMPLATE,
      data: { ...input.emailData, code, expiresInMinutes, purpose: input.purpose },
      // The provider receives the code inside the rendered body and may echo it
      // in an error. Declaring it covers the shapes redaction can predict; the
      // flag below covers the ones it cannot — an OTP body is a credential by
      // definition, so this path never publishes what the provider wrote.
      auditRedactValues: [code],
      publishProviderText: false,
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {})
    }
  }

  /** Finalizes a correct verification: consume-and-clear, or mark `validated`. */
  private async finalizeVerifySuccess(
    input: OtpVerifyInput,
    entry: OtpEntry,
    consumeOnVerify: boolean
  ): Promise<void> {
    if (consumeOnVerify) {
      await this.storage.delete(input.tenantId, input.recipient, input.purpose)
      await this.storage.clearCooldown(input.tenantId, input.recipient, input.purpose)
    } else {
      await this.storage.update(input.tenantId, input.recipient, input.purpose, {
        ...entry,
        validated: true
      })
    }
    await this.audit(this.otpAuditEntry('verified', input, undefined))
  }

  /**
   * Refuses a tenant id or recipient that identifies nobody, before any storage call.
   *
   * The reference storage already refuses these through `hashTenantRecipient`, but a
   * consumer-supplied {@link IOtpStorage} is not required to, and a blank scope would
   * then be shared by every caller that sent one.
   *
   * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` when either is blank.
   */
  private assertScope(ref: OtpRecipientRef): void {
    assertIdentifies('OtpService', 'tenantId', ref.tenantId)
    assertIdentifies('OtpService', 'recipient', ref.recipient)
  }

  /**
   * Returns the input with its recipient replaced by the value the OTP state is keyed on.
   *
   * Every storage call and audit entry takes the result, so two spellings of one mailbox
   * share a cooldown and an attempt counter. Delivery takes the original input, trimmed:
   * the message keeps the caller's case but never its surrounding whitespace.
   */
  private keyed<T extends OtpRecipientRef>(input: T): T {
    return { ...input, recipient: normalizeRecipient(input.recipient) }
  }

  /**
   * Compares a guessed code with the stored value in constant time.
   *
   * A stored digest is recomputed from the guess. A digest that cannot be recomputed (no
   * secret configured, or a different one) never matches, and the digest string itself is
   * not accepted as a code. A stored value that is not a digest is a plaintext code written
   * while no secret was set; it is compared directly and ages out with its TTL.
   */
  private matchesStoredCode(
    stored: string,
    guess: string,
    digestCode: ((code: string) => string) | undefined
  ): boolean {
    if (!isCodeDigest(stored)) {
      return safeCompare(stored, guess)
    }
    return digestCode !== undefined && safeCompare(stored, digestCode(guess))
  }

  /** Returns the resolved OTP options or throws `OTP_STORAGE_NOT_CONFIGURED`. */
  private requireOtpOptions(): ResolvedOtpOptions {
    if (!this.options.otp) {
      throw new NotificationException('OTP_STORAGE_NOT_CONFIGURED')
    }
    return this.options.otp
  }

  /** Builds an OTP audit entry with the recipient masked and never the code. */
  private otpAuditEntry(
    verb: NotificationLogVerb,
    ref: OtpRecipientRef,
    metadata: Record<string, unknown> | undefined
  ): NotificationLogEntry {
    return {
      timestamp: Date.now(),
      tenantId: ref.tenantId,
      channel: 'otp',
      verb,
      recipient: this.options.audit.maskRecipient(ref.recipient),
      purpose: ref.purpose,
      providerName: this.storage.name,
      ...(ref.userId !== undefined ? { userId: ref.userId } : {}),
      ...(metadata !== undefined ? { metadata } : {})
    }
  }

  /** Writes an audit entry, swallowing failures unless `audit.swallowErrors` is `false`. */
  private async audit(entry: NotificationLogEntry): Promise<void> {
    try {
      await this.auditLog.create(entry)
    } catch (error) {
      if (!this.options.audit.swallowErrors) {
        // The underlying error rides only on `Error.cause` — `details` is serialized
        // into the HTTP response body, so internal error text must never land there.
        throw new NotificationException('AUDIT_LOG_FAILED', undefined, { cause: error })
      }
    }
  }
}
