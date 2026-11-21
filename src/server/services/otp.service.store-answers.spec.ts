/**
 * @fileoverview Holds `OtpService` to refusing a store answer of the wrong kind, never reading it as
 * a lock that was taken, a code that was removed, a status that was ok, or a store that is ready.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'
import type { IOtpStorage } from '../interfaces/otp-storage.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

const base = { ...ref, tenantId: 'acme', deliverVia: 'manual' as const }
const TRUTHY = ['false', 'OK', 1, {}]

async function caught(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    (value) => ({ resolved: value }),
    (error: unknown) => error
  )
}

function codeOf(error: unknown): unknown {
  return error instanceof NotificationException ? error.code : error
}

describe('a store answer of the wrong kind', () => {
  it.each([...TRUTHY, undefined, null])(
    'should refuse tryAcquireCooldown answering %p and store no code',
    async (answer) => {
      const storage = new InMemoryOtpStorage()
      storage.tryAcquireCooldown = async () => answer as boolean
      const service = new OtpService(makeOptions({}), storage, makeAudit())

      const outcome = await caught(service.generate(base))

      expect(codeOf(outcome)).toBe('notification.otp_storage_failed')
      expect(await storage.get('acme', ref.recipient, ref.purpose)).toBeNull()
    }
  )

  it.each([...TRUTHY.filter((v) => v !== 1), 'no', undefined])(
    'should refuse deleteIfCode answering %p, never reading it as removed',
    async (answer) => {
      const storage = new InMemoryOtpStorage()
      storage.deleteIfCode = async () => answer as boolean
      const service = new OtpService(
        makeOptions({ consumeOnVerify: true, resendCooldownSeconds: 0 }),
        storage,
        makeAudit()
      )
      await service.generate(base)
      const code = (await storage.get('acme', ref.recipient, ref.purpose))?.code ?? ''

      const outcome = await caught(service.verify({ ...base, code }))

      expect(codeOf(outcome)).toBe('notification.otp_storage_failed')
    }
  )

  it.each([
    undefined,
    null,
    { status: 'oops' },
    { status: 'ok' },
    { status: 'ok', entry: { code: 5 } }
  ])('should refuse consumeAttempt answering %p and never return valid:true', async (answer) => {
    const storage = new InMemoryOtpStorage()
    storage.consumeAttempt = async () => answer as never
    const service = new OtpService(makeOptions({ resendCooldownSeconds: 0 }), storage, makeAudit())
    await service.generate(base)
    const code = (await storage.get('acme', ref.recipient, ref.purpose))?.code ?? ''

    const outcome = await caught(service.verify({ ...base, code }))

    expect(codeOf(outcome)).toBe('notification.otp_storage_failed')
  })

  it.each(['false', 1, {}, null])(
    'should refuse isConfigured answering %p as OTP_STORAGE_NOT_CONFIGURED',
    (answer) => {
      const storage = new InMemoryOtpStorage()
      storage.isConfigured = () => answer as boolean
      const service = new OtpService(makeOptions({}), storage as IOtpStorage, makeAudit())

      let error: unknown
      try {
        service.isConfigured()
      } catch (thrown) {
        error = thrown
      }

      expect(codeOf(error)).toBe('notification.otp_storage_not_configured')
    }
  )
})
