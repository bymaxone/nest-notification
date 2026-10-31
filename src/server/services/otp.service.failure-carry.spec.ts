/**
 * @fileoverview Specifies that the failed-attempt count survives a re-issue: a new code starts
 * with the failures already recorded for the recipient and purpose, and only a success or an
 * explicit consume clears them. A storage without the optional failure methods keeps a fresh
 * budget per code and says so once at startup.
 * @layer domain
 */
import { Logger } from '@nestjs/common'

import type { INotificationLogRepository } from '../interfaces/notification-log-repository.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

const base = { ...ref, tenantId: 'acme', deliverVia: 'manual' as const }
const WRONG = '000000'

describe('OtpService failed attempts across re-issues', () => {
  let storage: InMemoryOtpStorage
  let audit: jest.Mocked<INotificationLogRepository>
  let service: OtpService

  const codeOf = async (): Promise<string> =>
    (await storage.get('acme', ref.recipient, ref.purpose))?.code ?? ''
  /** Issues a code and spends `count` wrong guesses on it. */
  const fail = async (count: number): Promise<string[]> => {
    const reasons: string[] = []
    for (let i = 0; i < count; i += 1) {
      const result = await service.verify({ ...base, code: WRONG })
      reasons.push(result.valid ? 'valid' : result.reason)
    }
    return reasons
  }

  beforeEach(() => {
    storage = new InMemoryOtpStorage()
    audit = makeAudit()
    // No cooldown, so a test can re-issue at once.
    service = new OtpService(
      makeOptions({ defaultMaxAttempts: 3, resendCooldownSeconds: 0 }),
      storage,
      audit
    )
  })

  // The measured defect: three wrong guesses, a re-issue, and three more were accepted.
  it('should not refresh the attempt budget when a new code is issued', async () => {
    await service.generate(base)
    expect(await fail(3)).toEqual(['invalid_code', 'invalid_code', 'invalid_code'])

    await service.generate(base)

    // The budget is spent: the new code is locked out at once, not given three fresh guesses.
    expect(await fail(2)).toEqual(['max_attempts', 'not_found'])
  })

  // Failures accumulate over any number of codes until the budget is spent.
  it('should count failures across several codes', async () => {
    await service.generate(base)
    expect(await fail(2)).toEqual(['invalid_code', 'invalid_code'])
    await service.generate(base)
    const third = await service.verify({ ...base, code: WRONG })

    expect(third).toMatchObject({ valid: false, reason: 'invalid_code', remainingAttempts: 0 })
    await service.generate(base)
    expect(await fail(1)).toEqual(['max_attempts'])
  })

  // The correct code is still accepted while failures remain below the ceiling.
  it('should accept the right code on a re-issued code below the ceiling', async () => {
    await service.generate(base)
    await fail(2)
    await service.generate(base)

    expect(await service.verify({ ...base, code: await codeOf() })).toEqual({ valid: true })
  })

  // A success clears the count, so the next flow starts with a full budget.
  it('should clear the failures on a successful verification', async () => {
    await service.generate(base)
    await fail(2)
    await service.generate(base)
    await service.verify({ ...base, code: await codeOf() })
    await service.consume(base)

    await service.generate(base)

    expect(await fail(3)).toEqual(['invalid_code', 'invalid_code', 'invalid_code'])
  })

  // An explicit consume ends the flow and its failures with it.
  it('should clear the failures on consume', async () => {
    await service.generate(base)
    await fail(3)
    await service.consume(base)

    await service.generate(base)

    expect(await fail(3)).toEqual(['invalid_code', 'invalid_code', 'invalid_code'])
  })

  // The count is per recipient and purpose: another purpose keeps its own budget.
  it('should keep the failures per recipient and purpose', async () => {
    await service.generate(base)
    await fail(3)

    await service.generate({ ...base, purpose: 'password_reset' })
    const other = await service.verify({ ...base, purpose: 'password_reset', code: WRONG })

    expect(other).toMatchObject({ valid: false, reason: 'invalid_code' })
  })

  // Every failure refreshes the counter's lifetime to the code lifetime of the purpose.
  it('should record each failure with the code lifetime as the counter lifetime', async () => {
    const record = jest.spyOn(storage, 'recordFailure')
    await service.generate(base)
    await fail(2)

    expect(record).toHaveBeenCalledTimes(2)
    expect(record).toHaveBeenLastCalledWith('acme', ref.recipient, ref.purpose, 600)
  })

  // A counter that has lapsed (no failure for a whole code lifetime) starts again from zero.
  it('should start from zero once the counter has expired', async () => {
    jest.useFakeTimers()
    try {
      await service.generate(base)
      await fail(3)
      jest.advanceTimersByTime(601_000)

      await service.generate(base)

      expect(await fail(1)).toEqual(['invalid_code'])
    } finally {
      jest.useRealTimers()
    }
  })

  // A failing counter read must not leave the recipient behind a cooldown with no live code.
  it('should not hold the resend cooldown when the failure count cannot be read', async () => {
    const cooled = new OtpService(
      makeOptions({ defaultMaxAttempts: 3, resendCooldownSeconds: 60 }),
      storage,
      audit
    )
    jest.spyOn(storage, 'getFailures').mockRejectedValueOnce(new Error('store unavailable'))

    await expect(cooled.generate(base)).rejects.toThrow('store unavailable')

    await expect(cooled.generate(base)).resolves.toMatchObject({ cooldownSeconds: 60 })
  })

  describe('a storage without the failure methods', () => {
    /** A storage that implements the required contract only. */
    class PlainStorage extends InMemoryOtpStorage {
      override recordFailure = undefined as never
      override getFailures = undefined as never
      override clearFailures = undefined as never
    }

    afterEach(() => {
      jest.restoreAllMocks()
    })

    // Behaviour is unchanged for it: each code carries a fresh budget.
    it('should keep a fresh budget per code', async () => {
      const plain = new PlainStorage()
      const legacy = new OtpService(
        makeOptions({ defaultMaxAttempts: 3, resendCooldownSeconds: 0 }),
        plain,
        audit
      )
      await legacy.generate(base)
      for (let i = 0; i < 3; i += 1) await legacy.verify({ ...base, code: WRONG })
      await legacy.generate(base)

      expect(await legacy.verify({ ...base, code: WRONG })).toMatchObject({
        reason: 'invalid_code'
      })
    })

    // The deviation is named once, at startup, with the remedy.
    it('should warn once at startup naming the deviation', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const legacy = new OtpService(makeOptions({}), new PlainStorage(), audit)

      legacy.onModuleInit()
      legacy.onModuleInit()

      const messages = warn.mock.calls.map((call) => String(call[0]))
      expect(messages).toHaveLength(1)
      expect(messages[0]).toContain('BYMAX_NOTIFICATION_OTP_FAILURES_NOT_CARRIED')
      expect(messages[0]).toContain('recordFailure')
      expect(messages[0]).toContain('800-63B')
    })

    it('should stay silent for a storage that implements them', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      service.onModuleInit()

      expect(warn).not.toHaveBeenCalled()
    })
  })
})
