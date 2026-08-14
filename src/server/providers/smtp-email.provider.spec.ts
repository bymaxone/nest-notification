import { inspect } from 'node:util'

import { Logger } from '@nestjs/common'

import type { EmailSendOptions } from '../interfaces/email-provider.interface'

import { SmtpEmailProvider } from './smtp-email.provider'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockSendMail = jest.fn()
const mockCreateTransport = jest.fn()
// Toggled on (with a registry reset) to simulate the optional peer dep being absent.
let mockNodemailerMissing = false
// Which export shape the specifier resolves to, since `nodemailer` is CommonJS and
// reaches a dynamic `import()` either as a named export or under `default`.
let mockNodemailerShape: 'named' | 'default' | 'broken' = 'named'

// `nodemailer` is an optional peer dep that is NOT installed; the virtual flag lets
// jest register a mock module for the lazy `import('nodemailer')`. After a
// `jest.resetModules()` the factory re-runs and honours the flags above.
jest.mock(
  'nodemailer',
  () => {
    if (mockNodemailerMissing) {
      throw new Error('Cannot find module')
    }
    if (mockNodemailerShape === 'default') {
      return { __esModule: true, default: { createTransport: mockCreateTransport } }
    }
    if (mockNodemailerShape === 'broken') {
      return { __esModule: true }
    }
    return { __esModule: true, createTransport: mockCreateTransport }
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

/** The transport config handed to `createTransport` on the most recent init. */
function lastTransportConfig(): Record<string, unknown> {
  return mockCreateTransport.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

/** The payload handed to `sendMail` on the most recent send. */
function lastSendPayload(): Record<string, unknown> {
  return mockSendMail.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

describe('SmtpEmailProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetModules()
    mockNodemailerMissing = false
    mockNodemailerShape = 'named'
    mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }))
    mockSendMail.mockResolvedValue({ messageId: '<abc@mailpit>' })
  })

  // The provider name is what lands in logs and audit entries.
  it('should report name "smtp"', () => {
    expect(new SmtpEmailProvider({ host: 'localhost' }).name).toBe('smtp')
  })

  describe('isConfigured', () => {
    // A host is the one mandatory field: without it there is no relay to reach.
    it('should be false when no host is supplied', () => {
      expect(new SmtpEmailProvider().isConfigured()).toBe(false)
      expect(new SmtpEmailProvider({}).isConfigured()).toBe(false)
      expect(new SmtpEmailProvider({ host: '' }).isConfigured()).toBe(false)
    })

    // An unauthenticated relay (Mailpit, an internal Postfix) is fully configured
    // with only a host — omitting `credentials` is how a deployment says it does not log in.
    it('should be true for a host with no credentials at all', () => {
      expect(new SmtpEmailProvider({ host: 'localhost', port: 1025 }).isConfigured()).toBe(true)
    })

    // Supplying `credentials` declares that the deployment authenticates, so both halves
    // must be present for the provider to claim readiness.
    it('should be true only when supplied credentials carry both user and pass', () => {
      const host = 'smtp.acme.com'

      expect(
        new SmtpEmailProvider({ host, credentials: { user: 'u', pass: 'p' } }).isConfigured()
      ).toBe(true)
      expect(new SmtpEmailProvider({ host, credentials: { user: 'u' } }).isConfigured()).toBe(false)
      expect(new SmtpEmailProvider({ host, credentials: { pass: 'p' } }).isConfigured()).toBe(false)
      expect(new SmtpEmailProvider({ host, credentials: {} }).isConfigured()).toBe(false)
    })

    // An env-sourced credential that failed to load arrives as an empty string; it
    // must not read as configured, or the send would silently go out anonymously.
    it('should be false when a supplied credential is an empty string', () => {
      const host = 'smtp.acme.com'

      expect(
        new SmtpEmailProvider({ host, credentials: { user: '', pass: 'p' } }).isConfigured()
      ).toBe(false)
      expect(
        new SmtpEmailProvider({ host, credentials: { user: 'u', pass: '' } }).isConfigured()
      ).toBe(false)
    })

    // Answering readiness must not open a connection or load the optional peer dep.
    it('should not load nodemailer or create a transport', () => {
      new SmtpEmailProvider({ host: 'localhost' }).isConfigured()

      expect(mockCreateTransport).not.toHaveBeenCalled()
    })
  })

  describe('transport configuration', () => {
    // The submission port and conservative timeouts are the defaults; nodemailer's
    // own timeouts run into minutes, which is far too long for a request path. A
    // remote host also demands STARTTLS by default — see the TLS block below.
    it('should default to port 587, no implicit TLS, forced STARTTLS, and bounded timeouts', async () => {
      await new SmtpEmailProvider({ host: 'smtp.acme.com' }).send(baseOptions)

      expect(lastTransportConfig()).toEqual({
        host: 'smtp.acme.com',
        port: 587,
        secure: false,
        requireTLS: true,
        auth: undefined,
        tls: undefined,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000
      })
    })

    // Port 465 is implicit TLS ("SMTPS") — deriving `secure` from it spares the
    // consumer a setting whose omission silently produces a plaintext handshake.
    it('should derive secure=true from port 465', async () => {
      await new SmtpEmailProvider({ host: 'smtp.acme.com', port: 465 }).send(baseOptions)

      expect(lastTransportConfig()).toMatchObject({ port: 465, secure: true })
    })

    // The derivation is only a default: an explicit `secure` always wins, in both
    // directions, so a non-standard deployment is still expressible.
    it('should let an explicit secure override the port-derived value', async () => {
      await new SmtpEmailProvider({ host: 'h', port: 465, secure: false }).send(baseOptions)
      expect(lastTransportConfig()).toMatchObject({ secure: false })

      await new SmtpEmailProvider({ host: 'h', port: 587, secure: true }).send(baseOptions)
      expect(lastTransportConfig()).toMatchObject({ secure: true })
    })

    // requireTls maps onto nodemailer's requireTLS: mandatory STARTTLS upgrade.
    it('should forward requireTls as requireTLS', async () => {
      await new SmtpEmailProvider({ host: 'h', requireTls: true }).send(baseOptions)

      expect(lastTransportConfig()).toMatchObject({ requireTLS: true })
    })

    // Whether a non-implicit-TLS session is encrypted at all is decided by the
    // PLAINTEXT EHLO banner: strip the `250-STARTTLS` line and the transport never
    // upgrades, putting the credentials and the OTP-bearing body on the wire in the
    // clear. A remote relay must therefore demand the upgrade by default.
    it('should demand STARTTLS by default for a remote host', async () => {
      await new SmtpEmailProvider({ host: 'smtp.acme.com', port: 587 }).send(baseOptions)

      expect(lastTransportConfig()).toMatchObject({ secure: false, requireTLS: true })
    })

    // A loopback capture server (Mailpit, MailHog) cannot be reached across a
    // network, so there is no stripping attacker to defend against and demanding
    // STARTTLS would simply break local development.
    it('should not demand STARTTLS for a loopback host', async () => {
      for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', 'LOCALHOST']) {
        await new SmtpEmailProvider({ host, port: 1025 }).send(baseOptions)

        expect(lastTransportConfig()).toMatchObject({ host, requireTLS: false })
      }
    })

    // A host that merely resembles a loopback name is still remote — the match is
    // exact, so `localhost.evil.com` does not inherit the local exemption.
    it('should treat a lookalike host as remote', async () => {
      await new SmtpEmailProvider({ host: 'localhost.evil.com' }).send(baseOptions)

      expect(lastTransportConfig()).toMatchObject({ requireTLS: true })
    })

    // With implicit TLS the session is already encrypted from the first byte, so
    // there is no upgrade left to demand.
    it('should not demand STARTTLS when the connection is already implicitly secure', async () => {
      await new SmtpEmailProvider({ host: 'smtp.acme.com', port: 465 }).send(baseOptions)

      expect(lastTransportConfig()).toMatchObject({ secure: true, requireTLS: false })
    })

    // The default is only a default: a relay known not to support STARTTLS is still
    // reachable, but the consumer has to say so explicitly.
    it('should let an explicit requireTls=false opt a remote host out', async () => {
      await new SmtpEmailProvider({ host: 'smtp.acme.com', requireTls: false }).send(baseOptions)

      expect(lastTransportConfig()).toMatchObject({ requireTLS: false })
    })

    // A relay behind a private CA needs its trust material passed straight through.
    it('should forward the tls options verbatim', async () => {
      const tls = { rejectUnauthorized: true, servername: 'mail.acme.com', ca: 'PEM' }

      await new SmtpEmailProvider({ host: 'h', tls }).send(baseOptions)

      expect(lastTransportConfig()).toMatchObject({ tls })
    })

    // Every timeout must remain tunable — a slow corporate relay may need more room.
    it('should forward custom timeouts', async () => {
      await new SmtpEmailProvider({
        host: 'h',
        connectionTimeout: 1,
        greetingTimeout: 2,
        socketTimeout: 3
      }).send(baseOptions)

      expect(lastTransportConfig()).toMatchObject({
        connectionTimeout: 1,
        greetingTimeout: 2,
        socketTimeout: 3
      })
    })

    // Complete credentials reach the transport as nodemailer's auth pair.
    it('should forward complete credentials', async () => {
      await new SmtpEmailProvider({ host: 'h', credentials: { user: 'u', pass: 'p' } }).send(
        baseOptions
      )

      expect(lastTransportConfig()).toMatchObject({ auth: { user: 'u', pass: 'p' } })
    })

    // Without a host there is nothing to connect to — fail closed with a clear message.
    it('should throw "missing host" when send is called without a host', async () => {
      await expect(new SmtpEmailProvider().send(baseOptions)).rejects.toThrow('missing host')
      expect(mockCreateTransport).not.toHaveBeenCalled()
    })

    // Half-loaded credentials must fail closed rather than degrade to an anonymous
    // send that a permissive relay might accept.
    it('should throw "incomplete credentials" when credentials are missing either half', async () => {
      await expect(
        new SmtpEmailProvider({ host: 'h', credentials: { user: 'u' } }).send(baseOptions)
      ).rejects.toThrow('incomplete credentials')

      await expect(
        new SmtpEmailProvider({ host: 'h', credentials: { pass: 'p' } }).send(baseOptions)
      ).rejects.toThrow('incomplete credentials')

      expect(mockCreateTransport).not.toHaveBeenCalled()
    })
  })

  describe('send', () => {
    // The happy path returns the RFC-5322 Message-ID the recipient will also see.
    it('should return the transport message id', async () => {
      const result = await new SmtpEmailProvider({ host: 'h' }).send(baseOptions)

      expect(result).toEqual({ messageId: '<abc@mailpit>' })
    })

    // The full envelope must reach the transport unaltered.
    it('should forward the whole envelope and body', async () => {
      await new SmtpEmailProvider({ host: 'h' }).send({
        ...baseOptions,
        replyTo: 'support@acme.com',
        cc: 'cc@acme.com',
        bcc: ['bcc@acme.com'],
        headers: { 'X-Entity-Ref-ID': 'abc' }
      })

      expect(lastSendPayload()).toEqual({
        from: 'noreply@acme.com',
        to: 'jane@acme.com',
        subject: 'Your code',
        html: '<p>Secret 123456</p>',
        text: 'Secret 123456',
        replyTo: 'support@acme.com',
        cc: 'cc@acme.com',
        bcc: ['bcc@acme.com'],
        headers: { 'X-Entity-Ref-ID': 'abc' },
        attachments: undefined
      })
    })

    // A display name must be folded into the RFC-5322 "Name <email>" from header.
    it('should build the from header as "Name <email>" when fromName is provided', async () => {
      await new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, fromName: 'Acme' })

      expect(lastSendPayload()).toMatchObject({ from: 'Acme <noreply@acme.com>' })
    })

    // Without a display name the bare address is used.
    it('should use the bare from address when fromName is absent', async () => {
      await new SmtpEmailProvider({ host: 'h' }).send(baseOptions)

      expect(lastSendPayload()).toMatchObject({ from: 'noreply@acme.com' })
    })

    // SMTP needs an envelope sender; an absent `from` AND `defaultFrom` is a config
    // bug, reported plainly instead of as a cryptic relay rejection.
    it('should throw when no sender address is available', async () => {
      const { from: _from, ...withoutFrom } = baseOptions

      await expect(new SmtpEmailProvider({ host: 'h' }).send(withoutFrom)).rejects.toThrow(
        'no sender address'
      )
      await expect(
        new SmtpEmailProvider({ host: 'h' }).send({ ...withoutFrom, fromName: 'Acme' })
      ).rejects.toThrow('no sender address')
      expect(mockSendMail).not.toHaveBeenCalled()
    })

    // SMTP has no tag facility; tags stay in the audit log rather than being
    // smuggled onto the wire as invented headers.
    it('should not forward tags to the transport', async () => {
      await new SmtpEmailProvider({ host: 'h' }).send({
        ...baseOptions,
        tags: [{ name: 'template', value: 'otp' }]
      })

      expect(lastSendPayload()).not.toHaveProperty('tags')
    })

    // A success result with no message id is a contract violation — fail loudly
    // rather than write an audit entry that correlates with nothing.
    it('should throw when the transport returns no message id', async () => {
      mockSendMail.mockResolvedValue({})

      await expect(new SmtpEmailProvider({ host: 'h' }).send(baseOptions)).rejects.toThrow(
        'SMTP transport returned no message ID'
      )
    })
  })

  describe('header injection', () => {
    // Nodemailer's MIME layer strips CR/LF from header names and values and derives
    // the envelope from parsed address objects, so this is defence in depth — but
    // header injection is the one place where trusting a peer dependency's current
    // behaviour would be the entire security boundary.
    // The field name is asserted, not just the suffix: an error that cannot say WHICH
    // value was rejected is useless to whoever has to fix the call site.
    it.each([
      ['from', { from: 'a@acme.com\r\nBcc: attacker@evil.com' }],
      ['from', { from: 'a@acme.com\nBcc: attacker@evil.com' }],
      ['from', { from: 'a@acme.com\rBcc: attacker@evil.com' }],
      ['fromName', { fromName: 'Acme\r\nBcc: attacker@evil.com' }],
      ['replyTo', { replyTo: 'a@acme.com\r\nBcc: attacker@evil.com' }],
      ['recipient', { to: 'jane@acme.com\r\nRcpt To: attacker@evil.com' }],
      ['recipient', { cc: ['ok@acme.com', 'bad@acme.com\nBcc: attacker@evil.com'] }],
      ['recipient', { bcc: 'bad@acme.com\rBcc: attacker@evil.com' }],
      ['header name', { headers: { 'X-Ref\r\nBcc': 'v' } }],
      ['header X-Ref', { headers: { 'X-Ref': 'v\r\nBcc: attacker@evil.com' } }]
    ])('should refuse to send when %s carries a line break', async (field, overrides) => {
      await expect(
        new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, ...overrides })
      ).rejects.toThrow(`SmtpEmailProvider: ${field} contains a line break — refusing to send`)
      expect(mockSendMail).not.toHaveBeenCalled()
    })

    // The guard must not reject the ordinary case: clean addresses and headers,
    // including a multi-recipient array, go through untouched.
    it('should allow addresses and headers with no line break', async () => {
      await expect(
        new SmtpEmailProvider({ host: 'h' }).send({
          ...baseOptions,
          to: ['jane@acme.com', 'john@acme.com'],
          cc: 'cc@acme.com',
          bcc: ['bcc@acme.com'],
          replyTo: 'support@acme.com',
          headers: { 'X-Entity-Ref-ID': 'abc' }
        })
      ).resolves.toEqual({ messageId: '<abc@mailpit>' })
    })

    // A subject is deliberately NOT guarded: a stray trailing newline out of a
    // template is plausible, and Nodemailer folds it away without a hard failure.
    it('should not reject a subject carrying a line break', async () => {
      await expect(
        new SmtpEmailProvider({ host: 'h' }).send({ ...baseOptions, subject: 'Your code\r\n' })
      ).resolves.toEqual({ messageId: '<abc@mailpit>' })
    })
  })

  describe('attachments', () => {
    // `EmailAttachment.content` is documented as a Buffer OR a base64 string; the
    // string form must be tagged, or nodemailer delivers the base64 text literally.
    it('should tag a string attachment as base64 and leave a Buffer untagged', async () => {
      await new SmtpEmailProvider({ host: 'h' }).send({
        ...baseOptions,
        attachments: [
          { filename: 'a.pdf', content: 'YmFzZTY0', contentType: 'application/pdf' },
          { filename: 'b.bin', content: Buffer.from('raw') }
        ]
      })

      expect(lastSendPayload()['attachments']).toEqual([
        {
          filename: 'a.pdf',
          content: 'YmFzZTY0',
          contentType: 'application/pdf',
          encoding: 'base64'
        },
        {
          filename: 'b.bin',
          content: Buffer.from('raw'),
          contentType: undefined,
          encoding: undefined
        }
      ])
    })

    // The common case carries no attachments at all.
    it('should pass undefined when there are no attachments', async () => {
      await new SmtpEmailProvider({ host: 'h' }).send(baseOptions)

      expect(lastSendPayload()['attachments']).toBeUndefined()
    })
  })

  describe('lazy initialization', () => {
    // The transport is created once and reused across sends.
    it('should create the transport only once across multiple sends', async () => {
      const provider = new SmtpEmailProvider({ host: 'h' })

      await provider.send(baseOptions)
      await provider.send(baseOptions)

      expect(mockCreateTransport).toHaveBeenCalledTimes(1)
      expect(mockSendMail).toHaveBeenCalledTimes(2)
    })

    // Concurrent first sends must share one in-flight init: the dynamic import and
    // creation run exactly once even when several callers race on a fresh provider.
    it('should perform the dynamic import only once under concurrent first sends', async () => {
      const provider = new SmtpEmailProvider({ host: 'h' })

      await Promise.all([provider.send(baseOptions), provider.send(baseOptions)])

      expect(mockCreateTransport).toHaveBeenCalledTimes(1)
      expect(mockSendMail).toHaveBeenCalledTimes(2)
    })

    // A failed init must not permanently brick the provider: the cached promise is
    // dropped so a later send re-imports and succeeds once the dependency is present.
    it('should reset the cached init after a failed load so a later send can retry', async () => {
      const provider = new SmtpEmailProvider({ host: 'h' })
      mockNodemailerMissing = true
      jest.resetModules() // force the virtual mock factory to throw on the first import

      await expect(provider.send(baseOptions)).rejects.toThrow(
        '`nodemailer` package is not installed'
      )

      mockNodemailerMissing = false
      jest.resetModules() // the dependency is "installed" again

      await expect(provider.send(baseOptions)).resolves.toEqual({ messageId: '<abc@mailpit>' })
      expect(mockCreateTransport).toHaveBeenCalledTimes(1)
    })

    // When the optional peer dep is missing, point the consumer at the install command.
    it('should throw a helpful error when the nodemailer package is not installed', async () => {
      mockNodemailerMissing = true
      jest.resetModules() // force the virtual mock factory to re-run and throw

      await expect(new SmtpEmailProvider({ host: 'h' }).send(baseOptions)).rejects.toThrow(
        '`nodemailer` package is not installed. Run `pnpm add nodemailer` in the consumer app.'
      )
    })

    // nodemailer is CommonJS, so the dynamic import can land the module under
    // `default` rather than exposing `createTransport` as a named export.
    it('should accept the module under a default export', async () => {
      mockNodemailerShape = 'default'
      jest.resetModules()

      await expect(new SmtpEmailProvider({ host: 'h' }).send(baseOptions)).resolves.toEqual({
        messageId: '<abc@mailpit>'
      })
      expect(mockCreateTransport).toHaveBeenCalledTimes(1)
    })

    // A resolved module carrying no createTransport at all (a broken or shimmed
    // install) gets a named error instead of "undefined is not a function".
    it('should throw when the resolved module exposes no createTransport', async () => {
      mockNodemailerShape = 'broken'
      jest.resetModules()

      await expect(new SmtpEmailProvider({ host: 'h' }).send(baseOptions)).rejects.toThrow(
        '`nodemailer` package exposes no createTransport export'
      )
    })
  })

  describe('failure handling', () => {
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

  it('keeps the SMTP password out of every serialization path', () => {
    // The provider is registered in the container, so anything that renders it
    // incidentally reaches its options: a structured logger formatting its
    // arguments, an error reporter capturing the scope of a throw, an object
    // spread. `showHidden` is asserted because it is what defeats a merely
    // non-enumerable property.
    const pass = 'smtp_LEAKCANARY_secret'
    const provider = new SmtpEmailProvider({ host: 'h', credentials: { user: 'u', pass } })

    expect(JSON.stringify(provider)).not.toContain(pass)
    expect(JSON.stringify({ ...provider })).not.toContain(pass)
    expect(inspect(provider, { depth: null, showHidden: true })).not.toContain(pass)
    // Reads on purpose are unaffected: the password still configures the provider.
    expect(provider.isConfigured()).toBe(true)
  })
})
