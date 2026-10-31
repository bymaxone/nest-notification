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

  // Re-issuing a code must not replenish the failed-attempt budget.
  it('should not refresh the attempt budget when a new code is issued', async () => {
    await service.generate(base)
    expect(await fail(3)).toEqual(['invalid_code', 'invalid_code', 'invalid_code'])

    await service.generate(base)

    // The budget is spent, so the new code is locked out at once.
    expect(await fail(2)).toEqual(['max_attempts', 'max_attempts'])
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

  // The counter alone carries the budget across codes: a code is issued with its own attempts.
  it('should issue every code with its own full attempt count', async () => {
    const read = jest.spyOn(storage, 'getFailures')
    await service.generate(base)
    await fail(2)
    read.mockClear()

    await service.generate(base)

    expect((await storage.get('acme', ref.recipient, ref.purpose))?.attempts).toBe(0)
    expect(read).not.toHaveBeenCalled()
  })

  // The stored count decides, whatever the entry holds.
  it('should refuse a guess once the stored count is spent, whatever the entry holds', async () => {
    await service.generate(base)
    for (let i = 0; i < 3; i += 1)
      await storage.recordFailure('acme', ref.recipient, ref.purpose, 600)

    // The right code is refused too: the ceiling is already reached.
    expect(await service.verify({ ...base, code: await codeOf() })).toEqual({
      valid: false,
      reason: 'max_attempts'
    })
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        verb: 'max_attempts_exceeded',
        metadata: { reason: 'max_attempts' }
      })
    )
  })

  // The lockout ends when the counter lapses, even for a code issued just before.
  it('should accept the right code once the counter has lapsed', async () => {
    jest.useFakeTimers()
    try {
      jest.setSystemTime(0)
      await service.generate(base)
      await fail(3)
      jest.setSystemTime(599_000)
      await service.generate(base)
      jest.setSystemTime(601_000)

      expect(await storage.getFailures('acme', ref.recipient, ref.purpose)).toBe(0)
      expect(await service.verify({ ...base, code: await codeOf() })).toEqual({ valid: true })
    } finally {
      jest.useRealTimers()
    }
  })

  // Parallel wrong guesses share one budget: each is counted before its code is compared.
  it('should let only the guesses within the ceiling be compared when they arrive together', async () => {
    await service.generate(base)
    await fail(2)
    await service.generate(base)

    const results = await Promise.all(
      Array.from({ length: 3 }, () => service.verify({ ...base, code: WRONG }))
    )

    expect(results.filter((r) => !r.valid && r.reason === 'invalid_code')).toHaveLength(1)
    expect(results.filter((r) => !r.valid && r.reason === 'max_attempts')).toHaveLength(2)
  })

  // A verification with no live code is not a guess at anything, so it spends no budget.
  it('should not count verifications made while no code is pending', async () => {
    expect(await fail(5)).toEqual(Array(5).fill('not_found'))

    await service.generate(base)

    expect(await service.verify({ ...base, code: await codeOf() })).toEqual({ valid: true })
  })

  it('should not count verifications made after the code has expired', async () => {
    jest.useFakeTimers()
    try {
      jest.setSystemTime(0)
      await service.generate(base)
      jest.setSystemTime(601_000)

      expect(await fail(5)).toEqual(Array(5).fill('not_found'))
      expect(await storage.getFailures('acme', ref.recipient, ref.purpose)).toBe(0)
    } finally {
      jest.useRealTimers()
    }
  })

  // A code issued while a verification is between its lookup and its count must not be consumed
  // by that verification: the guess would reach a live code without having been counted.
  it('should answer not_found without consuming a code issued after the lookup', async () => {
    for (let i = 0; i < 3; i += 1)
      await storage.recordFailure('acme', ref.recipient, ref.purpose, 600)
    const realGet = storage.get.bind(storage)
    jest.spyOn(storage, 'get').mockImplementationOnce(async (...args) => {
      const found = await realGet(...args)
      // The replacement code is stored right after the lookup came back empty.
      await service.generate(base)
      return found
    })

    const result = await service.verify({ ...base, code: WRONG })

    expect(result).toEqual({ valid: false, reason: 'not_found' })
    expect((await storage.get('acme', ref.recipient, ref.purpose))?.attempts).toBe(0)
  })

  // Both budgets run out; the nearer one is reported.
  it('should report the attempts left by the failure count when it is the nearer', async () => {
    await service.generate(base)
    await fail(2)
    await service.generate(base)

    expect(await service.verify({ ...base, code: WRONG })).toMatchObject({
      reason: 'invalid_code',
      remainingAttempts: 0
    })
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

    // With nothing to count, a verification goes straight to the storage's own answer.
    it('should answer not_found from the storage when no code is pending', async () => {
      const legacy = new OtpService(makeOptions({}), new PlainStorage(), audit)

      expect(await legacy.verify({ ...base, code: WRONG })).toEqual({
        valid: false,
        reason: 'not_found'
      })
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

    // The three methods are one obligation: a storage with only some of them still deviates.
    it.each([['getFailures'], ['recordFailure'], ['clearFailures']] as const)(
      'should warn when only %s is missing',
      (missing) => {
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
        const partial = new InMemoryOtpStorage()
        Object.defineProperty(partial, missing, { value: undefined })

        new OtpService(makeOptions({}), partial, audit).onModuleInit()

        expect(warn).toHaveBeenCalledTimes(1)
      }
    )

    it('should name the remedy in the startup warning', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      new OtpService(makeOptions({}), new PlainStorage(), audit).onModuleInit()

      expect(String(warn.mock.calls[0]?.[0])).toContain(
        'Implement the three optional methods to carry the count across re-issues.'
      )
    })

    it('should stay silent for a storage that implements them', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      service.onModuleInit()

      expect(warn).not.toHaveBeenCalled()
    })
  })
})
