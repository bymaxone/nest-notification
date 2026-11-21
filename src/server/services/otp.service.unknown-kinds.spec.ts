/**
 * @fileoverview Holds an OTP action and a delivery channel the library does not know to a refusal:
 * neither is read as `generate` or as `manual`, and no code is sent or stored.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { NotificationService } from './notification.service'
import { OtpService } from './otp.service'

const base = { ...ref, tenantId: 'acme' }

describe('an OTP input of an unknown kind', () => {
  it.each(['sms', 'Email', '', 0, null, {}])(
    'should refuse deliverVia %p and store nothing',
    async (value) => {
      const storage = new InMemoryOtpStorage()
      const service = new OtpService(makeOptions({}), storage, makeAudit())

      const caught: unknown = await service
        .generate({ ...base, deliverVia: value as 'email' })
        .catch((error: unknown) => error)

      expect(caught).toBeInstanceOf(NotificationException)
      expect((caught as NotificationException).code).toBe('notification.invalid_scope_identifier')
      expect((caught as NotificationException).getResponse()).toMatchObject({
        error: { details: { boundary: 'OtpService', parameter: 'deliverVia' } }
      })
      expect(await storage.get('acme', ref.recipient, ref.purpose)).toBeNull()
    }
  )

  it.each(['verfy', 'delete', 'VERIFY', '', 0, null, {}])(
    'should refuse the action %p without generating a code',
    async (action) => {
      const storage = new InMemoryOtpStorage()
      const otp = new OtpService(makeOptions({}), storage, makeAudit())
      const service = new NotificationService(undefined, otp)

      const caught: unknown = await service
        .dispatch({
          channel: 'otp',
          tenantId: 'acme',
          payload: { recipient: ref.recipient, purpose: ref.purpose, action: action as 'verify' }
        })
        .catch((error: unknown) => error)

      expect(caught).toBeInstanceOf(NotificationException)
      expect(await storage.get('acme', ref.recipient, ref.purpose)).toBeNull()
    }
  )

  it.each(['generate', 'verify', 'consume', undefined] as const)(
    'should still accept the action %p',
    async (action) => {
      const otp = new OtpService(makeOptions({}), new InMemoryOtpStorage(), makeAudit())
      const service = new NotificationService(undefined, otp)

      const caught: unknown = await service
        .dispatch({
          channel: 'otp',
          tenantId: 'acme',
          payload: {
            recipient: ref.recipient,
            purpose: ref.purpose,
            deliverVia: 'manual',
            ...(action ? { action } : {}),
            ...(action === 'verify' ? { code: '000000' } : {})
          }
        })
        .catch((error: unknown) => error)

      expect(caught).not.toBeInstanceOf(NotificationException)
    }
  )

  // The action is read once: a getter that answers 'verify' to the check and another word to the
  // dispatch must not fall through to generate and send a code nobody asked for.
  it('should read the action once, so a getter cannot pass the check and then generate', async () => {
    const storage = new InMemoryOtpStorage()
    const otp = new OtpService(makeOptions({}), storage, makeAudit())
    const service = new NotificationService(undefined, otp)
    let reads = 0
    const payload = {
      recipient: ref.recipient,
      purpose: ref.purpose,
      code: '000000',
      get action(): 'verify' {
        reads += 1
        return reads === 1 ? 'verify' : ('x' as 'verify')
      }
    }

    await service.dispatch({ channel: 'otp', tenantId: 'acme', payload })

    expect(reads).toBe(1)
    expect(await storage.get('acme', ref.recipient, ref.purpose)).toBeNull()
  })

  it('should read deliverVia of a generate once, so it cannot be manual at the check and email at delivery', async () => {
    const storage = new InMemoryOtpStorage()
    const otp = new OtpService(makeOptions({}), storage, makeAudit())
    let reads = 0

    await otp.generate({
      ...base,
      get deliverVia(): 'manual' {
        reads += 1
        return reads === 1 ? 'manual' : ('email' as 'manual')
      }
    })

    expect(reads).toBe(1)
  })

  it('should read every field of a dispatch payload once', async () => {
    const otp = new OtpService(makeOptions({}), new InMemoryOtpStorage(), makeAudit())
    const service = new NotificationService(undefined, otp)
    const reads: Record<string, number> = {}
    const payload = {}
    for (const [key, value] of Object.entries({
      recipient: ref.recipient,
      purpose: ref.purpose,
      userId: 'u1',
      deliverVia: 'manual',
      emailTemplate: 'otp_code',
      emailData: {},
      locale: 'en'
    })) {
      Object.defineProperty(payload, key, {
        enumerable: true,
        get() {
          reads[key] = (reads[key] ?? 0) + 1
          return value
        }
      })
    }

    await service.dispatch({ channel: 'otp', tenantId: 'acme', payload: payload as never })

    expect(Object.values(reads)).toEqual([1, 1, 1, 1, 1, 1, 1])
  })
})
