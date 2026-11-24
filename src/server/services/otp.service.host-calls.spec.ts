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
