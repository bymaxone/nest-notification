/**
 * @fileoverview Eager validation of `BymaxNotificationModuleOptions`.
 * @layer application
 *
 * Fails fast with a clear, actionable message for every malformed option, so a
 * misconfiguration surfaces at module construction rather than at first use. No
 * schema library (zod/class-validator) — the rules are simple and explicit.
 */

import { NotificationException } from '../errors/notification-exception'
import type {
  BymaxNotificationModuleOptions,
  EmailChannelOptions,
  OtpChannelOptions
} from '../interfaces/notification-module-options.interface'
import { MIN_CODE_SECRET_BYTES } from '../utils/code-digest'
import { purposeProblem } from '../utils/tenant-scope'
import { OTP_MAX_LENGTH, OTP_MIN_LENGTH, VALID_CODE_TYPES } from './default-options'
import {
  assertFiniteAbove,
  assertFiniteAtLeast,
  assertIntegerAtLeast,
  assertObject
} from './option-numbers'

/**
 * Validates module options, throwing on the first problem found.
 *
 * @param options - The consumer-supplied module options.
 * @throws Error When no channel is configured, a channel is malformed, or an
 * unsupported (`sms`/`push`) channel is requested.
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
      "[BymaxNotificationModule] SMS channel is not yet implemented. Remove 'sms' from options."
    )
  }

  if (options.push) {
    throw new Error(
      "[BymaxNotificationModule] Push channel is not yet implemented. Remove 'push' from options."
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
  if (
    email.maxRecipients !== undefined &&
    (!Number.isInteger(email.maxRecipients) || email.maxRecipients < 1)
  ) {
    throw new Error(
      '[BymaxNotificationModule] options.email.maxRecipients must be a positive integer'
    )
  }
  assertFiniteAtLeast('email.maxAttachmentBytes', email.maxAttachmentBytes, 0)
}

/**
 * Validates `otp.codeSecret`. A weak secret would let a reader of the store test a guess
 * against a stored digest, so it is refused at startup. The message never echoes the value.
 */
function validateCodeSecret(secret: unknown): void {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < MIN_CODE_SECRET_BYTES) {
    throw new Error(
      `[BymaxNotificationModule] options.otp.codeSecret must be a string of at least ${String(MIN_CODE_SECRET_BYTES)} bytes`
    )
  }
}

/** Throws `OTP_INVALID_LENGTH` unless `length` is absent or an integer in the supported range. */
function assertCodeLength(length: unknown): void {
  if (length === undefined) {
    return
  }
  if (
    !Number.isInteger(length) ||
    (length as number) < OTP_MIN_LENGTH ||
    (length as number) > OTP_MAX_LENGTH
  ) {
    throw new NotificationException('OTP_INVALID_LENGTH', {
      provided: length,
      allowed: `${OTP_MIN_LENGTH}-${OTP_MAX_LENGTH}`
    })
  }
}

/** Validates the numeric defaults of the OTP channel. */
function validateOtpNumbers(otp: OtpChannelOptions): void {
  assertCodeLength(otp.defaultLength)
  assertFiniteAbove('otp.defaultTtlSeconds', otp.defaultTtlSeconds, 0)
  assertIntegerAtLeast('otp.defaultMaxAttempts', otp.defaultMaxAttempts, 1)
  assertFiniteAtLeast('otp.resendCooldownSeconds', otp.resendCooldownSeconds, 0)
}

/** Validates each `perPurpose` entry: the key is a purpose, and every override is a usable number. */
function validatePerPurpose(perPurpose: OtpChannelOptions['perPurpose']): void {
  for (const [key, entry] of Object.entries(perPurpose ?? {})) {
    const problem = purposeProblem(key)
    if (problem !== undefined) {
      throw new Error(
        `[BymaxNotificationModule] options.otp.perPurpose has the key ${JSON.stringify(key)}, which is not a valid purpose: ${problem}`
      )
    }
    const path = `otp.perPurpose.${key}`
    assertObject(path, entry)
    assertCodeLength(entry.length)
    assertFiniteAbove(`${path}.ttlSeconds`, entry.ttlSeconds, 0)
    assertIntegerAtLeast(`${path}.maxAttempts`, entry.maxAttempts, 1)
    assertFiniteAtLeast(`${path}.resendCooldownSeconds`, entry.resendCooldownSeconds, 0)
  }
}

/** Validates the OTP channel section. */
function validateOtpOptions(otp: OtpChannelOptions): void {
  if (!otp.storage) {
    throw new Error(
      "[BymaxNotificationModule] options.otp.storage is required when 'otp' is configured"
    )
  }
  validateOtpNumbers(otp)
  if (otp.codeSecret !== undefined) {
    validateCodeSecret(otp.codeSecret)
  }
  if (otp.defaultCodeType !== undefined && !VALID_CODE_TYPES.includes(otp.defaultCodeType)) {
    throw new Error(
      `[BymaxNotificationModule] options.otp.defaultCodeType must be one of: ${VALID_CODE_TYPES.join(', ')}`
    )
  }
  validatePerPurpose(otp.perPurpose)
  if (otp.strictPurposes !== undefined && typeof otp.strictPurposes !== 'boolean') {
    throw new Error('[BymaxNotificationModule] options.otp.strictPurposes must be a boolean')
  }
}
