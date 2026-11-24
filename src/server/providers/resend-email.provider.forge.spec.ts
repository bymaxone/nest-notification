/**
 * @fileoverview Holds `ResendEmailProvider` to answering a send only from what the SDK returned: a
 * `then`, a constructor pair or a swapped global `Promise` that the SDK call leaves behind must not
 * answer for a send the API refused.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'

import { ResendEmailProvider } from './resend-email.provider'

const mockSend = jest.fn()
const mockResendCtor = jest.fn()

jest.mock('resend', () => ({ __esModule: true, Resend: mockResendCtor }), { virtual: true })

const PROTOTYPE = Object.getPrototypeOf((async (): Promise<void> => undefined)()) as object
const CONSTRUCTOR = Object.getOwnPropertyDescriptor(PROTOTYPE, 'constructor') as PropertyDescriptor
const THEN = Object.getOwnPropertyDescriptor(PROTOTYPE, 'then') as PropertyDescriptor
const NATIVE = Promise
const REFUSED = { data: null, error: { name: 'validation_error', message: 'refused' } }
const FORGED = { data: { id: 'forged' }, error: null }

/** Puts the realm back, synchronously. */
function restore(): void {
  Object.defineProperty(PROTOTYPE, 'constructor', CONSTRUCTOR)
  Object.defineProperty(PROTOTYPE, 'then', THEN)
  delete (Object.prototype as Record<string, unknown>).then
  globalThis.Promise = NATIVE
}

afterEach(restore)

/** Sends once through a provider whose SDK call runs `plant`, and reports what came of it. */
async function sendAfter(plant: () => void): Promise<string> {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  mockResendCtor.mockImplementation(() => ({ emails: { send: mockSend } }))
  mockSend.mockImplementation(() => {
    const answer = NATIVE.resolve(REFUSED)
    plant()
    return answer
  })
  let outcome: string
  try {
    const sent = await new ResendEmailProvider({ apiKey: 're_x' }).send({
      to: 'jane@acme.com',
      from: 'noreply@acme.com',
      subject: 's',
      html: '<p>hi</p>'
    })
    outcome = `sent ${sent.messageId}`
  } catch {
    outcome = 'failed'
  }
  restore()
  return outcome
}

describe('ResendEmailProvider.send when the SDK call leaves the realm changed', () => {
  it('should refuse when a then planted on Object.prototype answers for the SDK result', async () => {
    const outcome = await sendAfter(() => {
      Object.defineProperty(Object.prototype, 'then', {
        configurable: true,
        get(this: unknown) {
          if (this !== REFUSED) {
            return undefined
          }
          delete (Object.prototype as Record<string, unknown>).then
          return (ok: (value: unknown) => void): void => {
            ok(FORGED)
          }
        }
      })
    })

    expect(outcome).toBe('failed')
  })

  it('should refuse when a one-shot constructor and then pair answers for the send', async () => {
    const outcome = await sendAfter(() => {
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
          return (ok: (value: unknown) => void): void => {
            ok(FORGED)
          }
        }
      })
    })

    expect(outcome).toBe('failed')
  })

  it('should refuse when the global Promise is swapped for one constructor call', async () => {
    const outcome = await sendAfter(() => {
      globalThis.Promise = function Fake() {
        globalThis.Promise = NATIVE
        return new NATIVE((resolve) => {
          resolve(FORGED)
        })
      } as unknown as PromiseConstructor
    })

    expect(outcome).toBe('failed')
  })

  it('should leave no rejection unhandled when removing the abort listener throws', async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    const remove = jest
      .spyOn(AbortSignal.prototype, 'removeEventListener')
      .mockImplementation(() => {
        throw new Error('detach broke')
      })

    const outcome = await sendAfter(() => undefined)
    remove.mockRestore()
    await new NATIVE<void>((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', listener)

    expect([outcome, unhandled.length]).toStrictEqual(['failed', 0])
  })
})
