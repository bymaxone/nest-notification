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

  // The name is read once, when the store is wrapped: a getter that answers differently later
  // cannot make the error name a different store than the wrapper does.
  it('should name the store in the error as the wrapper named it, whatever the getter answers later', async () => {
    const store = new InMemoryOtpStorage()
    let reads = 0
    Object.defineProperty(store, 'name', {
      configurable: true,
      get: () => `store-${(reads += 1)}`
    })
    Object.assign(store, { get: () => Promise.reject(new Error('Connection is closed.')) })

    const wrapped = withStorageFailures(store)
    const caught = (await wrapped.get('t', 'r', 'p').catch((error: unknown) => error)) as {
      getResponse(): unknown
    }

    expect(wrapped.name).toBe('store-1')
    expect(caught.getResponse()).toMatchObject({ error: { details: { providerName: 'store-1' } } })
    expect(reads).toBe(1)
  })

  // Every operation the wrapper covers answers every way a method can fail with the same code, and
  // the host's text is in the cause and never in the message or the body.
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
  const WAYS: ReadonlyArray<[string, (store: InMemoryOtpStorage, operation: string) => void]> = [
    [
      'rejects',
      (store, operation) =>
        Object.assign(store, { [operation]: () => Promise.reject(new Error('host text')) })
    ],
    [
      'throws before it returns a promise',
      (store, operation) =>
        Object.assign(store, {
          [operation]: () => {
            throw new Error('host text')
          }
        })
    ],
    [
      'cannot be read',
      (store, operation) =>
        Object.defineProperty(store, operation, {
          configurable: true,
          get: () => {
            throw new Error('host text')
          }
        })
    ]
  ]
  describe.each(OPERATIONS)('%s', (operation) => {
    it.each(WAYS)('should answer OTP_STORAGE_FAILED when it %s', async (_way, break_) => {
      const store = new InMemoryOtpStorage()
      break_(store, operation)
      const call = Reflect.get(withStorageFailures(store), operation) as (
        ...args: unknown[]
      ) => Promise<unknown>

      const caught = (await call('t', 'r', 'p').catch((error: unknown) => error)) as {
        message: string
        cause: Error
        getResponse(): unknown
      }

      expect(caught).toMatchObject({ code: 'notification.otp_storage_failed' })
      expect(caught.cause.message).toBe('host text')
      expect(caught.message).not.toContain('host text')
      expect(JSON.stringify(caught.getResponse())).not.toContain('host text')
    })
  })

  it('should refuse with OTP_STORAGE_NOT_CONFIGURED and the cause when isConfigured throws', () => {
    const store = new InMemoryOtpStorage()
    store.isConfigured = () => {
      throw new Error('isConfigured of the host')
    }

    let caught: unknown
    try {
      withStorageFailures(store).isConfigured()
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ code: 'notification.otp_storage_not_configured' })
    expect((caught as { cause: Error }).cause.message).toBe('isConfigured of the host')
    expect((caught as Error).message).not.toContain('host')
  })
})

describe('a key planted on the realm root under the name of a field of a descriptor', () => {
  afterEach(() => {
    Reflect.deleteProperty(Object.prototype, 'get')
  })

  it('should wrap the operations of a store as before when get is planted', () => {
    Object.defineProperty(Object.prototype, 'get', {
      value: () => 'planted',
      configurable: true,
      writable: true
    })

    const wrapped = withStorageFailures(new InMemoryOtpStorage())

    expect(typeof Object.getOwnPropertyDescriptor(wrapped, 'set')?.value).toBe('function')
  })
})
