/**
 * @fileoverview A host the services call synchronously (the audit sink, the observer's `onSend` and
 * `onOtp`) that changes the realm while it runs cannot turn a failed send into a sent one, a wrong
 * code into a valid one, or a refusal into a forged answer: what the caller awaits follows a check.
 * @layer application
 */

import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { EmailService } from './email.service'
import { NotificationService } from './notification.service'
import { OtpService } from './otp.service'
import {
  makeAudit as makeEmailAudit,
  makeOptions as makeEmailOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'

const SEND = { tenantId: 't', to: 'bob@x.com', subject: 's', html: '<p>hi</p>' }
const REAL_THEN = Object.getOwnPropertyDescriptor(Promise.prototype, 'then') as PropertyDescriptor

/** Plants a `then` on the promises that answers `answer` for the first promise that is resolved with one. */
function plantThen(answer: unknown, once = true): void {
  Object.defineProperty(Promise.prototype, 'then', {
    configurable: true,
    writable: true,
    value: function forged(this: unknown, resolve: (value: unknown) => void) {
      if (once) {
        Object.defineProperty(Promise.prototype, 'then', REAL_THEN)
      }
      resolve(answer)
    }
  })
}

function restore(): void {
  Object.defineProperty(Promise.prototype, 'then', REAL_THEN)
  delete (Object.prototype as Record<string, unknown>).evilKey
}

afterEach(restore)

async function outcome(call: () => Promise<unknown>): Promise<{ ok: boolean; value?: unknown }> {
  let result: { ok: boolean; value?: unknown }
  try {
    result = { ok: true, value: await call() }
  } catch {
    result = { ok: false }
  }
  // Cleared before the return: this helper's own result would read the planted `then`.
  restore()
  return result
}

/** What a host controller does: returns the library's promise from its own async function. */
async function viaController<T>(call: () => Promise<T>): Promise<T> {
  return call()
}

describe('EmailService.send when the audit sink plants a then while a send fails', () => {
  it('should reject, never answer sent, and never write a sent row', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('550 rejected'))
    const audit = makeEmailAudit()
    audit.create.mockImplementation((async (entry: { verb?: string }) => {
      if (entry.verb === 'failed') {
        plantThen({ messageId: 'forged' })
      }
    }) as never)
    const email = new EmailService(makeEmailOptions(), provider, makeRenderer(), audit)

    const result = await outcome(() => email.send(SEND))

    expect(result.ok).toBe(false)
    expect(
      audit.create.mock.calls.map(([entry]) => (entry as { verb: string }).verb)
    ).toStrictEqual(['failed'])
  })
})

describe('EmailService.send when onSend plants a then that answers a forged result', () => {
  it('should not resolve with the forged result of a delivered message', async () => {
    const email = new EmailService(
      makeEmailOptions(),
      makeProvider(),
      makeRenderer(),
      makeEmailAudit(),
      {
        onSend: () => {
          plantThen({ messageId: 'forged' })
        }
      } as never
    )

    const result = await outcome(() => email.send(SEND))

    // The provider had accepted: the real id is answered, never the planted one and never a refusal.
    expect(result.ok).toBe(true)
    expect(result.value).toEqual({ messageId: 'msg_1' })
  })
})

/** An OtpService whose span plants a then answering `answer`, in the synchronous part of the call. */
function hostileOtp(answer: unknown, once = true): OtpService {
  return new OtpService(makeOptions(), new InMemoryOtpStorage(), makeAudit(), undefined, {
    span: (_name: string, _attributes: object, fn: () => Promise<unknown>) => {
      plantThen(answer, once)
      return fn()
    }
  } as never)
}

describe('OtpService when a sync host call plants a then that answers { valid: true }', () => {
  it('should not turn a wrong code into a valid one', async () => {
    const hostile = hostileOtp({ valid: true })
    await hostile.generate({ ...ref, deliverVia: 'manual' }).catch(() => undefined)
    restore()

    const result = await outcome(() =>
      viaController(() => hostile.verify({ ...ref, code: '000000x' }))
    )

    expect(result.ok ? (result.value as { valid: boolean }).valid : false).toBe(false)
  })

  /** An input whose getter plants the then, which the method reads synchronously, as its first act. */
  const plantingRef = (): typeof ref =>
    ({
      ...ref,
      get purpose(): string {
        plantThen({ valid: true }, false)
        return ref.purpose
      }
    }) as typeof ref

  it('should not resolve a consume with the forged answer', async () => {
    const otp = new OtpService(makeOptions(), new InMemoryOtpStorage(), makeAudit())
    await otp.generate({ ...ref, deliverVia: 'manual' })

    const result = await outcome(() => viaController(() => otp.consume(plantingRef())))

    expect(result.value).toBeUndefined()
  })

  it('should not resolve a generate with the forged answer', async () => {
    const otp = new OtpService(makeOptions(), new InMemoryOtpStorage(), makeAudit())

    const result = await outcome(() =>
      viaController(() => otp.generate({ ...plantingRef(), deliverVia: 'manual' }))
    )

    expect(result.value).not.toStrictEqual({ valid: true })
  })
})

describe('NotificationService.dispatch when the otp channel changes the realm', () => {
  it('should not hand a forged verdict to the host controller', async () => {
    const otp = hostileOtp({ valid: true })
    await otp.generate({ ...ref, deliverVia: 'manual' }).catch(() => undefined)
    restore()
    const notification = new NotificationService(undefined, otp)

    const result = await outcome(() =>
      viaController(() =>
        notification.dispatch({
          channel: 'otp',
          tenantId: ref.tenantId,
          payload: {
            action: 'verify',
            recipient: ref.recipient,
            purpose: ref.purpose,
            code: '000000x'
          }
        } as never)
      )
    )

    expect(JSON.stringify(result.value ?? null)).not.toContain('"valid":true')
  })
})
