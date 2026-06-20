/**
 * @fileoverview Eager validation of `BymaxNotificationModuleOptions`.
 * @layer application
 *
 * Fails fast with a clear, actionable message for every malformed option, so a
 * misconfiguration surfaces at module construction rather than at first use. No
 * schema library (zod/class-validator) — the rules are simple and explicit.
 */

import { OTP_MAX_LENGTH, OTP_MIN_LENGTH, VALID_CODE_TYPES } from './default-options'
import { NotificationException } from '../errors/notification-exception'
import type {
  BymaxNotificationModuleOptions,
  EmailChannelOptions,
  OtpChannelOptions
} from '../interfaces/notification-module-options.interface'

/**
 * Validates module options, throwing on the first problem found.
 *
 * @param options - The consumer-supplied module options.
 * @throws Error When no channel is configured, a channel is malformed, or an
 * unsupported (`sms`/`push`) channel is requested in v0.1.
 * @throws NotificationException With `OTP_INVALID_LENGTH` when `otp.defaultLength` is out of range.
 */
export function validateOptions(options: BymaxNotificationModuleOptions): void {
  if (!options.email && !options.otp && !options.sms && !options.push) {
    throw new Error(
      '[BymaxNotificationModule] At least one channel must be configured (email, otp, sms, or push)'
    )
  }

  if (options.sms) {
    throw new Error(
      "[BymaxNotificationModule] SMS channel is not yet implemented (planned for v0.2). Remove 'sms' from options."
    )
  }

  if (options.push) {
    throw new Error(
      "[BymaxNotificationModule] Push channel is not yet implemented (planned for v0.2). Remove 'push' from options."
    )
  }

  if (options.email) {
    validateEmailOptions(options.email)
  }

  if (options.otp) {
    validateOtpOptions(options.otp)
  }

  if (options.audit && !options.audit.repository) {
    throw new Error(
      "[BymaxNotificationModule] options.audit.repository is required when 'audit' is configured"
    )
  }
}

/** Validates the email channel section. */
function validateEmailOptions(email: EmailChannelOptions): void {
  if (!email.provider) {
    throw new Error(
      "[BymaxNotificationModule] options.email.provider is required when 'email' is configured"
    )
  }
  if (typeof email.defaultFrom !== 'string' || email.defaultFrom.trim() === '') {
    throw new Error(
      '[BymaxNotificationModule] options.email.defaultFrom must be a non-empty string'
    )
  }
  if (!email.defaultFrom.includes('@')) {
    throw new Error(
      '[BymaxNotificationModule] options.email.defaultFrom does not look like an email'
    )
  }
}

/** Validates the OTP channel section. */
function validateOtpOptions(otp: OtpChannelOptions): void {
  if (!otp.storage) {
    throw new Error(
      "[BymaxNotificationModule] options.otp.storage is required when 'otp' is configured"
    )
  }
  if (otp.defaultLength !== undefined) {
    const length = otp.defaultLength
    if (!Number.isInteger(length) || length < OTP_MIN_LENGTH || length > OTP_MAX_LENGTH) {
      throw new NotificationException('OTP_INVALID_LENGTH', {
        provided: length,
        allowed: `${OTP_MIN_LENGTH}-${OTP_MAX_LENGTH}`
      })
    }
  }
  if (otp.defaultCodeType !== undefined && !VALID_CODE_TYPES.includes(otp.defaultCodeType)) {
    throw new Error(
      `[BymaxNotificationModule] options.otp.defaultCodeType must be one of: ${VALID_CODE_TYPES.join(', ')}`
    )
  }
  if (otp.defaultTtlSeconds !== undefined && otp.defaultTtlSeconds <= 0) {
    throw new Error(
      '[BymaxNotificationModule] options.otp.defaultTtlSeconds must be greater than 0'
    )
  }
  if (otp.defaultMaxAttempts !== undefined && otp.defaultMaxAttempts < 1) {
    throw new Error('[BymaxNotificationModule] options.otp.defaultMaxAttempts must be at least 1')
  }
  if (otp.resendCooldownSeconds !== undefined && otp.resendCooldownSeconds < 0) {
    throw new Error(
      '[BymaxNotificationModule] options.otp.resendCooldownSeconds must be 0 or greater'
    )
  }
}
