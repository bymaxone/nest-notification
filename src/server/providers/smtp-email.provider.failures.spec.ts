/**
 * @fileoverview Failure-path specs for SmtpEmailProvider: error wrapping and
 * the scrubbing of credentials, declared redactValues, and echoed body content
 * out of transport/initialization errors. The transport-configuration and
 * happy-path specs live in `smtp-email.provider.spec.ts`; shared fixtures in
 * `__tests__/smtp-email-provider.fixtures.ts`.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'

import { baseOptions } from './__tests__/smtp-email-provider.fixtures'
import { SmtpEmailProvider } from './smtp-email.provider'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockSendMail = jest.fn()
const mockCreateTransport = jest.fn()

// `nodemailer` is an optional peer dep that is NOT installed; the virtual flag
// lets jest register a mock module for the lazy `import('nodemailer')`. These
// specs never simulate a missing/broken package, so the factory is minimal —
// the import-failure shapes are pinned in `smtp-email.provider.spec.ts`.
jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

describe('SmtpEmailProvider failure handling', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }))
    mockSendMail.mockResolvedValue({ messageId: '<abc@mailpit>' })
  })

  // A transport error is surfaced as an Error and logged WITHOUT the email body,
  // which carries the OTP code.
  it('should propagate a transport error and never log the body', async () => {
    mockSendMail.mockRejectedValue(new Error('550 mailbox unavailable'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(new SmtpEmailProvider({ host: 'h' }).send(baseOptions)).rejects.toThrow(
      'SMTP send failed: 550 mailbox unavailable'
    )
    const logged = String(warnSpy.mock.calls[0]?.[0])
    expect(logged).toContain('550 mailbox unavailable')
    expect(logged).not.toContain('Secret 123456')
    warnSpy.mockRestore()
  })

  // SECURITY (regression for the community-core finding): a policy/DLP relay
  // that quotes the rejected content in its 550 puts the body — and the OTP
  // inside it — into the transport error. The echoed excerpt is scrubbed
  // from the warn line and from the thrown message, with no declaration.
  it('should scrub echoed body content out of a transport error', async () => {
    const body = String(baseOptions.html)
    mockSendMail.mockRejectedValue(
      new Error(`550 5.7.1 rejected by policy - message body was: ${body.slice(0, 40)}`)
    )
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(new SmtpEmailProvider({ host: 'h' }).send(baseOptions)).rejects.toThrow(
      /^SMTP send failed: 550 5\.7\.1 rejected by policy/
    )
    const logged = String(warnSpy.mock.calls[0]?.[0])
    expect(logged).toContain('550 5.7.1 rejected by policy')
    expect(logged).toContain('[redacted]')
    expect(logged).not.toContain('Secret 123456')
    warnSpy.mockRestore()
  })

  // An echo of the PLAIN-TEXT part alone (absent from the HTML) must be
  // detected too — pins the text-reference branch.
  it('should scrub content echoed only from the text body', async () => {
    const textOnly = 'plain-only sentence with code 998877 inside it'
    mockSendMail.mockRejectedValue(new Error(`550 quoted: ${textOnly.slice(0, 40)}`))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(
      new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, text: textOnly })
    ).rejects.toThrow(/^SMTP send failed: 550 quoted: \[redacted\]/)
    const logged = String(warnSpy.mock.calls[0]?.[0])
    expect(logged).not.toContain('998877')
    warnSpy.mockRestore()
  })

  // An options set WITHOUT a plain-text part must not break the echo scrub —
  // pins the `payload.text` guard's absent side.
  it('should handle a transport error when no text body was sent', async () => {
    mockSendMail.mockRejectedValue(new Error('421 service not available'))
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const { text: _text, ...withoutText } = baseOptions

    await expect(new SmtpEmailProvider({ host: 'h' }).send(withoutText)).rejects.toThrow(
      'SMTP send failed: 421 service not available'
    )
  })

  // Declared secrets travel to the provider as `redactValues` and are
  // scrubbed from the warn line even when the echo is too short to detect.
  it('should scrub declared redactValues out of a transport error', async () => {
    mockSendMail.mockRejectedValue(new Error('550 rejected: 998877'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(
      new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, redactValues: ['998877'] })
    ).rejects.toThrow('SMTP send failed: 550 rejected: [redacted]')
    const logged = String(warnSpy.mock.calls[0]?.[0])
    expect(logged).not.toContain('998877')
    warnSpy.mockRestore()
  })

  // A transport can reject with a non-Error value; it must still produce a usable
  // message rather than "[object Object]" swallowing the cause.
  it('should stringify a non-Error rejection', async () => {
    mockSendMail.mockRejectedValue('ECONNREFUSED')
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(new SmtpEmailProvider({ host: 'h' }).send(baseOptions)).rejects.toThrow(
      'SMTP send failed: ECONNREFUSED'
    )
  })

  // A relay can echo the failing command back, and a socket error can carry the
  // connection options — either would otherwise put the password into the log line
  // and into the audit entry EmailService writes from the thrown message.
  it('should scrub the password out of a transport error', async () => {
    const pass = 'hunter2-LEAKCANARY'
    mockSendMail.mockRejectedValue(new Error(`535 auth failed for AUTH PLAIN ${pass}`))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const provider = new SmtpEmailProvider({
      host: 'h',
      credentials: { user: 'relay-user', pass }
    })

    await expect(provider.send(baseOptions)).rejects.toThrow(
      'SMTP send failed: 535 auth failed for AUTH PLAIN [redacted]'
    )
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain(pass)
    warnSpy.mockRestore()
  })

  // The send path is not the only one that can surface the credential: a transport
  // that validates its configuration eagerly throws while being BUILT, and that
  // failure reaches the same audit entry.
  it('should scrub the password out of an initialization failure', async () => {
    const pass = 'init-LEAKCANARY'
    mockCreateTransport.mockImplementation(() => {
      throw new Error(`invalid config: {"pass":"${pass}"}`)
    })
    const provider = new SmtpEmailProvider({ host: 'h', credentials: { user: 'u', pass } })

    await expect(provider.send(baseOptions)).rejects.toThrow(
      'invalid config: {"pass":"[redacted]"}'
    )
  })

  // A non-Error thrown while building the transport must be scrubbed too, rather
  // than slipping past the `instanceof Error` branch with the credential intact.
  it('should scrub the password out of a non-Error initialization failure', async () => {
    const pass = 'init-string-LEAKCANARY'
    mockCreateTransport.mockImplementation(() => {
      throw `boom ${pass}`
    })
    const provider = new SmtpEmailProvider({ host: 'h', credentials: { user: 'u', pass } })

    await expect(provider.send(baseOptions)).rejects.toThrow('boom [redacted]')
  })

  // `IEmailProvider.send` documents that it throws an `Error`, so a transport that
  // rejects with a bare string must not be handed on raw just because it happened
  // to need no scrubbing — a direct caller is entitled to rely on the contract.
  it('should wrap a non-Error initialization failure that needed no scrubbing', async () => {
    mockCreateTransport.mockImplementation(() => {
      throw 'ECONNREFUSED'
    })
    const provider = new SmtpEmailProvider({ host: 'h' })

    const thrown: unknown = await provider.send(baseOptions).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('ECONNREFUSED')
  })

  // An init failure with nothing to scrub must reach the caller as the very same
  // object — rewrapping it would throw away its type and its stack for no gain.
  it('should rethrow an untouched initialization failure by identity', async () => {
    const failure = new Error('ECONNREFUSED')
    mockCreateTransport.mockImplementation(() => {
      throw failure
    })
    const provider = new SmtpEmailProvider({
      host: 'h',
      credentials: { user: 'u', pass: 'unrelated' }
    })

    await expect(provider.send(baseOptions)).rejects.toBe(failure)
  })

  // The user is not always a public login: an SES SMTP username is itself
  // generated secret material, so it is scrubbed alongside the password.
  it('should scrub the user as well as the password', async () => {
    const user = 'AKIA-USER-LEAKCANARY'
    const pass = 'pass-LEAKCANARY'
    mockSendMail.mockRejectedValue(new Error(`535 rejected ${user} / ${pass}`))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const provider = new SmtpEmailProvider({ host: 'h', credentials: { user, pass } })

    await expect(provider.send(baseOptions)).rejects.toThrow(
      'SMTP send failed: 535 rejected [redacted] / [redacted]'
    )
    const logged = String(warnSpy.mock.calls[0]?.[0])
    expect(logged).not.toContain(user)
    expect(logged).not.toContain(pass)
    warnSpy.mockRestore()
  })

  // The two credentials can overlap — a password built from the username. Replacing
  // the shorter one first would consume the prefix and leave `[redacted]-secret`,
  // so the half that actually distinguishes the password would survive into the log
  // and the audit entry. Longest is replaced first.
  it('should redact the longer credential first when the two overlap', async () => {
    const user = 'relay'
    const pass = 'relay-secret'
    mockSendMail.mockRejectedValue(new Error(`535 rejected ${pass}`))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const provider = new SmtpEmailProvider({ host: 'h', credentials: { user, pass } })

    // An exact match, not a substring one: `[redacted]-secret` also *contains*
    // `535 rejected [redacted]`, so a loose assertion would pass on the bug.
    await expect(provider.send(baseOptions)).rejects.toThrow(
      new Error('SMTP send failed: 535 rejected [redacted]')
    )
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('secret')
    warnSpy.mockRestore()
  })

  // The same hazard with the lengths the other way round: the password is the
  // shorter credential and a prefix of the username.
  it('should redact the longer credential first when the password is the shorter one', async () => {
    const user = 'relay-account'
    const pass = 'relay'
    mockSendMail.mockRejectedValue(new Error(`535 rejected ${user}`))
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const provider = new SmtpEmailProvider({ host: 'h', credentials: { user, pass } })

    await expect(provider.send(baseOptions)).rejects.toThrow(
      new Error('SMTP send failed: 535 rejected [redacted]')
    )
  })

  // Matching is literal and unconditional, so a one-character credential rewrites
  // every occurrence of that character. That is the deliberate direction: this
  // control's other failure mode is persisting a secret in the audit log, and
  // real credentials are not one character long.
  it('should over-redact rather than risk a miss on a very short credential', async () => {
    mockSendMail.mockRejectedValue(new Error('connection aborted'))
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const provider = new SmtpEmailProvider({ host: 'h', credentials: { user: 'o', pass: 'p' } })

    await expect(provider.send(baseOptions)).rejects.toThrow(
      'SMTP send failed: c[redacted]nnecti[redacted]n ab[redacted]rted'
    )
  })

  // With no credentials configured there is nothing to scrub — the relay's own
  // message must reach the log intact rather than being mangled.
  it('should leave the error message untouched when no password is configured', async () => {
    mockSendMail.mockRejectedValue(new Error('421 service not available'))
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(new SmtpEmailProvider({ host: 'h' }).send(baseOptions)).rejects.toThrow(
      'SMTP send failed: 421 service not available'
    )
  })
})
