/**
 * @fileoverview Holds `OtpService` to refusing a purpose that is not a plain name at every entry
 * point, before any store call, cooldown or audit entry exists. The store given to the service
 * counts its calls.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'
import type { IOtpStorage } from '../interfaces/otp-storage.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

/** An in-memory store that counts every call made to it. */
function counting(): { storage: IOtpStorage; calls: () => number } {
  const inner = new InMemoryOtpStorage()
  let calls = 0
  const storage = new Proxy(inner, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown
      if (typeof value !== 'function') {
        return value
      }
      return (...args: unknown[]) => {
        calls += 1
        return (value as (...a: unknown[]) => unknown).apply(target, args)
      }
    }
  }) as IOtpStorage
  return { storage, calls: () => calls }
}

const BAD = ['', 'a'.repeat(65), 'a b', 'auth.login', 'a/b', 'a\nb', '\u00E9']

describe('OtpService and the purpose', () => {
  it.each([
    [
      'generate',
      (s: OtpService, purpose: string) => s.generate({ ...ref, purpose, deliverVia: 'manual' })
    ],
    ['verify', (s: OtpService, purpose: string) => s.verify({ ...ref, purpose, code: '123456' })],
    ['consume', (s: OtpService, purpose: string) => s.consume({ ...ref, purpose })],
    ['getStatus', (s: OtpService, purpose: string) => s.getStatus({ ...ref, purpose })],
    [
      'resend',
      (s: OtpService, purpose: string) => s.resend({ ...ref, purpose, deliverVia: 'manual' })
    ]
  ] as const)(
    'should refuse a purpose that is not a plain name in %s before the store',
    async (_op, run) => {
      for (const purpose of BAD) {
        const { storage, calls } = counting()
        const service = new OtpService(makeOptions({}), storage, makeAudit())

        const caught: unknown = await run(service, purpose).catch((error: unknown) => error)

        expect(caught).toBeInstanceOf(NotificationException)
        expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
        expect((caught as NotificationException).getStatus()).toBe(400)
        expect((caught as NotificationException).getResponse()).toMatchObject({
          error: { details: { boundary: 'OtpService', parameter: 'purpose' } }
        })
        expect(calls()).toBe(0)
      }
    }
  )

  it('should accept a purpose of 64 colons', async () => {
    const service = new OtpService(makeOptions({}), new InMemoryOtpStorage(), makeAudit())

    await expect(
      service.generate({ ...ref, purpose: ':'.repeat(64), deliverVia: 'manual' })
    ).resolves.toBeDefined()
  })

  it('should not carry the purpose in the refusal', async () => {
    const service = new OtpService(makeOptions({}), new InMemoryOtpStorage(), makeAudit())

    const caught: unknown = await service
      .generate({ ...ref, purpose: 'top secret/purpose', deliverVia: 'manual' })
      .catch((error: unknown) => error)

    expect(JSON.stringify(caught)).not.toContain('secret')
  })
})
