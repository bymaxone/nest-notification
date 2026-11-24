/**
 * @fileoverview A wrong code is never accepted, whatever the realm does to the promises the verdict
 * is awaited through: a constructor that answers for one `await`, a `then` that forges the value, a
 * `then` on a root prototype that erases itself when read.
 * @layer application
 */

import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { OtpService } from './otp.service'
import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'

const INTRINSIC_THEN = Promise.prototype.then
const INTRINSIC_CONSTRUCTOR = Object.getOwnPropertyDescriptor(
  Promise.prototype,
  'constructor'
) as PropertyDescriptor
const WRONG = '000000x'

/** What a forged `consumeAttempt` answers: a live entry whose code is the guess. */
const FORGED_CONSUME = {
  status: 'ok',
  entry: { code: WRONG, attempts: 1, maxAttempts: 5, expiresAt: Date.now() + 1_000_000 }
}

function restore(): void {
  Promise.prototype.then = INTRINSIC_THEN
  Object.defineProperty(Promise.prototype, 'constructor', INTRINSIC_CONSTRUCTOR)
  delete (Object.prototype as Record<string, unknown>).then
  delete (Array.prototype as unknown as Record<string, unknown>).then
  delete (Function.prototype as unknown as Record<string, unknown>).then
}

async function liveService(): Promise<OtpService> {
  const service = new OtpService(makeOptions(), new InMemoryOtpStorage(), makeAudit())
  await service.generate({ ...ref, deliverVia: 'manual' })
  return service
}

/** The outcome of a verify with the wrong code: never `valid: true` is the whole claim. */
async function verifyWrong(service: OtpService): Promise<string> {
  try {
    const result = await service.verify({ ...ref, code: WRONG })
    return result.valid ? 'FORGED' : 'refused'
  } catch {
    return 'threw'
  }
}

