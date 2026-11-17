/**
 * @fileoverview Holds `OtpService` to `otp.strictPurposes`: with the option on, a purpose outside the
 * canonical five and the keys of `perPurpose` is refused at every entry point before any store call,
 * cooldown or audit entry; with it off, nothing changes. The store given to the service counts its calls.
 * @layer domain
 */

import { NOTIFICATION_PURPOSES } from '../constants/notification-purposes'
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

/** Valid in shape, registered nowhere. The last four are keys an object lookup would find. */
const UNREGISTERED = [
  'unknown_flow',
  'EMAIL_VERIFICATION',
  'email-verification',
  'constructor',
  '__proto__',
  'toString',
  'hasOwnProperty'
]

const STRICT = { strictPurposes: true, perPurpose: { login: { length: 8 } } }

const OPERATIONS = [
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
] as const

describe('OtpService with otp.strictPurposes', () => {
  it.each(OPERATIONS)(
    'should refuse a purpose that is not registered in %s before the store',
    async (_op, run) => {
      for (const purpose of UNREGISTERED) {
        const { storage, calls } = counting()
        const audit = makeAudit()
        const service = new OtpService(makeOptions(STRICT), storage, audit)

        const caught: unknown = await run(service, purpose).catch((error: unknown) => error)

        expect(caught).toBeInstanceOf(NotificationException)
        expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
        expect((caught as NotificationException).getStatus()).toBe(400)
        const response = (caught as NotificationException).getResponse()
        expect(response).toMatchObject({
          error: {
            details: {
              boundary: 'OtpService',
              parameter: 'purpose',
              reason: 'not a registered purpose'
            }
          }
        })
        expect(JSON.stringify(response)).not.toContain(purpose)
        expect(calls()).toBe(0)
        expect(audit.create).not.toHaveBeenCalled()
      }
    }
  )

  it.each([...Object.values(NOTIFICATION_PURPOSES), 'login'])(
    'should accept the registered purpose %s',
    async (purpose) => {
      const service = new OtpService(makeOptions(STRICT), new InMemoryOtpStorage(), makeAudit())

      await expect(
        service.generate({ ...ref, purpose, deliverVia: 'manual' })
      ).resolves.toBeDefined()
      await expect(service.getStatus({ ...ref, purpose })).resolves.toBeDefined()
    }
  )

  it('should hold the canonical five when there is no perPurpose', async () => {
    const service = new OtpService(
      makeOptions({ strictPurposes: true }),
      new InMemoryOtpStorage(),
      makeAudit()
    )

    await expect(
      service.generate({ ...ref, purpose: 'password_reset', deliverVia: 'manual' })
    ).resolves.toBeDefined()
    await expect(
      service.generate({ ...ref, purpose: 'login', deliverVia: 'manual' })
    ).rejects.toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })

  it('should still refuse a purpose that is not a plain name with the shape reason', async () => {
    const service = new OtpService(makeOptions(STRICT), new InMemoryOtpStorage(), makeAudit())

    const caught: unknown = await service
      .generate({ ...ref, purpose: 'a b', deliverVia: 'manual' })
      .catch((error: unknown) => error)

    expect((caught as NotificationException).getResponse()).toMatchObject({
      error: { details: { reason: 'contains a character outside A-Z a-z 0-9 : _ -' } }
    })
  })

  it.each([
    ['omitted', { perPurpose: { login: { length: 8 } } }],
    ['false', { strictPurposes: false, perPurpose: { login: { length: 8 } } }]
  ])('should accept any purpose that is a plain name when the option is %s', async (_n, otp) => {
    for (const purpose of UNREGISTERED) {
      const service = new OtpService(makeOptions(otp), new InMemoryOtpStorage(), makeAudit())

      await expect(
        service.generate({ ...ref, purpose, deliverVia: 'manual' })
      ).resolves.toBeDefined()
    }
  })
})
