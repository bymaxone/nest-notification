/**
 * @fileoverview Holds every entry point that takes a caller's object to reading each field of it
 * once: the call checks the value it uses, and uses the value it checked.
 * @layer application
 */

import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { NotificationService } from './notification.service'
import { OtpService } from './otp.service'

/** An object whose every field is a getter that counts its reads and changes its answer after the first. */
function counting(fields: Record<string, unknown>): {
  object: object
  reads: Record<string, number>
} {
  const reads: Record<string, number> = {}
  const object = {}
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(object, key, {
      enumerable: true,
      get() {
        reads[key] = (reads[key] ?? 0) + 1
        return reads[key] === 1 ? value : 'changed'
      }
    })
  }
  return { object, reads }
}

const scope = { tenantId: 'acme', recipient: ref.recipient, purpose: ref.purpose, userId: 'u1' }

describe('the entry points of the OTP service', () => {
  it.each([
    ['consume', (service: OtpService, input: never) => service.consume(input)],
    ['getStatus', (service: OtpService, input: never) => service.getStatus(input)],
    ['verify', (service: OtpService, input: never) => service.verify(input).catch(() => undefined)]
  ])('should read each field of the input of %s once', async (name, run) => {
    const service = new OtpService(makeOptions({}), new InMemoryOtpStorage(), makeAudit())
    const { object, reads } = counting(name === 'verify' ? { ...scope, code: '123456' } : scope)

    await run(service, object as never)

    expect(Object.values(reads).every((count) => count === 1)).toBe(true)
    expect(Object.keys(reads).sort()).toEqual(
      Object.keys(name === 'verify' ? { ...scope, code: 1 } : scope).sort()
    )
  })
})

describe('the dispatch of the notification service', () => {
  it('should read the channel, the tenant and the payload of a request once', async () => {
    const otp = new OtpService(makeOptions({}), new InMemoryOtpStorage(), makeAudit())
    const service = new NotificationService(undefined, otp)
    const payload = { recipient: ref.recipient, purpose: ref.purpose, deliverVia: 'manual' }
    const { object, reads } = counting({ channel: 'otp', tenantId: 'acme', payload })

    await service.dispatch(object as never)

    expect(reads).toEqual({ channel: 1, tenantId: 1, payload: 1 })
  })
})
