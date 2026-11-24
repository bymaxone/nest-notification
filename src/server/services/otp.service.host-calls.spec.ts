/**
 * @fileoverview The calls the verify path makes into host code and into replaceable built-ins are
 * not a way to forge an answer or to leave a rejection unhandled: the store's method is reached
 * through built-ins taken at load, a handler is attached without reading `Promise[Symbol.species]`,
 * and the host's audit promise is awaited only on a realm that was checked after the call.
 * @layer application
 */

import { types } from 'node:util'
import { NotificationException } from '../errors/notification-exception'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { own } from '../utils/realm-root'
import { OtpService } from './otp.service'
import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'

const WRONG = '000000x'
const PROTO = Promise.prototype
const REAL_CONSTRUCTOR = Object.getOwnPropertyDescriptor(PROTO, 'constructor') as PropertyDescriptor
const REAL_THEN = Object.getOwnPropertyDescriptor(PROTO, 'then') as PropertyDescriptor
const REAL_SPECIES = Object.getOwnPropertyDescriptor(Promise, Symbol.species) as PropertyDescriptor
const REAL_APPLY = Function.prototype.apply
const REAL_IS_PROXY = types.isProxy
const REAL_IS_PROMISE = types.isPromise

function restore(): void {
  Object.defineProperty(PROTO, 'constructor', REAL_CONSTRUCTOR)
  Object.defineProperty(PROTO, 'then', REAL_THEN)
  Object.defineProperty(Promise, Symbol.species, REAL_SPECIES)
  Function.prototype.apply = REAL_APPLY
  ;(types as { isProxy: unknown }).isProxy = REAL_IS_PROXY
  ;(types as { isPromise: unknown }).isPromise = REAL_IS_PROMISE
  delete (Array.prototype as unknown as Record<string, unknown>).then
}

async function liveService(storage = new InMemoryOtpStorage()): Promise<OtpService> {
  const service = new OtpService(makeOptions(), storage, makeAudit())
  await service.generate({ ...ref, deliverVia: 'manual' })
  return service
}

/** Runs `action` while recording what ends as an unhandled rejection. */
async function recordingUnhandled(action: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = []
  const record = (reason: unknown): void => {
    unhandled.push(reason)
  }
  const saved = process.listeners('unhandledRejection')
  process.removeAllListeners('unhandledRejection')
  process.on('unhandledRejection', record)
  try {
    await action()
    await new Promise((resolve) => setTimeout(resolve, 20))
  } finally {
    process.removeListener('unhandledRejection', record)
    for (const listener of saved) {
      process.on('unhandledRejection', listener)
    }
  }
  return unhandled
}

describe('OtpService.verify when a built-in is replaced while the store method is reached', () => {
  afterEach(restore)

  it('should not accept a wrong code when isProxy plants an apply that answers for the store', async () => {
    const storage = new InMemoryOtpStorage()
    const service = await liveService(storage)
    ;(types as { isProxy: unknown }).isProxy = (value: unknown): boolean => {
      // Armed on every read of a store method; the planted apply restores itself on its first use.
      if (value === storage) {
        Function.prototype.apply = function forger(
          this: Function,
          thisArg: unknown,
          args: unknown[]
        ) {
          Function.prototype.apply = REAL_APPLY
          if (this.name === 'consumeAttempt') {
            return Promise.resolve({
              status: 'ok',
              entry: { code: WRONG, attempts: 1, maxAttempts: 5, expiresAt: Date.now() + 1_000_000 }
            })
          }
          return Reflect.apply(this, thisArg, args)
        } as typeof Function.prototype.apply
      }
      return REAL_IS_PROXY(value)
    }

    const result = await service.verify({ ...ref, code: WRONG }).catch(() => ({ valid: false }))
    restore()

    expect(result.valid).toBe(false)
  })
})

describe('OtpService.verify when Promise[Symbol.species] throws on a refused store call', () => {
  afterEach(restore)

  it('should leave no rejection unhandled', async () => {
    const storage = new InMemoryOtpStorage()
    const service = await liveService(storage)
    storage.consumeAttempt = (() => {
      Object.defineProperty(Promise, Symbol.species, {
        configurable: true,
        get() {
          throw new Error('hostile species')
        }
      })
      ;(Array.prototype as unknown as Record<string, unknown>).then = undefined
      return Promise.reject(new Error('store-rejection'))
    }) as never

    const unhandled = await recordingUnhandled(async () => {
      await service.verify({ ...ref, code: WRONG }).catch(() => undefined)
      restore()
    })

    expect(unhandled).toStrictEqual([])
  })
})

