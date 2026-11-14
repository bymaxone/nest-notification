/**
 * @fileoverview Answers a store outage with the code a caller can act on.
 * @layer utils
 *
 * `IOtpStorage` is implemented by the host or by a reference adapter over Redis, and when its
 * backing service cannot be reached it rejects with whatever that client rejects with. Left alone
 * that reaches the HTTP layer as an unclassified 500. {@link withStorageFailures} wraps every
 * operation of a store so an outage becomes `OTP_STORAGE_UNAVAILABLE` (503), with the original
 * error kept as the log-safe `cause`, and every other failure passes through as the same object.
 */

import { NotificationException } from '../errors/notification-exception'
import type { IOtpStorage } from '../interfaces/otp-storage.interface'
import { isUnavailableError } from './availability'

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
 * Turns a failure of the store into what the caller should see.
 *
 * @param storage - The store that failed.
 * @param error - What the operation rejected with.
 * @returns A `NotificationException` for an outage; the same `error` for anything else.
 */
function translate(storage: IOtpStorage, error: unknown): unknown {
  if (error instanceof NotificationException || !isUnavailableError(error)) {
    return error
  }
  return new NotificationException(
    'OTP_STORAGE_UNAVAILABLE',
    { providerName: storage.name },
    { cause: error }
  )
}

/**
 * Wraps a store so an outage of its backing service is reported as `OTP_STORAGE_UNAVAILABLE`.
 *
 * The wrapper has exactly the operations the store has: an optional operation the store does not
 * implement is absent from the wrapper too, so the checks that look for it still see the truth.
 * Each call reads the store's method when it is made, not when the wrapper is built.
 *
 * @param storage - The store to wrap.
 * @returns A store with the same name, the same operations and the translated failures.
 */
export function withStorageFailures(storage: IOtpStorage): IOtpStorage {
  const wrapped: Record<string, unknown> = {
    name: storage.name,
    isConfigured: (): boolean => storage.isConfigured()
  }
  for (const operation of OPERATIONS) {
    if (typeof Reflect.get(storage, operation) !== 'function') {
      continue
    }
    Object.defineProperty(wrapped, operation, {
      enumerable: true,
      value: async (...args: unknown[]): Promise<unknown> => {
        try {
          return await (
            Reflect.get(storage, operation) as (...a: unknown[]) => Promise<unknown>
          ).apply(storage, args)
        } catch (error) {
          throw translate(storage, error)
        }
      }
    })
  }
  return wrapped as unknown as IOtpStorage
}
