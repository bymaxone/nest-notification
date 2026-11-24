/**
 * @fileoverview Holds `ResendEmailProvider` to never reading `Promise[Symbol.species]`: a getter a host
 * call left in place that throws must not end a failed send without a handler.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'

import { ResendEmailProvider } from './resend-email.provider'

const mockSend = jest.fn()
const mockResendCtor = jest.fn()

jest.mock('resend', () => ({ __esModule: true, Resend: mockResendCtor }), { virtual: true })

const SPECIES = Object.getOwnPropertyDescriptor(Promise, Symbol.species) as PropertyDescriptor

afterEach(() => {
  Object.defineProperty(Promise, Symbol.species, SPECIES)
})

describe('ResendEmailProvider.send when the species getter throws during the send', () => {
  it('should leave no rejection unhandled', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    mockResendCtor.mockImplementation(() => ({ emails: { send: mockSend } }))
    mockSend.mockImplementation(() => {
      Object.defineProperty(Promise, Symbol.species, {
        configurable: true,
        get() {
          throw new Error('species broke')
        }
      })
      return Promise.reject(new Error('relay refused'))
    })

    const sent = new ResendEmailProvider({ apiKey: 're_x' }).send({
      to: 'jane@acme.com',
      from: 'noreply@acme.com',
      subject: 's',
      html: '<p>hi</p>'
    })
    let failed = false
    try {
      await sent
    } catch {
      failed = true
    }
    Object.defineProperty(Promise, Symbol.species, SPECIES)
    await new Promise<void>((resolve) => setImmediate(resolve))
    process.off('unhandledRejection', listener)

    expect([failed, unhandled.length]).toStrictEqual([true, 0])
  })
})