describe('OtpService.verify when isPromise is replaced while a refused store call rejects', () => {
  afterEach(restore)

  it('should leave no rejection unhandled', async () => {
    const storage = new InMemoryOtpStorage()
    const service = await liveService(storage)
    storage.consumeAttempt = (() => {
      ;(types as { isPromise: unknown }).isPromise = () => false
      Object.defineProperty(PROTO, 'then', {
        value: function then() {
          /* planted */
        },
        writable: true,
        configurable: true
      })
      return Promise.reject(new Error('store-rejection'))
    }) as never

    const unhandled = await recordingUnhandled(async () => {
      await service.verify({ ...ref, code: WRONG }).catch(() => undefined)
      restore()
    })

    expect(unhandled).toStrictEqual([])
  })
})

describe('OtpService when the host audit call replaces the promises its own await goes through', () => {
  afterEach(restore)

  it.each([true, false])(
    'should refuse a verify whose audit call forged the await when swallowErrors is %s',
    async (swallowErrors) => {
      const audit = makeAudit()
      const options = makeOptions()
      const service = new OtpService(
        { ...options, audit: { ...options.audit, swallowErrors } },
        new InMemoryOtpStorage(),
        audit
      )
      await service.generate({ ...ref, deliverVia: 'manual' })
      audit.create.mockImplementation((() => {
        Object.defineProperty(PROTO, 'constructor', {
          value: function Fake() {
            /* never constructed */
          },
          writable: true,
          configurable: true
        })
        Object.defineProperty(PROTO, 'then', {
          value: function then(onFulfilled: (value: unknown) => unknown) {
            restore()
            onFulfilled(undefined)
          },
          writable: true,
          configurable: true
        })
        return Promise.resolve()
      }) as never)

      const outcome = await service
        .verify({ ...ref, code: WRONG })
        .then(() => 'resolved')
        .catch((error: { code?: string }) => error.code)

      restore()

      expect(outcome).toBe('notification.invalid_scope_identifier')
    }
  )
})

describe('OtpService when the host audit repository throws a library error', () => {
  it('should absorb it under swallowErrors, as it absorbs any other audit failure', async () => {
    const audit = makeAudit()
    audit.create.mockRejectedValue(new NotificationException('AUDIT_LOG_FAILED'))
    const service = new OtpService(makeOptions(), new InMemoryOtpStorage(), audit)

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).resolves.toBeDefined()
    await expect(service.verify({ ...ref, code: WRONG })).resolves.toMatchObject({ valid: false })
  })

  it('should throw a synchronous audit failure as AUDIT_LOG_FAILED when swallowErrors is off', async () => {
    const audit = makeAudit()
    audit.create.mockImplementation(() => {
      throw new Error('sync failure')
    })
    const options = makeOptions()
    const service = new OtpService(
      { ...options, audit: { ...options.audit, swallowErrors: false } },
      new InMemoryOtpStorage(),
      audit
    )

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).rejects.toMatchObject({
      code: 'notification.audit_log_failed'
    })
  })
})

describe('OtpService.generate when a host call plants a forgery while it runs', () => {
  afterEach(restore)

  it('should end refused, with nothing unhandled, when a throwing species rides a refused store call', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(makeOptions(), storage, makeAudit())
    storage.tryAcquireCooldown = (() => {
      Object.defineProperty(Promise, Symbol.species, {
        configurable: true,
        get() {
          throw new Error('hostile species')
        }
      })
      return Promise.reject(new Error('store-rejection'))
    }) as never

    let code: string | undefined
    const unhandled = await recordingUnhandled(async () => {
      // The runner attaches to the test's promise at its first suspension; plant after it.
      await new Promise((resolve) => setTimeout(resolve, 0))
      try {
        await service.generate({ ...ref, deliverVia: 'manual' })
        code = 'resolved'
      } catch (error) {
        code = (error as { code?: string }).code
      } finally {
        restore()
      }
    })

    expect(unhandled).toStrictEqual([])
    expect(code).not.toBe('resolved')
  })

  it('should not resolve when the audit call plants a then that answers for the await', async () => {
    const audit = makeAudit()
    const service = new OtpService(makeOptions(), new InMemoryOtpStorage(), audit)
    audit.create.mockImplementation((() => {
      Object.defineProperty(PROTO, 'constructor', {
        value: function Fake() {
          /* never constructed */
        },
        writable: true,
        configurable: true
      })
      Object.defineProperty(PROTO, 'then', {
        value: function then(onFulfilled: (value: unknown) => unknown) {
          restore()
          onFulfilled(undefined)
        },
        writable: true,
        configurable: true
      })
      return Promise.resolve()
    }) as never)

    const outcome = await service
      .generate({ ...ref, deliverVia: 'manual' })
      .then(() => 'resolved')
      .catch((error: { code?: string }) => error.code)

    expect(outcome).toBe('notification.invalid_scope_identifier')
  })
})

