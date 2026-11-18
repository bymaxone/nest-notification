/**
 * @fileoverview Holds `SmtpEmailProvider` to scrubbing the SMTP credentials from a relay's error
 * text in the form the AUTH exchange carries them, base64, as well as the literal. A relay or a client
 * library that quotes the exchange shows `AUTH PLAIN <token>` or the two LOGIN lines, which a literal
 * match cannot see. The rest of the failure and redaction specs live in
 * `smtp-email.provider.failures.spec.ts`.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'

import { baseOptions } from './__tests__/smtp-email-provider.fixtures'
import { SmtpEmailProvider } from './smtp-email.provider'
import { loggedText } from '../__tests__/logged'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockSendMail = jest.fn()
const mockCreateTransport = jest.fn()

jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

const USER = 'relay-user-7'
const PASS = 'p4ss-w0rd-9'

/** Base64 of a UTF-8 string, the encoding nodemailer puts on the wire for AUTH. */
function b64(value: string): string {
  return Buffer.from(value, 'utf-8').toString('base64')
}

/** The AUTH PLAIN token nodemailer sends: an empty authorization identity, the user, the password. */
function plainToken(user: string, pass: string): string {
  return b64(`\u0000${user}\u0000${pass}`)
}

/** Sends through a transport that rejects with `message`, and returns what escaped and what was logged. */
async function failWith(
  message: string,
  credentials: { user: string; pass: string } | null = { user: USER, pass: PASS }
): Promise<{ thrown: string; logged: string }> {
  mockSendMail.mockRejectedValue(new Error(message))
  const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  const caught: unknown = await new SmtpEmailProvider({
    host: 'h',
    ...(credentials === null ? {} : { credentials })
  })
    .send(baseOptions)
    .catch((error: unknown) => error)
  return { thrown: (caught as Error).message, logged: loggedText(warn.mock.calls[0]) }
}

describe('SmtpEmailProvider credentials echoed in base64', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }))
    mockSendMail.mockReset()
  })

  // The three forms are independent: the password's encoding is not a substring of the PLAIN token,
  // because the token's bytes sit at a different 3-byte alignment, so no one form implies another.
  it('should not find the password encoding inside the PLAIN token', () => {
    expect(plainToken(USER, PASS)).not.toContain(b64(PASS))
    expect(plainToken(USER, PASS)).not.toContain(b64(USER))
  })

  it('should scrub the AUTH PLAIN token from the thrown message and the log line', async () => {
    const token = plainToken(USER, PASS)

    const { thrown, logged } = await failWith(`535 5.7.8 rejected: AUTH PLAIN ${token}`)

    expect(thrown).toBe('SMTP send failed: 535 5.7.8 rejected: AUTH PLAIN [redacted]')
    expect(logged).toBe('[SMTP_SEND_FAILED] 535 5.7.8 rejected: AUTH PLAIN [redacted]')
  })

  it('should scrub the AUTH LOGIN user line from the thrown message and the log line', async () => {
    const { thrown, logged } = await failWith(`501 bad login line ${b64(USER)} refused`)

    expect(thrown).toBe('SMTP send failed: 501 bad login line [redacted] refused')
    expect(logged).toBe('[SMTP_SEND_FAILED] 501 bad login line [redacted] refused')
  })

  it('should scrub the AUTH LOGIN password line from the thrown message and the log line', async () => {
    const { thrown, logged } = await failWith(`501 bad login line ${b64(PASS)} refused`)

    expect(thrown).toBe('SMTP send failed: 501 bad login line [redacted] refused')
    expect(logged).toBe('[SMTP_SEND_FAILED] 501 bad login line [redacted] refused')
  })

  it('should scrub every form when one message carries them all', async () => {
    const { thrown, logged } = await failWith(
      `C: ${plainToken(USER, PASS)} C: ${b64(USER)} C: ${b64(PASS)}`
    )

    for (const text of [thrown, logged]) {
      expect(text).not.toContain(plainToken(USER, PASS))
      expect(text).not.toContain(b64(USER))
      expect(text).not.toContain(b64(PASS))
    }
  })

  // nodemailer encodes the credentials as UTF-8 before base64.
  it('should scrub the forms of a credential that is not ASCII', async () => {
    const user = 'usuário-ç'
    const pass = 'sénha-ñ-密码'

    const { thrown, logged } = await failWith(
      `x ${plainToken(user, pass)} y ${b64(user)} z ${b64(pass)}`,
      { user, pass }
    )

    expect(thrown).toBe('SMTP send failed: x [redacted] y [redacted] z [redacted]')
    expect(logged).toBe('[SMTP_SEND_FAILED] x [redacted] y [redacted] z [redacted]')
  })

  // A password built from the username: the encodings overlap or nest, and one marker covers them.
  it('should scrub the forms of overlapping credentials', async () => {
    const user = 'relay'
    const pass = 'relay-secret'

    const { thrown, logged } = await failWith(
      `${plainToken(user, pass)} ${b64(user)} ${b64(pass)}`,
      { user, pass }
    )

    for (const text of [thrown, logged]) {
      expect(text).not.toContain(plainToken(user, pass))
      expect(text).not.toContain(b64(user))
      expect(text).not.toContain(b64(pass))
    }
  })

  it('should still scrub the literal credentials', async () => {
    const { thrown } = await failWith(`535 rejected ${USER}/${PASS}`)

    expect(thrown).toBe('SMTP send failed: 535 rejected [redacted]/[redacted]')
  })

  it('should leave a message without credentials untouched', async () => {
    const message = `535 rejected AUTH PLAIN ${plainToken(USER, PASS)}`

    const { thrown, logged } = await failWith(message, null)

    expect(thrown).toBe(`SMTP send failed: ${message}`)
    expect(logged).toBe(`[SMTP_SEND_FAILED] ${message}`)
  })

  // With no credentials there is nothing to encode: a text that happens to hold the encoding of an
  // absent user and password, or of an empty token, is not touched.
  it('should not scrub the encoding of an absent credential when there are none', async () => {
    const message = `x ${plainToken('undefined', 'undefined')} y ${b64('undefined')} z ${b64('')}${b64('\u0000')}`

    const { thrown } = await failWith(message, null)

    expect(thrown).toBe(`SMTP send failed: ${message}`)
  })

  // The error a failed transport build throws goes through the same scrub.
  it('should scrub the forms from an error thrown while the transport is built', async () => {
    mockCreateTransport.mockImplementation(() => {
      throw new Error(`bad config AUTH PLAIN ${plainToken(USER, PASS)} ${b64(PASS)}`)
    })

    const caught: unknown = await new SmtpEmailProvider({
      host: 'h',
      credentials: { user: USER, pass: PASS }
    })
      .send(baseOptions)
      .catch((error: unknown) => error)

    const message = (caught as Error).message
    expect(message).not.toContain(plainToken(USER, PASS))
    expect(message).not.toContain(b64(PASS))
    expect(message).toContain('[redacted]')
  })
})
