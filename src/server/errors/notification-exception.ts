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
 * Typed HTTP exception over the notification error catalog.
 *
 * @example
 * ```ts
 * throw new NotificationException('OTP_INVALID_LENGTH', { provided: 0, allowed: '1-32' })
 * ```
 */
export class NotificationException extends HttpException {
  /** The stable error code (e.g. `'notification.otp_invalid_code'`). */
  readonly code: string

  /**
   * @param key - Catalog key selecting the code, default HTTP status, and message.
   * @param details - Optional structured context placed under `error.details`.
   * @param overrideStatus - Replaces the catalog's default HTTP status when supplied.
   * @param overrideMessage - Replaces the catalog's default message when supplied.
   */
  constructor(
    key: NotificationErrorKey,
    details?: Record<string, unknown>,
    overrideStatus?: HttpStatus,
    overrideMessage?: string
  ) {
    const definition = NOTIFICATION_ERROR_DEFINITION_MAP.get(key) ?? FALLBACK_DEFINITION
    const body: NotificationErrorResponse = {
      error: {
        code: definition.code,
        message: overrideMessage ?? definition.message,
        details: details ?? null
      }
    }
    super(body, overrideStatus ?? definition.status)
    this.code = definition.code
  }
}
