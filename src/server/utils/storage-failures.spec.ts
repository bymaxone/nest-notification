/**
 * @fileoverview Holds `withStorageFailures` to the store it wraps: the same name, the same
 * operations and no others, and an outage answered with `OTP_STORAGE_UNAVAILABLE` carrying the
 * store's name and the original error.
 * @layer utils
 */

import type { IOtpStorage } from '../interfaces/otp-storage.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { withStorageFailures, type UncoveredStorageOperation } from './storage-failures'

/** Compiles only while the type is exactly `never`. */
type Expect<T extends true> = T
type IsNever<T> = [T] extends [never] ? true : false
type _EveryOperationIsWrapped = Expect<IsNever<UncoveredStorageOperation>>

describe('withStorageFailures', () => {
  it('should keep the name and the operations the store has, and no others', () => {
    const wrapped = withStorageFailures(new InMemoryOtpStorage())

    expect(wrapped.name).toBe('memory')
    expect(Object.keys(wrapped).sort()).toEqual(
      [
        'clearCooldown',
        'clearFailures',
        'consumeAttempt',
        'delete',
        'deleteIfCode',
        'get',
        'getCooldown',
        'getFailures',
        'isConfigured',
        'name',
        'recordFailure',
        'set',
        'tryAcquireCooldown',
        'update'
      ].sort()
    )
  })

  it('should leave out an optional operation the store does not implement', () => {
    const inner = new InMemoryOtpStorage()
    const bare = {
      name: 'bare',
      isConfigured: () => true,
      set: inner.set.bind(inner),
      get: inner.get.bind(inner),
      consumeAttempt: inner.consumeAttempt.bind(inner),
      update: inner.update.bind(inner),
      delete: inner.delete.bind(inner),
      tryAcquireCooldown: inner.tryAcquireCooldown.bind(inner),
      getCooldown: inner.getCooldown.bind(inner),
      clearCooldown: inner.clearCooldown.bind(inner)
    } as IOtpStorage

    const wrapped = withStorageFailures(bare)

    expect(wrapped.deleteIfCode).toBeUndefined()
    expect(wrapped.getFailures).toBeUndefined()
    expect('recordFailure' in wrapped).toBe(false)
  })

  it('should name the store and keep the original error as the cause when it is unavailable', async () => {
    const original = new Error('Connection is closed.')
    const store = { ...new InMemoryOtpStorage(), name: 'redis' } as unknown as IOtpStorage
    Object.assign(store, { isConfigured: () => true, get: () => Promise.reject(original) })

    const caught = (await withStorageFailures(store)
      .get('t', 'r', 'p')
      .catch((error: unknown) => error)) as { getResponse(): unknown; cause: unknown }

    expect(caught.getResponse()).toMatchObject({
      error: { code: 'notification.otp_storage_unavailable', details: { providerName: 'redis' } }
    })
    expect((caught.cause as Error).message).toBe('Connection is closed.')
  })
})
