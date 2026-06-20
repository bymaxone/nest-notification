import { Logger } from '@nestjs/common'

import type { EmailSendOptions } from '../interfaces/email-provider.interface'

import { ResendEmailProvider } from './resend-email.provider'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockSend = jest.fn()
const mockResendCtor = jest.fn()
// Toggled on (with a registry reset) to simulate the optional peer dep being absent.
let mockResendMissing = false

// `resend` is an optional peer dep that is NOT installed; the virtual flag lets
// jest register a mock module for the lazy `import('resend')`. After a
// `jest.resetModules()` the factory re-runs and honours `mockResendMissing`.
jest.mock(
  'resend',
  () => {
    if (mockResendMissing) {
      throw new Error('Cannot find module')
    }
    return { __esModule: true, Resend: mockResendCtor }
  },
  { virtual: true }
)

const baseOptions: EmailSendOptions = {
  to: 'jane@acme.com',
  from: 'noreply@acme.com',
  subject: 'Your code',
  html: '<p>Secret 123456</p>',
  text: 'Secret 123456'
}

describe('ResendEmailProvider', () => {
  beforeEach(() => {
    mockResendCtor.mockImplementation(() => ({ emails: { send: mockSend } }))
    mockSend.mockResolvedValue({ data: { id: 'msg_123' }, error: null })
  })

  // Identity + configured-state derive purely from the presence of an API key.
  it('should report name "resend" and reflect apiKey presence in isConfigured', () => {
    expect(new ResendEmailProvider({ apiKey: 'k' }).name).toBe('resend')
    expect(new ResendEmailProvider({ apiKey: 'k' }).isConfigured()).toBe(true)
    expect(new ResendEmailProvider({}).isConfigured()).toBe(false)
    expect(new ResendEmailProvider().isConfigured()).toBe(false)
  })

  // Without an API key the lazy client cannot be built — fail closed with a clear message.
  it('should throw "missing API key" when send is called without an apiKey', async () => {
    await expect(new ResendEmailProvider({}).send(baseOptions)).rejects.toThrow('missing API key')
  })

  // A display name must be folded into the RFC-5322 "Name <email>" from header.
  it('should build the from header as "Name <email>" when fromName is provided', async () => {
    const provider = new ResendEmailProvider({ apiKey: 'k' })

    const result = await provider.send({ ...baseOptions, fromName: 'Acme' })

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Acme <noreply@acme.com>' })
    )
    expect(result).toEqual({ messageId: 'msg_123' })
  })

  // Without a display name the bare from address is used.
  it('should use the bare from address when fromName is absent', async () => {
    await new ResendEmailProvider({ apiKey: 'k' }).send(baseOptions)

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ from: 'noreply@acme.com' }))
  })

  // With neither fromName nor from, the from header falls back to an empty string.
  it('should fall back to an empty from header when neither fromName nor from is set', async () => {
    const { from: _from, ...withoutFrom } = baseOptions

    await new ResendEmailProvider({ apiKey: 'k' }).send(withoutFrom)

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ from: '' }))
  })

  // A display name with NO address must not emit the broken `Name <undefined>` /
  // `Name <>` header — it falls back to the bare (empty) address instead.
  it('should not apply the display-name format when fromName is set but from is absent', async () => {
    const { from: _from, ...withoutFrom } = baseOptions

    await new ResendEmailProvider({ apiKey: 'k' }).send({ ...withoutFrom, fromName: 'Acme' })

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ from: '' }))
  })

  // The SDK client is instantiated once and reused across sends (lazy + cached).
  it('should construct the SDK client only once across multiple sends', async () => {
    const provider = new ResendEmailProvider({ apiKey: 'k' })

    await provider.send(baseOptions)
    await provider.send(baseOptions)

    expect(mockResendCtor).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  // Concurrent first sends must share one in-flight init: the dynamic import and
  // constructor run exactly once even when several callers race on a fresh provider.
  it('should perform the dynamic import only once under concurrent first sends', async () => {
    const provider = new ResendEmailProvider({ apiKey: 'k' })

    await Promise.all([provider.send(baseOptions), provider.send(baseOptions)])

    expect(mockResendCtor).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledTimes(2)
  })

  // A failed init must not permanently brick the provider: the cached promise is
  // dropped so a later send re-imports and succeeds once the dependency is present.
  it('should reset the cached init after a failed load so a later send can retry', async () => {
    const provider = new ResendEmailProvider({ apiKey: 'k' })
    mockResendMissing = true
    jest.resetModules() // force the virtual mock factory to throw on the first import

    await expect(provider.send(baseOptions)).rejects.toThrow('`resend` package is not installed')

    mockResendMissing = false
    jest.resetModules() // the dependency is "installed" again

    await expect(provider.send(baseOptions)).resolves.toEqual({ messageId: 'msg_123' })
    expect(mockResendCtor).toHaveBeenCalledTimes(1)
  })

  // A provider error is surfaced as an Error and logged WITHOUT the email body.
  it('should propagate a Resend error and never log the body', async () => {
    mockSend.mockResolvedValue({ data: null, error: { message: 'rate limited' } })
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(new ResendEmailProvider({ apiKey: 'k' }).send(baseOptions)).rejects.toThrow(
      'Resend send failed: rate limited'
    )
    const logged = String(warnSpy.mock.calls[0]?.[0])
    expect(logged).toContain('rate limited')
    expect(logged).not.toContain('Secret 123456')
  })

  // A success result with no message id is a contract violation — fail loudly.
  it('should throw when the SDK returns no message id', async () => {
    mockSend.mockResolvedValue({ data: null, error: null })

    await expect(new ResendEmailProvider({ apiKey: 'k' }).send(baseOptions)).rejects.toThrow(
      'Resend returned no message ID'
    )
  })

  // When the optional peer dep is missing, point the consumer at the install command.
  it('should throw a helpful error when the resend package is not installed', async () => {
    mockResendMissing = true
    jest.resetModules() // force the virtual mock factory to re-run and throw

    try {
      await expect(new ResendEmailProvider({ apiKey: 'k' }).send(baseOptions)).rejects.toThrow(
        '`resend` package is not installed'
      )
    } finally {
      mockResendMissing = false
    }
  })
})
