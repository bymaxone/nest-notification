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

import type { NotificationErrorResponse } from '../../shared/types/notification-error.types'
import { describeError } from '../utils/describe-error'
import { nullProto, readName } from '../utils/read-options'
import {
  NOTIFICATION_ERROR_DEFINITION_MAP,
  type NotificationErrorDefinition,
  type NotificationErrorKey
} from './notification-error-codes'

// Taken at load: a `Map.prototype.get` replaced later runs on no refusal this constructor builds.
const LOADED_MAP_GET = Map.prototype.get
const apply = Reflect.apply
const mapGet = (map: ReadonlyMap<string, unknown>, key: string): unknown =>
  apply(LOADED_MAP_GET, map, [key])

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
    Object.defineProperty(safe, 'name', nullProto({ value: cause.name, writable: true }))
    if (cause.stack !== undefined) {
      safe.stack = cause.stack
    }
    if (depth < MAX_CAUSE_DEPTH && 'cause' in cause) {
      Object.defineProperty(
        safe,
        'cause',
        nullProto({ value: toLogSafeCause(cause.cause, depth + 1), writable: true })
      )
    }
    return safe
  }
  return typeof cause === 'object' && cause !== null
    ? describeError(cause, UNREADABLE_CAUSE_MESSAGE)
    : cause
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
    const definition =
      (mapGet(NOTIFICATION_ERROR_DEFINITION_MAP, key) as NotificationErrorDefinition | undefined) ??
      FALLBACK_DEFINITION
    const options: NotificationExceptionOptions =
      typeof optionsOrStatus === 'number' ? { status: optionsOrStatus } : (optionsOrStatus ?? {})
    // Every field is read by name and every object handed on has no prototype: a `status`, a
    // `message` or a `cause` planted on the realm root answers for none of them.
    const message = readName(options, 'message') as string | undefined
    const status = readName(options, 'status') as HttpStatus | undefined
    const body: NotificationErrorResponse = nullProto({
      error: nullProto({
        code: definition.code,
        message: message ?? overrideMessage ?? definition.message,
        details: details ?? null
      })
    })
    // `HttpException` only installs a truthy cause, so forwarding `undefined` is a no-op.
    super(
      body,
      status ?? definition.status,
      nullProto({ cause: toLogSafeCause(readName(options, 'cause')) })
    )
    this.code = definition.code
    // `HttpException` keeps its raw `options` argument as an enumerable own
    // property, so a spread or JSON serializer prints `options.cause` beside
    // the real `cause` — a duplicate reference to the same sanitized copy.
    // Hide it from enumeration; deliberate reads still work.
    // The descriptor has no prototype: a literal would inherit `get`, `set` or `value` from a
    // polluted `Object.prototype`, and building the refusal would then run the planted code.
    Object.defineProperty(
      this,
      'options',
      Object.assign(Object.create(null), { enumerable: false })
    )
  }
}
