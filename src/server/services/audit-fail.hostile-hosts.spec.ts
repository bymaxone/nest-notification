/**
 * @fileoverview A host the services call (the store's `get`, a span's `end`, the audit sink, a
 * provider's result) that changes the realm after the last check the library made cannot forge what
 * the caller awaits: a status, a send, a refusal, a message id, or a typed failure.
 * @layer application
 */

import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { EmailService } from './email.service'
import { OtpService } from './otp.service'
import {
  makeAudit as makeEmailAudit,
  makeOptions as makeEmailOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'

const SEND = { tenantId: 't', to: 'bob@x.com', subject: 's', html: '<p>hi</p>' }
const PROTOTYPE = Object.getPrototypeOf((async (): Promise<void> => undefined)()) as object
const THEN = Object.getOwnPropertyDescriptor(PROTOTYPE, 'then') as PropertyDescriptor
const CONSTRUCTOR = Object.getOwnPropertyDescriptor(PROTOTYPE, 'constructor') as PropertyDescriptor

function restore(): void {
  Object.defineProperty(PROTOTYPE, 'then', THEN)
  Object.defineProperty(PROTOTYPE, 'constructor', CONSTRUCTOR)
  delete (Object.prototype as Record<string, unknown>).then
  delete (Error.prototype as unknown as Record<string, unknown>).then
}

afterEach(() => {
  restore()
  jest.useRealTimers()
})

/** Makes the next await of a native promise answer `answer`, once: the engine reads both of these. */
function plantAwaitAnswer(answer: unknown): void {
  Object.defineProperty(PROTOTYPE, 'constructor', {
    configurable: true,
    get() {
      Object.defineProperty(PROTOTYPE, 'constructor', CONSTRUCTOR)
      return Object
    }
  })
  Object.defineProperty(PROTOTYPE, 'then', {
    configurable: true,
    get() {
      Object.defineProperty(PROTOTYPE, 'then', THEN)
      return (resolve: (value: unknown) => void): void => {
        resolve(answer)
      }
    }
  })
}

/** Plants a `then` on every object, read once after `skip` reads, that answers `answer`. */
function plantObjectThen(answer: unknown, skip = 0): void {
  let reads = 0
  Object.defineProperty(Object.prototype, 'then', {
    configurable: true,
    get() {
      reads += 1
      if (reads <= skip) {
        return undefined
      }
      delete (Object.prototype as Record<string, unknown>).then
      return (resolve: (value: unknown) => void): void => {
        resolve(answer)
      }
    }
  })
}

async function outcome(call: () => Promise<unknown>): Promise<{ ok: boolean; value: unknown }> {
  let result: { ok: boolean; value: unknown }
  try {
    result = { ok: true, value: await call() }
  } catch (error) {
    result = { ok: false, value: error }
  }
  restore()
  return result
}

describe('OtpService.getStatus when the store plants accessors the engine reads on an await', () => {
  it('should not resolve with the forged status', async () => {
    const forged = {
      exists: true,
      attempts: 0,
      maxAttempts: 5,
      validated: true,
      cooldownSeconds: 0
    }
    const storage = new InMemoryOtpStorage()
    const original = storage.get.bind(storage)
    storage.get = (...args: Parameters<typeof original>): ReturnType<typeof original> => {
      plantAwaitAnswer(forged)
      return original(...args)
    }
    const otp = new OtpService(makeOptions(), storage, makeAudit())

    const result = await outcome(() => otp.getStatus(ref))

    expect(JSON.stringify(result.value)).not.toBe(JSON.stringify(forged))
  })
})

describe('EmailService.send when the span promise never settles', () => {
  it('should answer with the message id after the grace period', async () => {
    jest.useFakeTimers()
    const email = new EmailService(
      makeEmailOptions(),
      makeProvider(),
      makeRenderer(),
      makeEmailAudit(),
      {
        span: (_name: string, _attributes: object, run: () => Promise<unknown>) => {
          void run()
          return new Promise(() => undefined)
        }
      } as never
    )
    let answer: unknown
    void email.send(SEND).then((value) => {
      answer = value
    })

    await jest.advanceTimersByTimeAsync(5_001)

    expect(answer).toStrictEqual({ messageId: 'msg_1' })
  })
})

describe('EmailService.send when a failed audit write plants the await accessors', () => {
  it('should reject instead of resuming as a success', async () => {
    const audit = makeEmailAudit()
    audit.create.mockImplementation((() => {
      plantAwaitAnswer(undefined)
      throw new Error('audit DB down')
    }) as never)
    const email = new EmailService(
      makeEmailOptions({}, { swallowErrors: false }),
      makeProvider(),
      makeRenderer(),
      audit
    )

    const result = await outcome(() => email.send(SEND))

    expect(result.ok).toBe(false)
  })
})

describe('EmailService.send when the provider result reads its message id from a getter', () => {
  it('should read it once, before the host audit sink runs', async () => {
    let reads = 0
    const provider = makeProvider()
    provider.send.mockImplementation((async () => ({
      get messageId(): string {
        reads += 1
        if (reads === 2) {
          plantObjectThen('untyped')
        }
        return 'real_msg'
      }
    })) as never)
    const email = new EmailService(makeEmailOptions(), provider, makeRenderer(), makeEmailAudit())

    const result = await outcome(() => email.send(SEND))

    expect(JSON.stringify(result.value)).toBe('{"messageId":"real_msg"}')
  })
})

describe('OtpService.generate when the audit of a failed delivery plants a then on Error', () => {
  it('should reject with the library error, never resolve or hang', async () => {
    const audit = makeAudit()
    audit.create.mockImplementation((async (entry: { verb?: string }) => {
      if (entry.verb === 'failed') {
        Object.defineProperty(Error.prototype, 'then', {
          configurable: true,
          get() {
            delete (Error.prototype as unknown as Record<string, unknown>).then
            return (resolve: (value: unknown) => void): void => {
              resolve({ forged: 'not a library error' })
            }
          }
        })
      }
    }) as never)
    const storage = new InMemoryOtpStorage()
    storage.set = async (): Promise<void> => {
      throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })
    }
    const otp = new OtpService(makeOptions(), storage, audit)

    const result = await outcome(() => otp.generate({ ...ref, deliverVia: 'manual' }))

    expect([result.ok, result.value instanceof Error]).toStrictEqual([false, true])
  })
})