describe('a promise the library pins for its own await', () => {
  it('should refuse a promise whose constructor cannot be attached, never hand it back', () => {
    const frozen = Object.freeze(Promise.resolve(1))

    expect(() => own(frozen)).toThrow(
      expect.objectContaining({ code: 'notification.invalid_scope_identifier' })
    )
  })

  it('should keep its own constructor against a host that holds the promise', async () => {
    const pinned = own(Promise.resolve(1))

    expect(() =>
      Object.defineProperty(pinned, 'constructor', {
        value: function Fake() {},
        configurable: true
      })
    ).toThrow(TypeError)
    expect(() => {
      ;(pinned as unknown as { constructor: unknown }).constructor = undefined
    }).toThrow(TypeError)
    await expect(pinned).resolves.toBe(1)
  })

  it('should still absorb the rejection of a pinned promise when species throws', async () => {
    const pinned = own(Promise.reject(new Error('late')))
    const { silence } = await import('../utils/realm-root')
    Object.defineProperty(Promise, Symbol.species, {
      configurable: true,
      get() {
        throw new Error('hostile species')
      }
    })
    const unhandled = await recordingUnhandled(async () => {
      silence(pinned)
      restore()
    })

    expect(unhandled).toStrictEqual([])
  })
})

describe('OtpService.generate when the audit call on a refused branch plants a forgery', () => {
  afterEach(restore)

  function plantOnAudit(audit: ReturnType<typeof makeAudit>): void {
    audit.create.mockImplementation((() => {
      Object.defineProperty(PROTO, 'constructor', {
        value: function Fake() {
          /* never constructed */
        },
        writable: true,
        configurable: true
      })
      Object.defineProperty(PROTO, 'then', {
        value: function then(onFulfilled: (value: unknown) => unknown) {
          restore()
          onFulfilled(undefined)
        },
        writable: true,
        configurable: true
      })
      return Promise.resolve()
    }) as never)
  }

  it('should end refused with nothing unhandled on the cooldown_blocked branch', async () => {
    const audit = makeAudit()
    const service = new OtpService(makeOptions(), new InMemoryOtpStorage(), audit)
    await service.generate({ ...ref, deliverVia: 'manual' })
    plantOnAudit(audit)

    let outcome: string | undefined
    const unhandled = await recordingUnhandled(async () => {
      outcome = await service.generate({ ...ref, deliverVia: 'manual' }).then(
        () => 'resolved',
        (error: { code?: string }) => error.code
      )
      restore()
    })

    expect(unhandled).toStrictEqual([])
    expect(outcome).toBe('notification.invalid_scope_identifier')
  })

  it('should end refused with nothing unhandled on the failed delivery branch', async () => {
    const audit = makeAudit()
    const service = new OtpService(makeOptions(), new InMemoryOtpStorage(), audit)
    ;(service as unknown as { deliverOtp: () => Promise<void> }).deliverOtp = () =>
      Promise.reject(new Error('delivery down'))
    plantOnAudit(audit)

    let outcome: string | undefined
    const unhandled = await recordingUnhandled(async () => {
      outcome = await service.generate({ ...ref, deliverVia: 'email' }).then(
        () => 'resolved',
        (error: { code?: string }) => error.code
      )
      restore()
    })

    expect(unhandled).toStrictEqual([])
    expect(outcome).toBe('notification.invalid_scope_identifier')
  })
})
