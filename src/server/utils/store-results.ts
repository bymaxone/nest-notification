/**
 * @fileoverview Holds what a store answers an operation with to the kind the library compares it as.
 * @layer utils
 *
 * A host store answers whatever its code or its client returns. The library compares a lock or a
 * removal with `if` and `!`, an attempt count with `>`, and a status with `===`, and each of those
 * reads a truthy string, `NaN` or an unknown status the wrong way: the lock is "acquired", the code
 * "removed", the failure budget never reached. An answer of the wrong kind is refused with
 * `OTP_STORAGE_FAILED`, which no caller reads as success, and nothing of it is kept in the error.
 */

import { NotificationException } from '../errors/notification-exception'
import type { ConsumeAttemptResult, OtpEntry } from '../interfaces/otp-storage.interface'
import { copyByName } from './bounded-list'
import { assertFailureCount } from './failure-count'
import { nullProto } from './read-options'

/** A whole number of at least zero. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/** The refusal of an answer of the wrong kind. */
function refuse(providerName: string): never {
  throw new NotificationException('OTP_STORAGE_FAILED', { providerName })
}

/** A boolean answer, and nothing that is only truthy or falsy. */
function strictBoolean(value: unknown, providerName: string): boolean {
  return typeof value === 'boolean' ? value : refuse(providerName)
}

/**
 * The entry of an `ok` answer, each field read once into a new object. A field of another kind
 * than the interface declares refuses the answer.
 */
function entryOf(raw: unknown, providerName: string): OtpEntry {
  if (typeof raw !== 'object' || raw === null) {
    return refuse(providerName)
  }
  const { code, expiresAt, attempts, maxAttempts, validated, metadata } = raw as Record<
    string,
    unknown
  >
  if (
    typeof code !== 'string' ||
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    !isCount(attempts) ||
    !isCount(maxAttempts) ||
    (validated !== undefined && typeof validated !== 'boolean')
  ) {
    return refuse(providerName)
  }
  // No prototype: an object with none has no `then` to read when a promise resolves with it.
  return nullProto({
    code,
    expiresAt,
    attempts,
    maxAttempts,
    ...(validated !== undefined ? { validated } : {}),
    ...(metadata !== undefined ? { metadata: metadata as Record<string, unknown> } : {})
  })
}

/** The answer of `consumeAttempt`: one of the three statuses, and an entry with `ok`. */
function consumeResultOf(raw: unknown, providerName: string): ConsumeAttemptResult {
  if (typeof raw !== 'object' || raw === null) {
    return refuse(providerName)
  }
  const status: unknown = (raw as { status?: unknown }).status
  if (status === 'not_found' || status === 'max_attempts') {
    return nullProto({ status })
  }
  if (status !== 'ok') {
    return refuse(providerName)
  }
  return nullProto({ status, entry: entryOf((raw as { entry?: unknown }).entry, providerName) })
}

/** The entry `get` answers with, copied by name; anything else as it is. */
function entryAnswer(value: unknown): unknown {
  return typeof value === 'object' && value !== null
    ? copyByName(value, ['code', 'expiresAt', 'attempts', 'maxAttempts', 'validated', 'metadata'])
    : value
}

/** The operations whose answer is checked, and how. The others answer nothing the library reads. */
const CHECKS: ReadonlyMap<string, (value: unknown, providerName: string) => unknown> = new Map<
  string,
  (value: unknown, providerName: string) => unknown
>([
  ['tryAcquireCooldown', strictBoolean],
  ['deleteIfCode', strictBoolean],
  ['get', entryAnswer],
  ['consumeAttempt', consumeResultOf],
  ['recordFailure', assertFailureCount]
])

/**
 * Checks the answer of a store operation.
 *
 * @param operation - The operation that answered.
 * @param value - What it resolved with.
 * @param providerName - The store's name, as the wrapper read it.
 * @returns The answer as the library reads it: the same boolean or count, a fresh result object.
 * @throws NotificationException `OTP_STORAGE_FAILED` when the answer is not of the kind.
 */
export function checkStoreResult(operation: string, value: unknown, providerName: string): unknown {
  const check = CHECKS.get(operation)
  return check === undefined ? value : check(value, providerName)
}

/**
 * Checks the answer of `isConfigured`.
 *
 * @param value - What the store answered.
 * @returns The boolean.
 * @throws NotificationException `OTP_STORAGE_NOT_CONFIGURED` when it is not a boolean.
 */
export function checkConfigured(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new NotificationException('OTP_STORAGE_NOT_CONFIGURED')
  }
  return value
}
