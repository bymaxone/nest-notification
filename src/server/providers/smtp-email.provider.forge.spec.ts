/**
 * @fileoverview Holds `SmtpEmailProvider` to answering a verification or a send only from what the
 * relay answered: a `then` on a prototype of the transport, a constructor pair or a swapped global
 * `Promise` left behind by the host must not answer for a relay that refused.
 * @layer infrastructure
 */

import { EventEmitter } from 'node:events'

import { baseOptions } from './__tests__/smtp-email-provider.fixtures'
import { SmtpEmailProvider } from './smtp-email.provider'

const mockCreateTransport = jest.fn()

jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

const PROTOTYPE = Object.getPrototypeOf((async (): Promise<void> => undefined)()) as object
const CONSTRUCTOR = Object.getOwnPropertyDescriptor(PROTOTYPE, 'constructor') as PropertyDescriptor
const THEN = Object.getOwnPropertyDescriptor(PROTOTYPE, 'then') as PropertyDescriptor
const NATIVE = Promise
const FORGED = { messageId: '<forged@relay>' }

/** Puts the realm back, synchronously. */
function restore(): void {
  Object.defineProperty(PROTOTYPE, 'constructor', CONSTRUCTOR)
  Object.defineProperty(PROTOTYPE, 'then', THEN)
  delete (EventEmitter.prototype as unknown as Record<string, unknown>).then
  globalThis.Promise = NATIVE
}

afterEach(() => {
  restore()
  jest.restoreAllMocks()
})

/** A transport whose relay refuses everything, with `plant` run when the send is made. */
function refusingTransport(plant: () => void): EventEmitter {
  const transport = new EventEmitter()
  Object.assign(transport, {
    close: jest.fn(),
    verify: () => NATIVE.reject(new Error('connect ECONNREFUSED')),
    sendMail: () => {
      plant()
      return NATIVE.reject(new Error('550 relay refused'))
    }
  })
  mockCreateTransport.mockImplementation(() => transport)
  return transport
}

/** Sends once and reports what came of it. */
async function outcomeOfSend(): Promise<string> {
  try {
    const sent = await new SmtpEmailProvider({ host: 'h' }).send(baseOptions)
    return `sent ${sent.messageId}`
  } catch {
    return 'failed'
  }
}

describe('SmtpEmailProvider when the host leaves the realm changed', () => {
  it('should refuse a send when a one-shot constructor and then pair answers for it', async () => {
    refusingTransport(() => {
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

    const outcome = await outcomeOfSend()
    restore()

    expect(outcome).toBe('failed')
  })

  it('should refuse a send when the global Promise is swapped for one constructor call', async () => {
    refusingTransport(() => {
      globalThis.Promise = function Fake() {
        globalThis.Promise = NATIVE
        return new NATIVE((resolve) => {
          resolve(FORGED)
        })
      } as unknown as PromiseConstructor
    })

    const outcome = await outcomeOfSend()
    restore()

    expect(outcome).toBe('failed')
  })

  it('should refuse a verification when a then on EventEmitter.prototype answers for the transport', async () => {
    const transport = refusingTransport(() => undefined)
    Object.defineProperty(EventEmitter.prototype, 'then', {
      configurable: true,
      get(this: unknown) {
        return this === transport
          ? (ok: (value: unknown) => void): void => {
              ok({ verify: () => NATIVE.resolve(true), sendMail: () => NATIVE.resolve(FORGED) })
            }
          : undefined
      }
    })

    let outcome = 'resolved'
    try {
      await new SmtpEmailProvider({ host: 'h' }).verify()
    } catch {
      outcome = 'failed'
    }
    restore()

    expect(outcome).toBe('failed')
  })

  it('should refuse a send when a then on EventEmitter.prototype answers for the transport', async () => {
    const transport = refusingTransport(() => undefined)
    Object.defineProperty(EventEmitter.prototype, 'then', {
      configurable: true,
      get(this: unknown) {
        return this === transport
          ? (ok: (value: unknown) => void): void => {
              ok({ verify: () => NATIVE.resolve(true), sendMail: () => NATIVE.resolve(FORGED) })
            }
          : undefined
      }
    })

    const outcome = await outcomeOfSend()
    restore()

    expect(outcome).toBe('failed')
  })

  it('should leave no rejection unhandled when clearing the timer throws', async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    refusingTransport(() => undefined)
    const clear = jest.spyOn(globalThis, 'clearTimeout').mockImplementation(() => {
      throw new Error('clear broke')
    })

    const outcome = await outcomeOfSend()
    clear.mockRestore()
    await new NATIVE<void>((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', listener)

    expect([outcome, unhandled.length]).toStrictEqual(['failed', 0])
  })
})
