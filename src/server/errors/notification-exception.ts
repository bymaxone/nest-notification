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
 * How deep the sanitized `cause` chain may nest. Matches the depth bounds of
 * cause-walking log serializers and terminates self-referential chains.
 */
const MAX_CAUSE_DEPTH = 5

/**
 * Message of the fallback cause installed when INSPECTING the original cause
 * threw — a hostile getter or proxy trap must never replace the exception
 * being constructed.
 */
const UNREADABLE_CAUSE_MESSAGE = 'Cause unavailable: inspecting it threw'

/**
 * Copies an error into a log-safe shape: `name`, `message`, `stack`, and the
 * nested `cause` chain survive; every other property is dropped. Provider/SDK
 * errors routinely retain the request payload in extra properties (e.g. an
 * axios-style `config.data`), and for an OTP email that payload contains the
 * code — so the raw object must never reach a cause-walking log serializer.
 * Non-Error objects are flattened to their `String()` form for the same
 * reason; primitives pass through (they are already message-equivalent).
 */
function toLogSafeCause(cause: unknown, depth = 0): unknown {
  try {
    return copyLogSafeCause(cause, depth)
  } catch {
    // A hostile getter or proxy trap threw while the cause was being read;
    // fall back to a minimal, non-sensitive cause instead of letting that
    // error escape the constructor.
    return new Error(UNREADABLE_CAUSE_MESSAGE)
  }
}

/** Unguarded worker for {@link toLogSafeCause} — may throw on hostile causes. */
function copyLogSafeCause(cause: unknown, depth: number): unknown {
  if (cause instanceof Error) {
    const safe = new Error(cause.message)
    // `defineProperty` keeps the copy shaped like a native Error: `name` and
    // `cause` stay non-enumerable, so `Object.keys`/spread expose nothing.
    // Both stay writable so a downstream secret scrub can still redact them.
    Object.defineProperty(safe, 'name', { value: cause.name, writable: true })
    if (cause.stack !== undefined) {
      safe.stack = cause.stack
    }
    if (depth < MAX_CAUSE_DEPTH && 'cause' in cause) {
      Object.defineProperty(safe, 'cause', {
        value: toLogSafeCause(cause.cause, depth + 1),
        writable: true
      })
    }
    return safe
  }
  return typeof cause === 'object' && cause !== null ? String(cause) : cause
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
   * can walk the chain. Stored as a log-safe copy — `name`, `message`, `stack`,
   * and the nested `cause` chain are preserved (depth-bounded); every other
   * property is dropped so an SDK error that retains the request payload cannot
   * leak an OTP-bearing body into logs. Never serialized into the HTTP response
   * body. A falsy value is ignored — `HttpException` only installs a truthy cause.
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
    super(body, options.status ?? definition.status, { cause: toLogSafeCause(options.cause) })
    this.code = definition.code
  }
}
