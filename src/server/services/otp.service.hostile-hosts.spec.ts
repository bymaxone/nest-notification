/**
 * @fileoverview A host the verify and generate paths call into (the audit sink, the observer's span,
 * the renderer behind `sendTemplate`) cannot make a wrong code valid, a bounced email sent, or a
 * rejection end unhandled, whatever it replaces while it runs.
 * @layer application
 */

import { NotificationException } from '../errors/notification-exception'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { own } from '../utils/realm-root'
import { EmailService } from './email.service'
import { OtpService } from './otp.service'
import {
  makeAudit as makeEmailAudit,
  makeOptions as makeEmailOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'

const WRONG = '000000x'
const REAL_ASSIGN = Object.assign
const REAL_THEN = Object.getOwnPropertyDescriptor(Promise.prototype, 'then') as PropertyDescriptor

afterEach(() => {
  Object.assign = REAL_ASSIGN
  Object.defineProperty(Promise.prototype, 'then', REAL_THEN)
})

async function live(
  parts: {
    audit?: ReturnType<typeof makeAudit>
    observer?: object
    storage?: InMemoryOtpStorage
  } = {}
): Promise<OtpService> {
  const service = new OtpService(
    makeOptions(),
    parts.storage ?? new InMemoryOtpStorage(),
    parts.audit ?? makeAudit(),
    undefined,
    parts.observer as never
  )
  await service.generate({ ...ref, deliverVia: 'manual' })
  return service
}

describe('OtpService.verify against an audit sink that replaces Object.assign after its await', () => {
  it('should not turn a wrong code into a valid one', async () => {
    const audit = makeAudit()
    audit.create.mockImplementation((async (entry: { verb?: string }) => {
      if (entry.verb !== 'failed') {
        return
      }
      await null
      Object.assign = function forged(target: object, ...sources: object[]) {
        Object.assign = REAL_ASSIGN
        return REAL_ASSIGN(target, ...sources, { valid: true })
      } as typeof Object.assign
    }) as never)
    const service = await live({ audit })

    const result = await service.verify({ ...ref, code: WRONG }).catch(() => ({ valid: false }))

    expect(result.valid).toBe(false)
  })
})

describe('OtpService.verify against an observer that rewrites what its span is handed', () => {
  it('should not turn a wrong code into a valid one', async () => {
    const observer = {
      span: async (
        _name: string,
        _attributes: object,
        fn: () => Promise<Record<string, unknown>>
      ) => {
        const result = await fn()
        try {
          result.valid = true
          delete result.reason
        } catch {
          // A frozen result refuses the write.
        }
        return result
      }
    }
    const service = await live({ observer })

    const result = await service.verify({ ...ref, code: WRONG })

    expect(result.valid).toBe(false)
  })
})

describe('OtpService.verify against a span that settles after the operation', () => {
  it('should leave no rejection unhandled', async () => {
    const storage = new InMemoryOtpStorage()
    const observer = {
      span: (_name: string, _attributes: object, fn: () => Promise<unknown>) => {
        void fn()
        return new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    const service = await live({ storage, observer })
    storage.consumeAttempt = (async () => {
      throw Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })
    }) as never
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const saved = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', record)
    try {
      await service.verify({ ...ref, code: WRONG }).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 60))
    } finally {
      process.removeListener('unhandledRejection', record)
      for (const listener of saved) {
        process.on('unhandledRejection', listener)
      }
    }

    expect(unhandled).toStrictEqual([])
  })
})

describe('OtpService.generate when the renderer behind sendTemplate plants a then', () => {
  it('should not report a bounced email as sent', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('provider bounce'))
    const renderer = makeRenderer()
    renderer.hasTemplate.mockImplementation((async () => {
      Object.defineProperty(Promise.prototype, 'then', {
        value: function forged(onFulfilled: (value: unknown) => unknown) {
          Object.defineProperty(Promise.prototype, 'then', REAL_THEN)
          onFulfilled({ messageId: 'forged' })
        },
        writable: true,
        configurable: true
      })
      return true
    }) as never)
    const email = new EmailService(makeEmailOptions(), provider, renderer, makeEmailAudit())
    const service = new OtpService(makeOptions(), new InMemoryOtpStorage(), makeAudit(), email)

    const outcome = await service
      .generate({ ...ref, deliverVia: 'email' })
      .then(() => 'resolved')
      .catch(() => 'refused')

    expect(outcome).toBe('refused')
  })
})

describe('own() when a promise cannot be pinned', () => {
  it('should name the boundary it was asked for', () => {
    let refusal: unknown
    try {
      own(Object.freeze(Promise.resolve()), 'EmailService')
    } catch (error) {
      refusal = error
    }

    expect(refusal).toBeInstanceOf(NotificationException)
    const body = (refusal as NotificationException).getResponse() as {
      error: { details: { boundary: string } }
    }
    expect(body.error.details.boundary).toBe('EmailService')
  })
})