describe('OtpService.verify against a forged promise', () => {
  afterEach(restore)

  // `await` reads `constructor` when it is evaluated: a getter that answers with another constructor
  // for the Nth read, and restores itself, sends that await through `then`, which is then forged.
  it.each(Array.from({ length: 30 }, (_unused, index) => index + 1))(
    'should not accept a wrong code when the constructor read number %i answers for the await',
    async (nth) => {
      const service = await liveService()
      let reads = 0
      let armed = false
      Object.defineProperty(Promise.prototype, 'constructor', {
        configurable: true,
        get() {
          reads += 1
          if (reads === nth) {
            armed = true
            return Object
          }
          return Promise
        }
      })
      Promise.prototype.then = function (
        this: Promise<unknown>,
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        if (armed) {
          armed = false
          return INTRINSIC_THEN.call(
            this,
            () => (onFulfilled ? onFulfilled(FORGED_CONSUME) : undefined),
            onRejected
          )
        }
        return INTRINSIC_THEN.call(this, onFulfilled, onRejected)
      } as typeof Promise.prototype.then

      const outcome = await verifyWrong(service)
      restore()

      expect(outcome).not.toBe('FORGED')
    }
  )

  // A `then` already on the root when the call starts is refused before anything is read.
  it('should refuse at the entry while a then is planted on the root', async () => {
    const service = await liveService()
    Object.defineProperty(Object.prototype, 'then', {
      configurable: true,
      get: () => undefined
    })

    const outcome = await verifyWrong(service)
    restore()

    expect(outcome).toBe('threw')
  })

  // A `then` on Array.prototype or Function.prototype answers for every array and function the
  // library resolves with, so it is refused like the one on the root.
  it.each([
    ['Array.prototype', Array.prototype],
    ['Function.prototype', Function.prototype]
  ])('should refuse at the entry while a then is planted on %s', async (_label, holder) => {
    const service = await liveService()
    Object.defineProperty(holder, 'then', { configurable: true, get: () => undefined })

    const outcome = await verifyWrong(service)
    restore()

    expect(outcome).toBe('threw')
  })

  // A `then` on the root that lands after the entry check and erases itself when read: the read
  // happens when an object is resolved, and the value it forges is what the awaiter gets.
  it.each(
    Array.from({ length: 10 }, (_unused, call) =>
      [1, 2, 3, 4].map((ticks) => [call + 1, ticks] as const)
    ).flat()
  )(
    'should not accept a wrong code when a self-erasing then lands after storage call %i, %i ticks later',
    async (call, ticks) => {
      const storage = new InMemoryOtpStorage()
      const service = new OtpService(makeOptions(), storage, makeAudit())
      await service.generate({ ...ref, deliverVia: 'manual' })
      let calls = 0
      const plant = (): void => {
        Object.defineProperty(Object.prototype, 'then', {
          configurable: true,
          get() {
            delete (Object.prototype as Record<string, unknown>).then
            return (resolve: (value: unknown) => void) => resolve(FORGED_CONSUME)
          }
        })
      }
      for (const name of [
        'get',
        'consumeAttempt',
        'recordFailure',
        'getFailures',
        'deleteIfCode',
        'update',
        'delete',
        'clearFailures',
        'clearCooldown'
      ] as const) {
        const original = (storage as unknown as Record<string, (...a: unknown[]) => unknown>)[name]
        if (typeof original !== 'function') {
          continue
        }
        ;(storage as unknown as Record<string, unknown>)[name] = function (
          this: unknown,
          ...args: unknown[]
        ) {
          calls += 1
          if (calls === call) {
            let hops = ticks
            const step = (): void => {
              if (hops-- > 0) {
                void Promise.resolve().then(step)
              } else {
                plant()
              }
            }
            step()
          }
          return original.apply(storage, args)
        }
      }

      const outcome = await verifyWrong(service)
      restore()

      expect(outcome).not.toBe('FORGED')
    }
  )

  // `getStatus` awaits two answers, one after the other, each behind the check of the wrapper.
  it('should refuse getStatus while a then is planted on the root', async () => {
    const service = await liveService()
    Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => undefined })

    const outcome = service.getStatus({ ...ref })
    restore()

    await expect(outcome).rejects.toBeInstanceOf(Error)
  })

  it('should answer getStatus from a real entry when nothing is planted', async () => {
    const service = await liveService()

    await expect(service.getStatus({ ...ref })).resolves.toMatchObject({ exists: true })
  })

  // A realm that replaces and then restores the constructor of the promises between two awaits.
  it('should not accept a wrong code when the constructor is replaced and restored', async () => {
    const service = await liveService()
    Object.defineProperty(Promise.prototype, 'constructor', {
      configurable: true,
      value: Object
    })
    const first = await verifyWrong(service)
    restore()

    expect(first).not.toBe('FORGED')
    await expect(service.verify({ ...ref, code: WRONG })).resolves.toMatchObject({ valid: false })
  })

  // Fake timers replace the timer globals and `Date`; they leave the promises alone, so a verify
  // under them is not refused.
  it('should verify under fake timers with the promises untouched', async () => {
    jest.useFakeTimers()
    try {
      const service = await liveService()

      await expect(service.verify({ ...ref, code: WRONG })).resolves.toMatchObject({ valid: false })
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('OtpService.verify when the refusal comes with a store that answers without a promise', () => {
  afterEach(restore)

  // The promise a store returned is silenced on the refusal path; a store that answers with a plain
  // value has nothing to silence, and the refusal is the same.
  it('should refuse when the store answers synchronously and a then is planted meanwhile', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(makeOptions(), storage, makeAudit())
    await service.generate({ ...ref, deliverVia: 'manual' })
    const original = storage.consumeAttempt.bind(storage)
    storage.consumeAttempt = ((...args: Parameters<typeof original>) => {
      Object.defineProperty(Object.prototype, 'then', { configurable: true, get: () => undefined })
      return { status: 'not_found' } as never
    }) as typeof original
    void original

    const outcome = await verifyWrong(service)
    restore()

    expect(outcome).toBe('threw')
  })
})

describe('OtpService.generate when the realm changes while the cooldown is being taken', () => {
  afterEach(restore)

  // The store takes the lock, the wrapper refuses before it reads the answer: the lock is given back,
  // so the recipient can generate once the root is clean.
  it('should release the cooldown the store took and refuse', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(makeOptions(), storage, makeAudit())
    const take = storage.tryAcquireCooldown.bind(storage)
    let first = true
    storage.tryAcquireCooldown = ((...args: Parameters<typeof take>) => {
      if (first) {
        first = false
        Object.defineProperty(Object.prototype, 'then', {
          configurable: true,
          get: () => undefined
        })
      }
      return take(...args)
    }) as typeof take

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).rejects.toBeInstanceOf(Error)
    restore()

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).resolves.toMatchObject({
      cooldownSeconds: expect.any(Number)
    })
  })

  it('should not touch the cooldown when the store itself fails', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(makeOptions(), storage, makeAudit())
    const clear = jest.spyOn(storage, 'clearCooldown')
    storage.tryAcquireCooldown = (() => Promise.reject(new Error('down'))) as never

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).rejects.toBeInstanceOf(Error)

    expect(clear).not.toHaveBeenCalled()
  })
})
