/**
 * @fileoverview Holds the HTTP status of `EMAIL_SEND_FAILED` to the failure the provider raised, not
 * to what is left of it after the secrets are removed. The removal strips the error's own
 * properties in place, the code among them, so a status read afterwards says 502 for an outage.
 * The providers here are the real ones, behind a mocked transport and a mocked SDK.
 * @layer application
 */

import { HttpStatus } from '@nestjs/common'

import { NotificationException } from '../errors/notification-exception'
import type { IEmailProvider } from '../interfaces/email-provider.interface'
import { ResendEmailProvider } from '../providers/resend-email.provider'
import { SmtpEmailProvider } from '../providers/smtp-email.provider'

import { baseInput, makeAudit, makeOptions, makeRenderer } from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

const mockSendMail = jest.fn()
const mockResendSend = jest.fn()

jest.mock(
  'nodemailer',
  () => ({
    __esModule: true,
    createTransport: () => ({ sendMail: mockSendMail, close: jest.fn() })
  }),
  { virtual: true }
)
jest.mock(
  'resend',
  () => ({
    __esModule: true,
    Resend: function Resend() {
      return { emails: { send: mockResendSend } }
    }
  }),
  { virtual: true }
)

async function statusOf(provider: IEmailProvider, redact: readonly string[] | undefined) {
  const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())
  const caught: unknown = await service
    .send({ ...baseInput, ...(redact === undefined ? {} : { auditRedactValues: redact }) })
    .catch((error: unknown) => error)
  expect(caught).toBeInstanceOf(NotificationException)
  return (caught as NotificationException).getStatus()
}

// With a value to scrub the error is stripped before it is read; without one it is not. Both
// must answer the same.
const REDACTIONS = [undefined, ['a-secret']] as const

describe('EmailService status when the failure is scrubbed', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe.each(REDACTIONS)('with auditRedactValues %j', (redact) => {
    it.each([
      [
        'an SMTP 451 reply',
        { code: 'EENVELOPE', responseCode: 451 },
        HttpStatus.SERVICE_UNAVAILABLE
      ],
      [
        'an SMTP 450 reply',
        { code: 'EENVELOPE', responseCode: 450 },
        HttpStatus.SERVICE_UNAVAILABLE
      ],
      ['a refused connection', { code: 'ECONNREFUSED' }, HttpStatus.SERVICE_UNAVAILABLE],
      ['a timed out connection', { code: 'ETIMEDOUT' }, HttpStatus.SERVICE_UNAVAILABLE],
      ['an SMTP 550 reply', { code: 'EENVELOPE', responseCode: 550 }, HttpStatus.BAD_GATEWAY],
      ['an authentication failure', { code: 'EAUTH' }, HttpStatus.BAD_GATEWAY]
    ])('should answer the status of %s from the SMTP provider', async (_name, fields, expected) => {
      mockSendMail.mockRejectedValue(Object.assign(new Error('relay said no'), fields))

      const status = await statusOf(new SmtpEmailProvider({ host: 'h' }), redact)

      expect(status).toBe(expected)
    })

    it.each([
      ['a 429', { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 }, 503],
      ['a 503', { name: 'service_unavailable', message: 'down', statusCode: 503 }, 503],
      ['a 422', { name: 'validation_error', message: 'bad from', statusCode: 422 }, 502]
    ])(
      'should answer the status of %s from the Resend provider',
      async (_name, error, expected) => {
        mockResendSend.mockResolvedValue({ data: null, error })

        const status = await statusOf(new ResendEmailProvider({ apiKey: 'k' }), redact)

        expect(status).toBe(expected)
      }
    )

    // A provider of the host's own throws whatever it likes: the code may sit on the error or on
    // a cause, and the removal strips both.
    it.each([
      ['on the error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })],
      [
        'on a cause',
        new Error('x', { cause: Object.assign(new Error('y'), { code: 'ETIMEDOUT' }) })
      ]
    ])('should answer 503 for a custom provider with the code %s', async (_name, failure) => {
      const provider: IEmailProvider = {
        name: 'custom',
        isConfigured: () => true,
        send: () => Promise.reject(failure)
      }

      expect(await statusOf(provider, redact)).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    })
  })
})
