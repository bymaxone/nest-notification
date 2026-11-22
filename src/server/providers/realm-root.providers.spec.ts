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
const mockVerify = jest.fn()
const mockResendSend = jest.fn()
jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})
const mockResendClient = jest.fn()
jest.mock(
  'resend',
  () => ({
    __esModule: true,
    Resend: function Resend() {
      return mockResendClient()
    }
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
  mockVerify.mockReset().mockResolvedValue(true)
  mockCreateTransport
    .mockReset()
    .mockImplementation(() => ({ sendMail: mockSendMail, verify: mockVerify }))
  mockSendMail.mockReset().mockResolvedValue({ messageId: 'x' })
  mockResendSend.mockReset().mockResolvedValue({ data: { id: 'r1' }, error: null })
  mockResendClient.mockReset().mockImplementation(() => ({ emails: { send: mockResendSend } }))
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

  it('should refuse the SMTP readiness check before any transport is created or used', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })
    plant(name)

    await expect(provider.verify()).rejects.toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
    expect(mockCreateTransport).not.toHaveBeenCalled()
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('should refuse the Resend send before the SDK is called', async () => {
    const provider = new ResendEmailProvider({ apiKey: 'k' })
    plant(name)

    await expect(provider.send(MESSAGE)).rejects.toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
    expect(mockResendClient).not.toHaveBeenCalled()
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

  it('should refuse the readiness check, not run it, against a root planted after the transport was created', async () => {
    mockCreateTransport.mockImplementation(() => {
      plant('getSocket')
      return { sendMail: mockSendMail, verify: mockVerify }
    })

    await expect(new SmtpEmailProvider({ host: 'h' }).verify()).rejects.toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
    expect(mockVerify).not.toHaveBeenCalled()
  })

  it('should refuse the Resend payload at the SDK call when the SDK client was loaded after the first check', async () => {
    mockResendClient.mockImplementation(() => {
      plant('getSocket')
      return { emails: { send: mockResendSend } }
    })

    await expect(new ResendEmailProvider({ apiKey: 'k' }).send(MESSAGE)).rejects.toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
    expect(mockResendSend).not.toHaveBeenCalled()
  })
})

describe('the readiness check', () => {
  it('should call the transport in the run of the check, with no promise reaction between them', async () => {
    const resolve = jest.spyOn(Promise, 'resolve')
    const provider = new SmtpEmailProvider({ host: 'h' })
    await provider.verify()
    resolve.mockClear()

    await provider.verify()

    // The mock transport answers with `Promise.resolve(value)`; a hop of the adapter's own has no argument.
    expect(resolve.mock.calls.filter((call: readonly unknown[]) => call.length === 0)).toHaveLength(
      0
    )
    expect(mockVerify).toHaveBeenCalledTimes(2)
  })
})

describe('a clean realm root', () => {
  it('should send as before through both adapters', async () => {
    await expect(new SmtpEmailProvider({ host: 'h' }).send(MESSAGE)).resolves.toStrictEqual({
      messageId: 'x'
    })
    await expect(new SmtpEmailProvider({ host: 'h' }).verify()).resolves.toBeUndefined()
    await expect(new ResendEmailProvider({ apiKey: 'k' }).send(MESSAGE)).resolves.toStrictEqual({
      messageId: 'r1'
    })
  })
})

describe.each(['hasOwnProperty', 'toString', 'constructor'])(
  'an overwritten standard key %s after the adapter was built',
  (name) => {
    function overwritten<T>(act: () => Promise<T>): Promise<unknown> {
      const original = Object.getOwnPropertyDescriptor(Object.prototype, name) as PropertyDescriptor
      Object.defineProperty(Object.prototype, name, { ...original, value: 1 })
      return act()
        .then(
          () => undefined,
          (error: unknown) => error
        )
        .finally(() => Object.defineProperty(Object.prototype, name, original))
    }

    it('should refuse the SMTP send and the readiness check before any I/O', async () => {
      const provider = new SmtpEmailProvider({ host: 'h' })

      const sent = await overwritten(() => provider.send(MESSAGE))
      const verified = await overwritten(() => provider.verify())

      expect(sent).toMatchObject({ code: 'notification.invalid_scope_identifier' })
      expect(verified).toMatchObject({ code: 'notification.invalid_scope_identifier' })
      expect(mockSendMail).not.toHaveBeenCalled()
      expect(mockVerify).not.toHaveBeenCalled()
    })

    it('should refuse the Resend send before the SDK is called', async () => {
      const provider = new ResendEmailProvider({ apiKey: 'k' })

      const sent = await overwritten(() => provider.send(MESSAGE))

      expect(sent).toMatchObject({ code: 'notification.invalid_scope_identifier' })
      expect(mockResendSend).not.toHaveBeenCalled()
    })
  }
)

describe('the refusal names the adapter that refused, at every point that checks', () => {
  /** The `boundary` of the refusal a call raised, or `undefined` when it raised none. */
  async function boundaryOf(call: () => unknown): Promise<unknown> {
    try {
      await call()
    } catch (error) {
      const response = (error as { getResponse?: () => unknown }).getResponse?.()
      return (response as { error?: { details?: { boundary?: unknown } } } | undefined)?.error
        ?.details?.boundary
    }
    return undefined
  }

  it('should name SmtpEmailProvider when it is built, when a send starts and when verify starts', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })
    plant('anything')

    expect(await boundaryOf(() => new SmtpEmailProvider({ host: 'h' }))).toBe('SmtpEmailProvider')
    expect(await boundaryOf(() => provider.send(MESSAGE))).toBe('SmtpEmailProvider')
    expect(await boundaryOf(() => provider.verify())).toBe('SmtpEmailProvider')
  })

  it('should name SmtpEmailProvider at the hand-over to the transport and before transport.verify', async () => {
    mockCreateTransport.mockImplementation(() => {
      plant('anything')
      return { sendMail: mockSendMail, verify: mockVerify }
    })

    expect(await boundaryOf(() => new SmtpEmailProvider({ host: 'h' }).send(MESSAGE))).toBe(
      'SmtpEmailProvider'
    )
    expect(await boundaryOf(() => new SmtpEmailProvider({ host: 'h' }).verify())).toBe(
      'SmtpEmailProvider'
    )
  })

  it('should name ResendEmailProvider when it is built, when a send starts and at the SDK call', async () => {
    const provider = new ResendEmailProvider({ apiKey: 'k' })
    plant('anything')

    expect(await boundaryOf(() => new ResendEmailProvider({ apiKey: 'k' }))).toBe(
      'ResendEmailProvider'
    )
    expect(await boundaryOf(() => provider.send(MESSAGE))).toBe('ResendEmailProvider')
    Reflect.deleteProperty(Object.prototype, 'anything')
    mockResendClient.mockImplementation(() => {
      plant('anything')
      return { emails: { send: mockResendSend } }
    })
    expect(await boundaryOf(() => new ResendEmailProvider({ apiKey: 'k' }).send(MESSAGE))).toBe(
      'ResendEmailProvider'
    )
  })
})
