/**
 * @fileoverview Holds `OtpService` to answering 503 when its store cannot be reached, whichever
 * operation met the outage, and to leaving every other failure exactly as it was. The error
 * values are those a real ioredis 6.0.0 client rejected with (see `availability.spec.ts`).
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'
import type { IOtpStorage } from '../interfaces/otp-storage.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

const CLOSED = (): Error => new Error('Connection is closed.')
const base = { ...ref, deliverVia: 'manual' as const }

/** An in-memory store with named operations replaced by ones that fail. */
function failing(overrides: Partial<Record<keyof IOtpStorage, () => Promise<never>>>): IOtpStorage {
  const inner = new InMemoryOtpStorage()
  return new Proxy(inner, {
    get(target, property) {
      const replacement = overrides[property as keyof IOtpStorage]
      if (replacement) {
        return replacement
      }
      const value = Reflect.get(target, property, target) as unknown
      return typeof value === 'function' ? value.bind(target) : value
    }
  }) as IOtpStorage
}

async function catching(call: Promise<unknown>): Promise<unknown> {
  return call.catch((error: unknown) => error)
}

describe('OtpService when the store is unavailable', () => {
  it.each([
    [
      'generate (cooldown)',
      (s: OtpService) => s.generate(base),
      { tryAcquireCooldown: () => Promise.reject(CLOSED()) }
    ],
    [
      'generate (store)',
      (s: OtpService) => s.generate(base),
      { set: () => Promise.reject(CLOSED()) }
    ],
    [
      'verify',
      (s: OtpService) => s.verify({ ...ref, code: '123456' }),
      { get: () => Promise.reject(CLOSED()) }
    ],
    ['getStatus', (s: OtpService) => s.getStatus(ref), { get: () => Promise.reject(CLOSED()) }],
    ['consume', (s: OtpService) => s.consume(ref), { delete: () => Promise.reject(CLOSED()) }]
  ] as const)('should answer 503 from %s', async (_name, run, failure) => {
    const service = new OtpService(makeOptions({}), failing(failure), makeAudit())

    const caught = await catching(run(service))

    expect(caught).toBeInstanceOf(NotificationException)
    expect(caught).toMatchObject({ code: 'notification.otp_storage_unavailable' })
    expect((caught as NotificationException).getStatus()).toBe(503)
  })

  // Past the first read the failure counter and the attempt are separate calls to the store.
  it.each(['recordFailure', 'consumeAttempt'] as const)(
    'should answer 503 when %s meets the outage on a live code',
    async (operation) => {
      const inner = new InMemoryOtpStorage()
      await inner.set(ref.tenantId, ref.recipient, ref.purpose, {
        code: '123456',
        expiresAt: Date.now() + 60_000,
        attempts: 0,
        maxAttempts: 5
      })
      const store = new Proxy(inner, {
        get(target, property) {
          if (property === operation) return () => Promise.reject(CLOSED())
          const value = Reflect.get(target, property, target) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        }
      }) as IOtpStorage
      const service = new OtpService(makeOptions({}), store, makeAudit())

      expect(await catching(service.verify({ ...ref, code: '123456' }))).toMatchObject({
        code: 'notification.otp_storage_unavailable'
      })
    }
  )

  it('should not put the storage error text into the response, and keep it as the cause', async () => {
    const error = new Error('Connection is closed.')
    const service = new OtpService(
      makeOptions({}),
      failing({ set: () => Promise.reject(error) }),
      makeAudit()
    )

    const caught = (await catching(service.generate(base))) as NotificationException

    expect(JSON.stringify(caught.getResponse())).not.toContain('Connection is closed')
    expect((caught.cause as Error).message).toBe('Connection is closed.')
  })

  // A failed set after the cooldown was taken must still release it, and the answer is still 503.
  it('should release the cooldown it took when the store goes away mid-request', async () => {
    const inner = new InMemoryOtpStorage()
    const store = new Proxy(inner, {
      get(target, property) {
        if (property === 'set') return () => Promise.reject(CLOSED())
        const value = Reflect.get(target, property, target) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      }
    }) as IOtpStorage
    const service = new OtpService(makeOptions({}), store, makeAudit())

    const caught = await catching(service.generate(base))

    expect(caught).toMatchObject({ code: 'notification.otp_storage_unavailable' })
    expect(await inner.getCooldown(ref.tenantId, ref.recipient, ref.purpose)).toBe(0)
  })

  it('should still answer 503 when releasing the cooldown fails as well', async () => {
    const service = new OtpService(
      makeOptions({}),
      failing({
        set: () => Promise.reject(CLOSED()),
        clearCooldown: () => Promise.reject(CLOSED())
      }),
      makeAudit()
    )

    expect(await catching(service.generate(base))).toMatchObject({
      code: 'notification.otp_storage_unavailable'
    })
  })
})

describe('OtpService when the store fails for another reason', () => {
  it('should let a defect through unchanged, as the same object', async () => {
    const defect = new TypeError("Cannot read properties of undefined (reading 'get')")
    const service = new OtpService(
      makeOptions({}),
      failing({ set: () => Promise.reject(defect) }),
      makeAudit()
    )

    expect(await catching(service.generate(base))).toBe(defect)
  })

  it('should let a Redis reply that names a fault through unchanged', async () => {
    class ReplyError extends Error {
      override name = 'ReplyError'
    }
    const reply = new ReplyError('NOAUTH Authentication required.')
    const service = new OtpService(
      makeOptions({}),
      failing({ set: () => Promise.reject(reply) }),
      makeAudit()
    )

    expect(await catching(service.generate(base))).toBe(reply)
  })

  it('should let a NotificationException the store raises through unchanged', async () => {
    const own = new NotificationException('INVALID_SCOPE_IDENTIFIER', { reason: 'x' })
    const service = new OtpService(
      makeOptions({}),
      failing({ set: () => Promise.reject(own) }),
      makeAudit()
    )

    expect(await catching(service.generate(base))).toBe(own)
  })
})

describe('OtpService around the store it is given', () => {
  it('should keep the optional methods exactly as the store has them', async () => {
    const inner = new InMemoryOtpStorage()
    const calls: string[] = []
    const spied = new Proxy(inner, {
      get(target, property) {
        const value = Reflect.get(target, property, target) as unknown
        if (typeof property === 'string' && typeof value === 'function') {
          return (...args: unknown[]) => {
            calls.push(property)
            return (value as (...a: unknown[]) => unknown).apply(target, args)
          }
        }
        return value
      }
    }) as IOtpStorage
    const service = new OtpService(makeOptions({ consumeOnVerify: true }), spied, makeAudit())

    await service.generate(base)

    expect(calls).toEqual(expect.arrayContaining(['tryAcquireCooldown', 'set']))
  })
})
