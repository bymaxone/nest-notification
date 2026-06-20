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

import { Inject, Injectable, Optional } from '@nestjs/common'

import {
  BYMAX_NOTIFICATION_LOG_REPOSITORY,
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_OTP_STORAGE
} from '../bymax-notification.constants'
import { EmailService } from './email.service'
import type { EmailSendTemplateInput } from './email.service'
import type { ResolvedNotificationOptions, ResolvedOtpOptions } from '../config/resolved-options'
import { NotificationException } from '../errors/notification-exception'
import type {
  INotificationLogRepository,
  NotificationLogEntry,
  NotificationLogVerb
} from '../interfaces/notification-log-repository.interface'
import type { OtpPurposeConfig } from '../interfaces/notification-module-options.interface'
import type { IOtpStorage, OtpEntry, OtpVerifyResult } from '../interfaces/otp-storage.interface'
import { generateOtpCode } from '../utils/code-generator'
import { cooldownExpiresAt, toRetryAfterHeader } from '../utils/cooldown-helpers'
import { safeCompare } from '../utils/timing-safe-compare'

/** Milliseconds in one second. */
const MS_PER_SECOND = 1000
/** Seconds in one minute — used to derive `expiresInMinutes` for the OTP email. */
const SECONDS_PER_MINUTE = 60
/** Default template name used when the caller does not name one. */
const DEFAULT_OTP_TEMPLATE = 'otp_code'

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
export class OtpService {
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
    const cfg = otp.resolveForPurpose(input.purpose)
    await this.acquireCooldownOrThrow(input, cfg.resendCooldownSeconds)
    const code = generateOtpCode(cfg.length, cfg.codeType)
    const expiresAt = Date.now() + cfg.ttlSeconds * MS_PER_SECOND
    await this.persistAndDeliver(input, code, expiresAt, cfg)
    await this.audit(this.otpAuditEntry('generated', input, undefined))
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
    const result = await this.storage.consumeAttempt(input.tenantId, input.recipient, input.purpose)
    if (result.status === 'not_found') {
      await this.audit(this.otpAuditEntry('failed', input, { reason: 'not_found' }))
      return { valid: false, reason: 'not_found' }
    }
    if (result.status === 'max_attempts') {
      await this.audit(
        this.otpAuditEntry('max_attempts_exceeded', input, { reason: 'max_attempts' })
      )
      return { valid: false, reason: 'max_attempts' }
    }
    const { entry } = result
    if (!safeCompare(entry.code, input.code)) {
      await this.audit(this.otpAuditEntry('failed', input, { reason: 'invalid_code' }))
      return {
        valid: false,
        reason: 'invalid_code',
        remainingAttempts: entry.maxAttempts - entry.attempts
      }
    }
    await this.finalizeVerifySuccess(input, entry, otp.consumeOnVerify)
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
    await this.storage.delete(input.tenantId, input.recipient, input.purpose)
    await this.storage.clearCooldown(input.tenantId, input.recipient, input.purpose)
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
    const [entry, cooldownSeconds] = await Promise.all([
      this.storage.get(input.tenantId, input.recipient, input.purpose),
      this.storage.getCooldown(input.tenantId, input.recipient, input.purpose)
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
    code: string,
    expiresAt: number,
    cfg: OtpPurposeConfig
  ): Promise<void> {
    try {
      await this.storage.set(input.tenantId, input.recipient, input.purpose, {
        code,
        expiresAt,
        attempts: 0,
        maxAttempts: cfg.maxAttempts
      })
      await this.deliverOtp(input, code, cfg)
    } catch (error) {
      await this.releaseOtp(input)
      await this.audit(
        this.otpAuditEntry('failed', input, {
          errorMessage: error instanceof Error ? error.message : String(error)
        })
      )
      throw error
    }
  }

  /** Delivers the code by email when requested; throws on failure (release is handled by the caller). */
  private async deliverOtp(
    input: OtpGenerateInput,
    code: string,
    cfg: OtpPurposeConfig
  ): Promise<void> {
    const deliverVia = input.deliverVia ?? (this.emailService ? 'email' : 'manual')
    if (deliverVia !== 'email') {
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
      to: input.recipient,
      template: input.emailTemplate ?? DEFAULT_OTP_TEMPLATE,
      data: { ...input.emailData, code, expiresInMinutes, purpose: input.purpose },
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
        throw new NotificationException('AUDIT_LOG_FAILED', {
          cause: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }
}
