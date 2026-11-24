/**
 * @fileoverview Holds `SmtpEmailProvider` to never reading `Promise[Symbol.species]`: `then`, `catch`
 * and `finally` build their promises through it, so a getter a host call left in place could answer
 * a verification the relay refused, or end a failed send without a handler and leave its timer armed.
 * @layer infrastructure
 */

import { baseOptions } from './__tests__/smtp-email-provider.fixtures'
import { SmtpEmailProvider } from './smtp-email.provider'

const mockSendMail = jest.fn()
const mockVerify = jest.fn()
const mockCreateTransport = jest.fn()

jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

const SPECIES = Object.getOwnPropertyDescriptor(Promise, Symbol.species) as PropertyDescriptor

/** Leaves `Promise[Symbol.species]` answering with `answer`, the way a host call can. */
function plantSpecies(answer: () => unknown): void {
  Object.defineProperty(Promise, Symbol.species, { configurable: true, get: answer })
}

afterEach(() => {
  Object.defineProperty(Promise, Symbol.species, SPECIES)
  jest.useRealTimers()
})

describe('SmtpEmailProvider.verify when the relay answers with a promise that forges its verdict', () => {
  it('should refuse a relay whose verification promise lies about its outcome', async () => {
    const lying = Promise.reject(new Error('connect ECONNREFUSED'))
    lying.catch(() => undefined)
    Object.defineProperty(lying, 'then', {
      configurable: true,
      value: (resolve: (value: unknown) => void): void => {
        resolve(true)
      }
    })
    Object.defineProperty(lying, 'constructor', { configurable: true, value: Object })
    mockCreateTransport.mockImplementation(() => ({
      sendMail: mockSendMail,
      verify: () => lying,
      close: jest.fn()
    }))

    await expect(new SmtpEmailProvider({ host: '127.0.0.1' }).verify()).rejects.toThrow()
  })
})

describe('SmtpEmailProvider.send when the species getter throws during the send', () => {
  it('should leave no timer armed and no rejection unhandled', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail, close: jest.fn() }))
    mockSendMail.mockImplementation(() => {
      plantSpecies(() => {
        throw new Error('species broke')
      })
      return Promise.reject(new Error('550 relay refused'))
    })

    const sent = new SmtpEmailProvider({ host: 'h' }).send(baseOptions)
    let failed = false
    try {
      await sent
    } catch {
      failed = true
    }
    Object.defineProperty(Promise, Symbol.species, SPECIES)
    await new Promise<void>((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', listener)

    expect([failed, unhandled.length, jest.getTimerCount()]).toStrictEqual([true, 0, 0])
  })
})
