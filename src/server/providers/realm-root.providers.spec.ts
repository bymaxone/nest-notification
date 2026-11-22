/**
 * @fileoverview Holds both mail adapters to the realm-root check at boot and right before the call
 * that does I/O: a name planted after construction (getSocket, raw, an arbitrary name, timeout) is
 * refused before the transport or the SDK is touched, and a clean send is unchanged.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'

import { ResendEmailProvider } from './resend-email.provider'
import { SmtpEmailProvider } from './smtp-email.provider'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factories.
const mockCreateTransport = jest.fn()
const mockSendMail = jest.fn()
const mockResendSend = jest.fn()
jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})
jest.mock(
  'resend',
  () => ({
    __esModule: true,
    Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } }))
  }),
  { virtual: true }
)

const MESSAGE = { to: 'a@x.com', from: 'f@x.com', subject: 's', html: '<p>x</p>' } as const
const NAMES = ['getSocket', 'raw', 'an-arbitrary-name', 'timeout']

let planted: string[] = []

function plant(name: string): void {
  Object.defineProperty(Object.prototype, name, {
    value: 'planted',
    configurable: true,
    writable: true,
    enumerable: false
  })
  planted.push(name)
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  mockCreateTransport.mockReset().mockImplementation(() => ({ sendMail: mockSendMail }))
  mockSendMail.mockReset().mockResolvedValue({ messageId: 'x' })
  mockResendSend.mockReset().mockResolvedValue({ data: { id: 'r1' }, error: null })
})

afterEach(() => {
  for (const name of planted) {
    Reflect.deleteProperty(Object.prototype, name)
  }
  planted = []
})

describe.each(NAMES)('a %s planted after the adapter was built', (name) => {
  it('should refuse the SMTP send before any transport is created or used', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })
    plant(name)

    await expect(provider.send(MESSAGE)).rejects.toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
    expect(mockCreateTransport).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('should refuse the Resend send before the SDK is called', async () => {
    const provider = new ResendEmailProvider({ apiKey: 'k' })
    plant(name)

    await expect(provider.send(MESSAGE)).rejects.toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('should refuse to build either adapter', () => {
    plant(name)

    expect(() => new SmtpEmailProvider({ host: 'h' })).toThrow(
      expect.objectContaining({ code: 'notification.invalid_scope_identifier' })
    )
    expect(() => new ResendEmailProvider({ apiKey: 'k' })).toThrow(
      expect.objectContaining({ code: 'notification.invalid_scope_identifier' })
    )
  })
})

describe('a name planted between the first check and the call that does I/O', () => {
  it('should refuse the SMTP message at the hand-over to the transport', async () => {
    mockCreateTransport.mockImplementation(() => {
      plant('raw')
      return { sendMail: mockSendMail }
    })

    await expect(new SmtpEmailProvider({ host: 'h' }).send(MESSAGE)).rejects.toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
    expect(mockSendMail).not.toHaveBeenCalled()
  })

  it('should refuse the Resend payload at the SDK call', async () => {
    const provider = new ResendEmailProvider({ apiKey: 'k' })
    await provider.send(MESSAGE)
    mockResendSend.mockImplementation(() => {
      throw new Error('must not run')
    })
    plant('getSocket')

    await expect(provider.send(MESSAGE)).rejects.toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
  })
})

describe('a clean realm root', () => {
  it('should send as before through both adapters', async () => {
    await expect(new SmtpEmailProvider({ host: 'h' }).send(MESSAGE)).resolves.toStrictEqual({
      messageId: 'x'
    })
    await expect(new ResendEmailProvider({ apiKey: 'k' }).send(MESSAGE)).resolves.toStrictEqual({
      messageId: 'r1'
    })
  })
})
