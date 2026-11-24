/**
 * @fileoverview Answers a store outage with the code a caller can act on.
 * @layer utils
 *
 * `IOtpStorage` is implemented by the host or by a reference adapter over Redis, and when it fails
 * it rejects with whatever that client or that code rejects with. Left alone that reaches the HTTP
 * layer as an unclassified 500 carrying the host's own object. {@link withStorageFailures} wraps
 * every operation of a store so an outage becomes `OTP_STORAGE_UNAVAILABLE` (503) and any other
 * failure of it, a rejection, a throw or a method that cannot be read, becomes `OTP_STORAGE_FAILED`
 * (500), each with the original error kept as the log-safe `cause`. The library's own errors
 * pass through as the same object.
 */

import { NotificationException } from '../errors/notification-exception'
import type { IOtpStorage } from '../interfaces/otp-storage.interface'
import { isUnavailableError } from './availability'
import { readHostName } from './host-name'
import { isLibraryError } from './is-library-error'
import { nullProto, readName } from './read-options'
import { assertStandardRealmRoot, own, silence } from './realm-root'
import { checkConfigured, checkStoreResult } from './store-results'

// Taken at load: a `Function.prototype.apply` replaced later does not run the store's method.
const apply = Reflect.apply

/** The operations of an `IOtpStorage` that return a promise, required and optional alike. */
const OPERATIONS = [
  'set',
  'get',
  'consumeAttempt',
  'update',
  'delete',
  'deleteIfCode',
  'tryAcquireCooldown',
  'getCooldown',
  'clearCooldown',
  'getFailures',
  'recordFailure',
  'clearFailures'
] as const

/**
 * The operations of `IOtpStorage` that {@link OPERATIONS} does not name. It is `never` while the
 * list covers the interface, and a spec fails to compile when it is not, so an operation added to
 * the interface cannot be left out of the wrapper without anyone noticing.
 */
export type UncoveredStorageOperation = Exclude<
  keyof IOtpStorage,
  'name' | 'isConfigured' | (typeof OPERATIONS)[number]
>

/**
 * Whether the store has the operation. One whose getter throws is counted as having it, so a
 * call fails with `OTP_STORAGE_FAILED` each time it is made, where leaving it out would let a
 * broken store look like one that does not carry the operation.
 */
function hasOperation(storage: IOtpStorage, operation: string): boolean {
  try {
    return typeof readName(storage, operation) === 'function'
  } catch {
    return true
  }
}

/**
 * Turns a failure of the store into what the caller should see.
 *
 * @param name - The store's name as the wrapper read it when the store was wrapped.
 * @param error - What the operation rejected with.
 * @returns The same `error` when it is already the library's own; otherwise a `NotificationException`
 *   that keeps it as the cause.
 */
function translate(name: string, error: unknown): unknown {
  if (isLibraryError(error)) {
    return error
  }
  if (isUnavailableError(error)) {
    return new NotificationException(
      'OTP_STORAGE_UNAVAILABLE',
      { providerName: name },
      { cause: error }
    )
  }
  return new NotificationException('OTP_STORAGE_FAILED', { providerName: name }, { cause: error })
}

/**
 * Runs one operation of the store and answers with a native promise the caller can await. The realm
 * root is checked after the store's method was called and before its promise is awaited, and again
 * before this function returns, so the caller's own `await` follows a check with nothing between: a
 * `then` or a `constructor` planted on the promises cannot answer for either await. The answer is a
 * primitive or an object with no prototype, so resolving with it reads no `then`.
 */
function guardedCall(
  operation: string,
  storage: IOtpStorage,
  name: string,
  args: unknown[]
): Promise<unknown> {
  const run = async (): Promise<unknown> => {
    try {
      const pending = apply(
        readName(storage, operation) as (...a: unknown[]) => unknown,
        storage,
        args
      )
      try {
        assertStandardRealmRoot('OtpService')
      } catch (refusal) {
        // The promise the store returned is never awaited on this path: it must not end unhandled.
        silence(pending)
        throw refusal
      }
      return checkStoreResult(operation, await pending, name)
    } catch (error) {
      throw translate(name, error)
    }
  }
  const promise = own(run())
  try {
    assertStandardRealmRoot('OtpService')
  } catch (error) {
    // The refusal is what the caller sees; the promise that was started is not left unhandled.
    silence(promise)
    throw error
  }
  return promise
}

/**
 * Wraps a store so a failure of it is reported as `OTP_STORAGE_UNAVAILABLE` or `OTP_STORAGE_FAILED`.
 *
 * The wrapper has exactly the operations the store has: an optional operation the store does not
 * implement is absent from the wrapper too, so the checks that look for it still see the truth.
 * Each call reads the store's method when it is made, not when the wrapper is built.
 *
 * @param storage - The store to wrap.
 * @returns A store with the same name, the same operations and the translated failures.
 */
export function withStorageFailures(storage: IOtpStorage): IOtpStorage {
  // The name is read once, here, so every line, error and audit entry that names the store carries
  // the same bounded, escaped text and never the host's getter.
  const name = readHostName(() => storage.name)
  // No prototype: an operation the store does not have must stay absent, whatever the realm root holds.
  const wrapped = nullProto<Record<string, unknown>>({
    name,
    // A store that cannot say whether it is configured is answered with the refusal, its own error
    // the cause, and never with a quieter path.
    isConfigured: (): boolean => {
      try {
        return checkConfigured(storage.isConfigured())
      } catch (error) {
        throw new NotificationException('OTP_STORAGE_NOT_CONFIGURED', undefined, { cause: error })
      }
    }
  })
  for (const operation of OPERATIONS) {
    if (!hasOperation(storage, operation)) {
      continue
    }
    Object.defineProperty(
      wrapped,
      operation,
      nullProto({
        enumerable: true,
        value: (...args: unknown[]): Promise<unknown> => guardedCall(operation, storage, name, args)
      })
    )
  }
  return wrapped as unknown as IOtpStorage
}
