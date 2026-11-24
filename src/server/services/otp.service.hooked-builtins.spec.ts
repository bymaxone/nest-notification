/**
 * @fileoverview A wrong code is never accepted when a replaceable built-in, hooked to plant a forged
 * promise on its first call, runs anywhere on the verify path; and a promise the library started and
 * will not await never ends unhandled, whatever `Promise.prototype.constructor` answers.
 * @layer application
 */

import { silence } from '../utils/realm-root'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { OtpService } from './otp.service'
import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'

const PROTO = Promise.prototype
const REAL_CONSTRUCTOR = Object.getOwnPropertyDescriptor(PROTO, 'constructor') as PropertyDescriptor
const REAL_THEN = Object.getOwnPropertyDescriptor(PROTO, 'then') as PropertyDescriptor
const WRONG = '000000x'
const FORGED = {
  status: 'ok',
  entry: { code: WRONG, attempts: 1, maxAttempts: 5, expiresAt: Date.now() + 1_000_000 }
}

type Slot = { holder: Record<string, unknown>; name: string; label: string }
const SLOTS: Slot[] = [
  { holder: globalThis as never, name: 'setTimeout', label: 'setTimeout' },
  { holder: globalThis as never, name: 'clearTimeout', label: 'clearTimeout' },
  { holder: globalThis as never, name: 'queueMicrotask', label: 'queueMicrotask' },
  { holder: performance as never, name: 'now', label: 'performance.now' },
  { holder: Map.prototype as never, name: 'set', label: 'Map.prototype.set' },
  { holder: Array.prototype as never, name: 'push', label: 'Array.prototype.push' },
  { holder: Array.prototype as never, name: 'indexOf', label: 'Array.prototype.indexOf' },
  { holder: Array.prototype as never, name: 'includes', label: 'Array.prototype.includes' },
  { holder: Object as never, name: 'freeze', label: 'Object.freeze' },
  { holder: Date as never, name: 'now', label: 'Date.now' },
  { holder: Map.prototype as never, name: 'get', label: 'Map.prototype.get' }
]

function restorePromises(): void {
  Object.defineProperty(PROTO, 'constructor', REAL_CONSTRUCTOR)
  Object.defineProperty(PROTO, 'then', REAL_THEN)
}

/** The swap a hooked built-in performs: another constructor, a then that forges once, both restored. */
function plantForgery(): void {
  Object.defineProperty(PROTO, 'constructor', {
    value: function Fake() {
      /* never constructed */
    },
    writable: true,
    configurable: true
  })
  Object.defineProperty(PROTO, 'then', {
    value: function then(onFulfilled: (value: unknown) => unknown) {
      restorePromises()
      onFulfilled(FORGED)
    },
    writable: true,
    configurable: true
  })
}

describe('OtpService.verify with a built-in that plants a forgery on its first call', () => {
  afterEach(restorePromises)

  it.each(SLOTS.map((slot) => [slot.label, slot] as const))(
    'should not accept a wrong code when %s plants the forgery',
    async (_label, slot) => {
      const service = new OtpService(makeOptions(), new InMemoryOtpStorage(), makeAudit())
      await service.generate({ ...ref, deliverVia: 'manual' })
      const original = slot.holder[slot.name] as (...a: unknown[]) => unknown
      let armed = true
      slot.holder[slot.name] = function (this: unknown, ...args: unknown[]) {
        if (armed) {
          armed = false
          plantForgery()
        }
        return original.apply(this, args)
      }
      let outcome: string
      const unhandled: unknown[] = []
      const record = (reason: unknown): void => {
        unhandled.push(reason)
      }
      const saved = process.listeners('unhandledRejection')
      process.removeAllListeners('unhandledRejection')
      process.on('unhandledRejection', record)
      try {
        const result = await service.verify({ ...ref, code: WRONG })
        outcome = result.valid ? 'FORGED' : 'refused'
      } catch {
        outcome = 'threw'
      } finally {
        slot.holder[slot.name] = original
        restorePromises()
        await new Promise((resolve) => setTimeout(resolve, 5))
        process.removeListener('unhandledRejection', record)
        for (const listener of saved) {
          process.on('unhandledRejection', listener)
        }
      }

      expect(unhandled).toHaveLength(0)
      expect(outcome).not.toBe('FORGED')
    }
  )
})

describe('a promise the library started and will not await', () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason)
  }

  beforeEach(() => {
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
  })

  afterEach(() => {
    process.off('unhandledRejection', onUnhandled)
    restorePromises()
  })

  // `then` reads `constructor` of the promise it is called on, so a getter that throws would keep the
  // handler from being attached; the promise carries its own `constructor` instead.
  it('should not end unhandled when Promise.prototype.constructor throws', async () => {
    const rejecting = Promise.reject(new Error('library-own-rejection'))
    Object.defineProperty(PROTO, 'constructor', {
      configurable: true,
      get() {
        throw new Error('hostile')
      }
    })

    silence(rejecting)
    restorePromises()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(unhandled).toStrictEqual([])
  })

  it('should not end unhandled on a refused store call when the constructor throws', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(makeOptions(), storage, makeAudit())
    await service.generate({ ...ref, deliverVia: 'manual' })
    storage.consumeAttempt = (() => {
      Object.defineProperty(PROTO, 'constructor', {
        configurable: true,
        get() {
          throw new Error('hostile')
        }
      })
      return Promise.reject(new Error('store-rejection'))
    }) as never

    await expect(service.verify({ ...ref, code: WRONG })).rejects.toBeInstanceOf(Error)
    restorePromises()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(unhandled).toStrictEqual([])
  })
})
