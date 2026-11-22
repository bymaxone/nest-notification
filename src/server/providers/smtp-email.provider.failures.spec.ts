/**
 * @fileoverview Failure-path specs for SmtpEmailProvider: error wrapping and
 * the scrubbing of credentials, declared redactValues, and echoed body content
 * out of transport/initialization errors. The transport-configuration and
 * happy-path specs live in `smtp-email.provider.spec.ts`; shared fixtures in
 * `__tests__/smtp-email-provider.fixtures.ts`.
 * @layer infrastructure
 */

import * as vm from 'node:vm'

import { Logger } from '@nestjs/common'

import { baseOptions } from './__tests__/smtp-email-provider.fixtures'
import { NotificationException } from '../errors/notification-exception'

import { BIDI_OVERRIDE, hasRawControl } from './__tests__/has-raw-control'
import { SmtpEmailProvider } from './smtp-email.provider'
import { loggedEvent, loggedAll } from '../__tests__/logged'

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
    const logged = loggedAll(warnSpy.mock.calls[0])
    expect(loggedEvent(warnSpy.mock.calls[0])).toBe('NOTIFICATION_SMTP_SEND_FAILED')
    expect(logged).toContain('550 mailbox unavailable')
    expect(logged).not.toContain('Secret 123456')
    warnSpy.mockRestore()
  })

  // A relay quotes the address it refused; the thrown message and the log line both carry it masked.
  it('should mask the address a relay quoted in the thrown message and in the log line', async () => {
    mockSendMail.mockRejectedValue(new Error('550 <bob@x.com>: Recipient rejected'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const caught = (await new SmtpEmailProvider({ host: 'h' })
      .send(baseOptions)
      .catch((error: unknown) => error)) as Error

    expect(caught.message).toBe('SMTP send failed: 550 <[address]>: Recipient rejected')
    expect(loggedAll(warnSpy.mock.calls[0])).toContain('550 <[address]>: Recipient rejected')
    expect(loggedAll(warnSpy.mock.calls[0])).not.toContain('bob@x.com')
    warnSpy.mockRestore()
  })

  it('should read each field of an attachment once, so the encoding describes the content sent', async () => {
    let reads = 0
    const attachment = {
      filename: 'a.txt',
      get content(): string | Buffer {
        reads += 1
        return reads === 1 ? 'eA==' : Buffer.from('x')
      }
    }

    await new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, attachments: [attachment] })

    expect(reads).toBe(1)
    expect(mockSendMail.mock.calls[0]?.[0].attachments[0]).toMatchObject({
      content: 'eA==',
      encoding: 'base64'
    })
  })

  // The passphrase of a client key is secret material like a password: a transport error that
  // quotes the connection options must not put it in the thrown message or the warn line.
  it('should scrub the tls passphrase out of a transport error', async () => {
    mockSendMail.mockRejectedValue(new Error('TLS setup failed with passphrase tls-secret-phrase'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const failure = new SmtpEmailProvider({
      host: 'h',
      tls: { passphrase: 'tls-secret-phrase' }
    }).send(baseOptions)

    await expect(failure).rejects.toThrow('SMTP send failed: TLS setup failed with passphrase')
    await expect(failure).rejects.not.toThrow(/tls-secret-phrase/)
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('tls-secret-phrase')
    warnSpy.mockRestore()
  })

  // A client key can carry its own passphrase, as a { pem, passphrase } entry and as a { buf,
  // passphrase } pfx: each is secret material and is scrubbed like the one on tls itself.
  it('should scrub the passphrase carried by a key entry and a pfx entry', async () => {
    mockSendMail.mockRejectedValue(new Error('TLS failed: key-entry-phrase and pfx-entry-phrase'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const failure = new SmtpEmailProvider({
      host: 'h',
      tls: {
        key: ['plain', { pem: 'pem', passphrase: 'key-entry-phrase' }],
        pfx: [{ buf: 'buf', passphrase: 'pfx-entry-phrase' }]
      }
    }).send(baseOptions)

    await expect(failure).rejects.toThrow('SMTP send failed: TLS failed: [redacted] and [redacted]')
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toMatch(/entry-phrase/)
    warnSpy.mockRestore()
  })

  // The passphrase that is scrubbed is the one that was checked: an entry whose getter answers
  // differently later cannot leave the first answer unscrubbed.
  it('should scrub the passphrase an entry gave when it was copied, not one it gives later', async () => {
    mockSendMail.mockRejectedValue(new Error('TLS failed: first-phrase'))
    let reads = 0
    const entry = {
      pem: 'pem',
      get passphrase(): string | undefined {
        reads += 1
        return reads === 1 ? 'first-phrase' : undefined
      }
    }
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const failure = new SmtpEmailProvider({ host: 'h', tls: { key: [entry] } }).send(baseOptions)

    await expect(failure).rejects.toThrow('SMTP send failed: TLS failed: [redacted]')
    expect(String(warnSpy.mock.calls[0]?.[0])).not.toContain('first-phrase')
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
    const logged = loggedAll(warnSpy.mock.calls[0])
    expect(logged).toContain('550 5.7.1 rejected by policy')
    expect(logged).toContain('[redacted]')
    expect(logged).not.toContain('Secret 123456')
    warnSpy.mockRestore()
  })

  // The relay's reply is not ours: a line feed in it would start a second record in any log that
  // writes lines, and a bidirectional control would make a line read as another. The warn line
  // carries the reason with every control written as a visible sequence; the thrown message is
  // the caller's API and keeps the text as it came.
  it('should write a control character of a transport reply as a visible sequence', async () => {
    const reply = `550 no\nforged [SMTP_SEND_FAILED] ok${BIDI_OVERRIDE}`
    mockSendMail.mockRejectedValue(new Error(reply))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(new SmtpEmailProvider({ host: 'h' }).send(baseOptions)).rejects.toThrow(
      `SMTP send failed: ${reply}`
    )
    const logged = loggedAll(warnSpy.mock.calls[0])
    expect(hasRawControl(logged)).toBe(false)
    expect(logged).toContain('SMTP send failed: 550 no\\nforged [SMTP_SEND_FAILED] ok\\u202e')
    warnSpy.mockRestore()
  })

  // The escape runs AFTER the scrub: a declared secret that holds a line feed is still matched
  // as written. Escaping first would leave '\\n' in the reason and the secret would survive.
  it('should scrub a declared value that holds a line feed before escaping', async () => {
    mockSendMail.mockRejectedValue(new Error('550 rejected: pass\nword'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(
      new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, redactValues: ['pass\nword'] })
    ).rejects.toThrow('SMTP send failed: 550 rejected: [redacted]')
    expect(loggedAll(warnSpy.mock.calls[0])).toContain('SMTP send failed: 550 rejected: [redacted]')
    warnSpy.mockRestore()
  })

  // A send with no html part (a JS caller, or one that bypasses the type) must fail with the
  // SMTP error, not a TypeError from reading the missing part, and the scrub must still remove the
  // declared values, the credentials and an echo of the text part.
  it('should scrub the error of a send that has no html part', async () => {
    const text = 'Your password reset code is 998877. It expires shortly.'
    mockSendMail.mockRejectedValue(
      new Error(`535 login hunter2 failed for secret42, body was: ${text.slice(2, 50)}`)
    )
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const provider = new SmtpEmailProvider({
      host: 'h',
      credentials: { user: 'u', pass: 'hunter2' }
    })

    const caught: unknown = await provider
      .send({ ...baseOptions, html: undefined, text, redactValues: ['secret42'] } as never)
      .catch((error: unknown) => error)

    expect(caught).not.toBeInstanceOf(TypeError)
    expect((caught as Error).message).toMatch(/^SMTP send failed: 535 login \[redacted\] failed/)
    for (const leaked of ['hunter2', 'secret42', '998877']) {
      expect((caught as Error).message).not.toContain(leaked)
      expect(loggedAll(warnSpy.mock.calls[0])).not.toContain(leaked)
    }
    warnSpy.mockRestore()
  })

  // The transport would send these parts as content the echo scrub cannot read, so the provider
  // refuses them before it builds a transport.
  it.each([
    ['html', { html: Buffer.from('<p>x</p>') }],
    ['html', { html: { path: '/etc/hostname' } }],
    ['text', { text: Buffer.from('x') }],
    ['text', { text: new Uint8Array(2) }],
    ['text', { text: 42 }]
  ])('should refuse a %s part that is not a string', async (part, override) => {
    const caught: unknown = await new SmtpEmailProvider({ host: 'h' })
      .send({ ...baseOptions, ...override } as never)
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(NotificationException)
    expect(caught).toMatchObject({ code: 'notification.email_missing_body' })
    expect((caught as NotificationException).getResponse()).toMatchObject({
      error: { details: { part } }
    })
    expect(mockCreateTransport).not.toHaveBeenCalled()
    expect(mockSendMail).not.toHaveBeenCalled()
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
    const logged = loggedAll(warnSpy.mock.calls[0])
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

  // SECURITY (regression): the credential scrub used to run BEFORE echo
  // detection, so a body quoting the password split the echoed run in two —
  // each half below the 16-character window — and everything after the
  // password, including the OTP, reached the log line. Detection now runs
  // against the raw message and every value is replaced in one pass.
  it('should still detect the echo when the quoted body contains the password', async () => {
    const pass = 'SUPERSECRETPASSWORD'
    // The segment before the password is a detectable echo on its own; the one
    // after it (' 998877 ok') is not — only whole-run detection covers it.
    const body = `<p>Hello Jane and team, ${pass} 998877 ok</p>`
    mockSendMail.mockRejectedValue(new Error(`550 quoted: Hello Jane and team, ${pass} 998877 ok`))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const provider = new SmtpEmailProvider({
      host: 'h',
      credentials: { user: 'relay-user', pass }
    })
    const { text: _text, ...withoutText } = baseOptions

    const thrown: unknown = await provider
      .send({ ...withoutText, html: body })
      .catch((error: unknown) => error)

    const message = (thrown as Error).message
    expect(message).toContain('550 quoted:')
    expect(message).not.toContain('998877')
    expect(message).not.toContain(pass)
    expect(loggedAll(warnSpy.mock.calls[0])).not.toContain('998877')
    warnSpy.mockRestore()
  })

  // SECURITY: coercing the rejection runs consumer code. A `message` getter
  // that throws a secret-bearing error must not escape from BEFORE the
  // withholding branch — the flag would be honoured by a line that never runs.
  it('should withhold even when the error message getter throws', async () => {
    const hostile = new Error('shell')
    Object.defineProperty(hostile, 'message', {
      get: (): never => {
        throw new Error('getter leaked 998877')
      }
    })
    mockSendMail.mockRejectedValue(hostile)
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const thrown: unknown = await new SmtpEmailProvider({ host: 'h' })
      .send({ ...baseOptions, publishProviderText: false })
      .catch((error: unknown) => error)

    expect((thrown as Error).message).toBe('SMTP send failed')
    expect(loggedAll(warnSpy.mock.calls[0])).not.toContain('998877')
    warnSpy.mockRestore()
  })

  // Declared secrets travel to the provider as `redactValues` and are
  // scrubbed from the warn line even when the echo is too short to detect.
  it('should scrub declared redactValues out of a transport error', async () => {
    mockSendMail.mockRejectedValue(new Error('550 rejected: 998877'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(
      new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, redactValues: ['998877'] })
    ).rejects.toThrow('SMTP send failed: 550 rejected: [redacted]')
    const logged = loggedAll(warnSpy.mock.calls[0])
    expect(logged).not.toContain('998877')
    warnSpy.mockRestore()
  })

  // SECURITY: with `publishProviderText: false` the relay's own words reach
  // neither the warn line nor the thrown message — not even redacted — because
  // redaction cannot cover an echo the caller did not predict. Only the reply
  // codes survive, and they are independent of what the body held.
  it('should publish only the reply codes when provider text is withheld', async () => {
    const body = '<p>Your code is 998877 and it expires soon</p>'
    mockSendMail.mockRejectedValue(new Error(`550 5.7.1 refused by policy - body: ${body}`))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const thrown: unknown = await new SmtpEmailProvider({ host: 'h' })
      .send({ ...baseOptions, html: body, publishProviderText: false })
      .catch((error: unknown) => error)

    expect((thrown as Error).message).toBe('SMTP send failed')
    expect(loggedAll(warnSpy.mock.calls[0])).toBe('[SMTP_SEND_FAILED] 550 5.7.1')
    expect(loggedAll(warnSpy.mock.calls[0])).not.toContain('998877')
    warnSpy.mockRestore()
  })

  // The codes ride as properties on the thrown error, because the message is a
  // fixed label by then and `EmailService` could not parse them back out.
  it('should attach the reply codes to the thrown error', async () => {
    mockSendMail.mockRejectedValue(new Error('550 5.7.1 refused by policy'))
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const thrown = (await new SmtpEmailProvider({ host: 'h' })
      .send({ ...baseOptions, publishProviderText: false })
      .catch((error: unknown) => error)) as Error & {
      deliveryStatus?: number
      deliveryEnhancedStatus?: string
    }

    expect(thrown.deliveryStatus).toBe(550)
    expect(thrown.deliveryEnhancedStatus).toBe('5.7.1')
  })

  // Absent codes must be genuinely absent keys, not `undefined` values — the
  // service reads them by type and a phantom key is a second thing to audit.
  it('should attach no code keys when the failure carries none', async () => {
    mockSendMail.mockRejectedValue(new Error('connection reset'))
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const thrown = (await new SmtpEmailProvider({ host: 'h' })
      .send({ ...baseOptions, publishProviderText: false })
      .catch((error: unknown) => error)) as Error

    expect('deliveryStatus' in thrown).toBe(false)
    expect('deliveryEnhancedStatus' in thrown).toBe(false)
  })

  // Only the basic code present: the basic key is attached, the enhanced one is
  // not — the two are independently absent.
  it('should attach only the basic code when no enhanced code is present', async () => {
    mockSendMail.mockRejectedValue(new Error('421 service not available'))
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const thrown = (await new SmtpEmailProvider({ host: 'h' })
      .send({ ...baseOptions, publishProviderText: false })
      .catch((error: unknown) => error)) as Error & { deliveryStatus?: number }

    expect(thrown.deliveryStatus).toBe(421)
    expect('deliveryEnhancedStatus' in thrown).toBe(false)
  })

  // SECURITY: this adapter is public, so its own warn line must apply the
  // filter too — waiting for EmailService would already have written a code
  // containing the caller's declared secret to the SMTP logger.
  it('should not log a reply code containing a declared secret', async () => {
    mockSendMail.mockRejectedValue(new Error('550 5.7.1 refused'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const thrown = (await new SmtpEmailProvider({ host: 'h' })
      .send({ ...baseOptions, publishProviderText: false, redactValues: ['55'] })
      .catch((error: unknown) => error)) as Error & { deliveryStatus?: number }

    expect(loggedAll(warnSpy.mock.calls[0])).toBe('[SMTP_SEND_FAILED] 5.7.1')
    expect('deliveryStatus' in thrown).toBe(false)
    warnSpy.mockRestore()
  })

  // A failure carrying no reply code says so, rather than falling back to the
  // relay's prose to have something to log.
  it('should say so when a withheld failure carries no reply code', async () => {
    mockSendMail.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1099'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(
      new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, publishProviderText: false })
    ).rejects.toThrow('SMTP send failed')
    expect(loggedAll(warnSpy.mock.calls[0])).toBe('[SMTP_SEND_FAILED] no reply code')
    warnSpy.mockRestore()
  })

  // The relay's words never reach the line: digits that end an identifier are not a reply code.
  it('should not publish digits from a word of the relay text in a withheld failure', async () => {
    mockSendMail.mockRejectedValue(new Error('x user=USER123 tenant=TEN456 token=SECRET789'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(
      new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, publishProviderText: false })
    ).rejects.toThrow('SMTP send failed')
    expect(loggedAll(warnSpy.mock.calls[0])).toBe('[SMTP_SEND_FAILED] no reply code')
    warnSpy.mockRestore()
  })

  // Only the basic code present: the line carries it alone, with no separator
  // left dangling and no invented enhanced value.
  it('should publish a lone basic status without padding', async () => {
    mockSendMail.mockRejectedValue(new Error('421 service not available'))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    await expect(
      new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, publishProviderText: false })
    ).rejects.toThrow('SMTP send failed')
    expect(loggedAll(warnSpy.mock.calls[0])).toBe('[SMTP_SEND_FAILED] 421')
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
    expect(loggedAll(warnSpy.mock.calls[0])).not.toContain(pass)
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

  // The message of a failure is read by shape, so a plain { message } and an Error from
  // another realm are scrubbed like an Error, and a value that cannot be printed becomes a
  // fixed phrase instead of a TypeError from String().
  it.each([
    [
      'a plain { message } object',
      (pass: string) => ({ message: `boom ${pass}` }),
      'boom [redacted]'
    ],
    [
      'an Error from another realm',
      (pass: string) => vm.runInNewContext(`new Error("boom ${pass}")`) as unknown,
      'boom [redacted]'
    ],
    ['an object with no prototype', () => Object.create(null) as unknown, 'unprintable error']
  ])('should describe %s thrown while building the transport', async (_label, make, expected) => {
    const pass = 'init-shape-LEAKCANARY'
    mockCreateTransport.mockImplementation(() => {
      throw make(pass)
    })
    const provider = new SmtpEmailProvider({
      host: 'h',
      credentials: { user: 'smtp-account', pass }
    })

    const thrown: unknown = await provider.send(baseOptions).catch((error: unknown) => error)

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe(expected)
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

  // An Error whose `message` getter throws cannot be rethrown as it is: every consumer that
  // reads the message would throw in turn. It is replaced by a plain Error with a fixed phrase.
  it('should replace an initialization failure whose message cannot be read', async () => {
    const hostile = new Error('shell')
    Object.defineProperty(hostile, 'message', {
      get: (): never => {
        throw new Error('getter')
      }
    })
    mockCreateTransport.mockImplementation(() => {
      throw hostile
    })
    const provider = new SmtpEmailProvider({
      host: 'h',
      credentials: { user: 'smtp-account', pass: 'unrelated' }
    })

    const thrown: unknown = await provider.send(baseOptions).catch((error: unknown) => error)

    expect(thrown).not.toBe(hostile)
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toBe('unprintable error')
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
    const logged = loggedAll(warnSpy.mock.calls[0])
    expect(logged).not.toContain(user)
    expect(logged).not.toContain(pass)
    warnSpy.mockRestore()
  })

  // The two credentials can overlap — a password built from the username. Replacing
  // the shorter one first would consume the prefix and leave `[redacted]-secret`,
  // so the half that actually distinguishes the password would survive into the log
  // and the audit entry. Overlapping matches merge into a single marker.
  it('should merge overlapping credentials into a single marker', async () => {
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
    expect(loggedAll(warnSpy.mock.calls[0])).not.toContain('secret')
    warnSpy.mockRestore()
  })

  // The same hazard with the lengths the other way round: the password is the
  // shorter credential and a prefix of the username.
  it('should merge the overlap when the password is the shorter credential', async () => {
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

  // An error text past the detector's scan limit is scrubbed whole, so none of the echoed body can
  // reach the warn line or the thrown message.
  it('should scrub an echo longer than the scan limit out of a transport error', async () => {
    const body = `<p>${'reset code 998877 '.repeat(5_000)}</p>`
    mockSendMail.mockRejectedValue(new Error(`550 5.7.1 rejected by policy: ${body}`))
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const caught: unknown = await new SmtpEmailProvider({ host: 'h' })
      .send({ ...baseOptions, html: body })
      .catch((error: unknown) => error)

    expect(String((caught as Error).message).includes('998877')).toBe(false)
    expect(loggedAll(warnSpy.mock.calls[0]).includes('998877')).toBe(false)
    warnSpy.mockRestore()
  })

  // The status of the failure is read from the error code, so the adapter carries it across.
  it.each([
    ['with the provider text', undefined],
    ['without it', false]
  ])(
    'should carry the transport error code onto the error it throws %s',
    async (_name, publish) => {
      mockSendMail.mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:587'), { code: 'ECONNREFUSED' })
      )

      const caught: unknown = await new SmtpEmailProvider({ host: 'h' })
        .send({ ...baseOptions, ...(publish === false ? { publishProviderText: false } : {}) })
        .catch((error: unknown) => error)

      expect((caught as { code?: string }).code).toBe('ECONNREFUSED')
    }
  )

  // The reply of the relay decides: a 4xx is "try later" and carries the availability code whatever
  // stage it came at, a 5xx is a refusal and keeps the stage's own code.
  it.each([
    ['a 451 at MAIL', 'EENVELOPE', 451, 'EUNAVAILABLE'],
    ['a 450 at RCPT', 'EENVELOPE', 450, 'EUNAVAILABLE'],
    ['a 451 at the end of the data', 'EMESSAGE', 451, 'EUNAVAILABLE'],
    ['a 550 at RCPT', 'EENVELOPE', 550, 'EENVELOPE'],
    ['a 554 at the end of the data', 'EMESSAGE', 554, 'EMESSAGE']
  ])('should carry the code of %s', async (_name, code, responseCode, expected) => {
    for (const publish of [undefined, false]) {
      mockSendMail.mockRejectedValue(
        Object.assign(new Error(`${responseCode} reply from the relay`), { code, responseCode })
      )

      const caught: unknown = await new SmtpEmailProvider({ host: 'h' })
        .send({ ...baseOptions, ...(publish === false ? { publishProviderText: false } : {}) })
        .catch((error: unknown) => error)

      expect((caught as { code?: string }).code).toBe(expected)
    }
  })

  it('should carry the code a client sets on the cause of its error', async () => {
    mockSendMail.mockRejectedValue(
      new Error('send failed', { cause: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) })
    )

    const caught: unknown = await new SmtpEmailProvider({ host: 'h' })
      .send(baseOptions)
      .catch((error: unknown) => error)

    expect((caught as { code?: string }).code).toBe('ETIMEDOUT')
  })

  it('should carry no code when the transport error has none, or one that is not a token', async () => {
    mockSendMail.mockRejectedValue(Object.assign(new Error('x'), { code: 'user jane@acme.com' }))

    const caught: unknown = await new SmtpEmailProvider({ host: 'h' })
      .send(baseOptions)
      .catch((error: unknown) => error)

    expect((caught as { code?: string }).code).toBeUndefined()
  })

  it.each([
    ['with the provider text', undefined],
    ['without it', false]
  ])(
    'should not add a code property when the transport error has none %s',
    async (_name, publish) => {
      mockSendMail.mockRejectedValue(new Error('550 5.7.1 rejected by policy'))

      const caught = (await new SmtpEmailProvider({ host: 'h' })
        .send({ ...baseOptions, ...(publish === false ? { publishProviderText: false } : {}) })
        .catch((error: unknown) => error)) as Error

      expect(Object.prototype.hasOwnProperty.call(caught, 'code')).toBe(false)
    }
  )
})
