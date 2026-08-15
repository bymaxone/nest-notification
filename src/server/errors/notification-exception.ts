/**
 * @fileoverview `NotificationException` — the library's single typed HTTP error.
 * @layer domain
 *
 * Wraps every failure in the catalog shape `{ error: { code, message, details } }`
 * (mirrors `@bymax-one/nest-auth`). Because it extends NestJS's `HttpException`,
 * the framework's exception filter serializes it automatically; consumers branch
 * on `error.code` to localize the message.
 */

import { HttpException, HttpStatus } from '@nestjs/common'

import {
  NOTIFICATION_ERROR_DEFINITION_MAP,
  type NotificationErrorDefinition,
  type NotificationErrorKey
} from './notification-error-codes'
import type { NotificationErrorResponse } from '../../shared/types/notification-error.types'

/**
 * Defensive fallback used only when a caller (e.g. untyped JS) passes a key that
 * is not in the catalog. Keeps the response well-formed instead of throwing a
 * raw `TypeError`. Not part of `NOTIFICATION_ERROR_DEFINITIONS`, so the
 * server/shared code parity gate is unaffected.
 */
const FALLBACK_DEFINITION: NotificationErrorDefinition = {
  code: 'notification.unknown_error',
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  message: 'Unknown notification error'
}

/**
 * Optional construction knobs, mirroring how `HttpException` itself moved its
 * positional arguments into an options object.
 */
export interface NotificationExceptionOptions {
  /** Replaces the catalog's default HTTP status when supplied. */
  status?: HttpStatus
  /** Replaces the catalog's default message when supplied. */
  message?: string
  /**
   * The underlying error, exposed as the native `Error.cause` so log serializers
   * can walk the chain. Never serialized into the HTTP response body. A falsy
   * value is ignored — `HttpException` only installs a truthy cause.
   */
  cause?: unknown
}

/**
 * Typed HTTP exception over the notification error catalog.
 *
 * @example
 * ```ts
 * throw new NotificationException('OTP_INVALID_LENGTH', { provided: 0, allowed: '1-32' })
 * // With the underlying error attached as `Error.cause`:
 * throw new NotificationException('EMAIL_SEND_FAILED', { providerName: 'smtp' }, { cause: error })
 * ```
 */
export class NotificationException extends HttpException {
  /** The stable error code (e.g. `'notification.otp_invalid_code'`). */
  readonly code: string

  /**
   * @param key - Catalog key selecting the code, default HTTP status, and message.
   * @param details - Optional structured context placed under `error.details`.
   * @param optionsOrStatus - An {@link NotificationExceptionOptions} object, or — kept
   * for backward compatibility — a bare `HttpStatus` acting as `options.status`.
   * @param overrideMessage - Replaces the catalog's default message when supplied;
   * kept for backward compatibility with the positional form. `options.message` wins
   * when both are given.
   */
  constructor(
    key: NotificationErrorKey,
    details?: Record<string, unknown>,
    optionsOrStatus?: HttpStatus | NotificationExceptionOptions,
    overrideMessage?: string
  ) {
    const definition = NOTIFICATION_ERROR_DEFINITION_MAP.get(key) ?? FALLBACK_DEFINITION
    const options: NotificationExceptionOptions =
      typeof optionsOrStatus === 'number' ? { status: optionsOrStatus } : (optionsOrStatus ?? {})
    const body: NotificationErrorResponse = {
      error: {
        code: definition.code,
        message: options.message ?? overrideMessage ?? definition.message,
        details: details ?? null
      }
    }
    // `HttpException` only installs a truthy cause, so forwarding `undefined` is a no-op.
    super(body, options.status ?? definition.status, { cause: options.cause })
    this.code = definition.code
  }
}
