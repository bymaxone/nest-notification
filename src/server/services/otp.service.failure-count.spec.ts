/**
 * @fileoverview Holds the failure budget to being enforced whatever a store's `recordFailure`
 * answers: a count that is not a whole number of one or more is refused with
 * `OTP_STORAGE_FAILED`, and a right code never passes because the count could not be compared.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { assertFailureCount } from '../utils/failure-count'

import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

const base = { ...ref, tenantId: 'acme', deliverVia: 'manual' as const }
const WRONG = 'ABCDEF'

const NOT_A_COUNT: ReadonlyArray<[string, unknown]> = [
  ['undefined', undefined],
  ['null', null],
  ['NaN', Number.NaN],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['an object', {}],
  ['0', 0],
  ['-1', -1],
  ['1.5', 1.5],
  ['true', true],
  ['a string', 'abc'],
  ['a numeric string', '1']
]

describe('a failure count from the store', () => {
  it.each(NOT_A_COUNT)(
    'should refuse %s with OTP_STORAGE_FAILED and keep a right code from passing',
    async (_name, answer) => {
      const storage = new InMemoryOtpStorage()
      storage.recordFailure = async () => answer as number
      const service = new OtpService(
        makeOptions({ defaultMaxAttempts: 3, resendCooldownSeconds: 0 }),
        storage,
        makeAudit()
      )
      await service.generate(base)
      const code = (await storage.get('acme', ref.recipient, ref.purpose))?.code ?? ''

      const outcomes: unknown[] = []
      for (let i = 0; i < 4; i += 1) {
        outcomes.push(await service.verify({ ...base, code: WRONG }).catch((e: unknown) => e))
      }
      await service.generate(base)
      const right = await service
        .verify({
          ...base,
          code: (await storage.get('acme', ref.recipient, ref.purpose))?.code ?? code
        })
        .catch((e: unknown) => e)

      for (const outcome of [...outcomes, right]) {
        expect(outcome).toBeInstanceOf(NotificationException)
        expect((outcome as NotificationException).code).toBe('notification.otp_storage_failed')
      }
    }
  )

  it.each([1, 2, 3, 100])('should pass the count %s through', (count) => {
    expect(assertFailureCount(count, 'store')).toBe(count)
  })

  it('should name the store and keep the answer out of the error', () => {
    let caught: unknown
    try {
      assertFailureCount('SECRET-ANSWER', 'my-store')
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(NotificationException)
    expect((caught as NotificationException).getResponse()).toMatchObject({
      error: { details: { providerName: 'my-store' } }
    })
    expect(JSON.stringify(caught)).not.toContain('SECRET-ANSWER')
  })
})

describe('a ceiling that is not a number', () => {
  it('should refuse the guess as max_attempts, never compare it as if the ceiling had not been reached', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(
      makeOptions({ defaultMaxAttempts: Number.NaN, resendCooldownSeconds: 0 }),
      storage,
      makeAudit()
    )
    await service.generate(base)
    const code = (await storage.get('acme', ref.recipient, ref.purpose))?.code ?? ''

    const outcome = await service.verify({ ...base, code }).catch((e: unknown) => e)

    expect(outcome).toMatchObject({ valid: false, reason: 'max_attempts' })
  })
})
