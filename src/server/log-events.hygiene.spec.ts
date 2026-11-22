/**
 * @fileoverview Holds every log event to the rule that `message` carries the library's own text
 * and never the text of an error from a provider, a relay or code the host supplied: that error
 * travels as the `err` copy. Each event has one row that provokes its line with a sentinel in
 * every error it can be given, and a guard fails when an event has no row.
 * @layer logging
 */

import { Logger } from '@nestjs/common'

import { BymaxNotificationModule } from './bymax-notification.module'
import { resolveOptions } from './config/resolved-options'
import { NOTIFICATION_LOG_EVENTS } from './constants/log-events.constants'
import type { NotificationLogEvent } from './constants/log-events.constants'
import { InMemoryOtpStorage } from './providers/in-memory-otp.storage'
import { NoOpEmailProvider } from './providers/no-op-email.provider'
import { ResendEmailProvider } from './providers/resend-email.provider'
import { SmtpEmailProvider } from './providers/smtp-email.provider'
import { makeAudit, makeProvider, makeRenderer } from './services/__tests__/email-service.fixtures'
import { dummyRepo } from './services/__tests__/otp-service.fixtures'
import { EmailService } from './services/email.service'
import { NotificationService } from './services/notification.service'
import { OtpService } from './services/otp.service'
import { loggedAll, loggedEvent, loggedText } from './__tests__/logged'
import { AuditWriteWarning } from './utils/audit-write-warning'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factories.
const mockSendMail = jest.fn()
const mockTransportClose = jest.fn()
const mockResendSend = jest.fn()

jest.mock(
  'nodemailer',
  () => ({
    __esModule: true,
    createTransport: () => ({ sendMail: mockSendMail, close: mockTransportClose })
  }),
  { virtual: true }
)
jest.mock(
  'resend',
  () => ({ __esModule: true, Resend: jest.fn(() => ({ emails: { send: mockResendSend } })) }),
  { virtual: true }
)

/** The text an error carries when it leaks: a recipient address nobody should see in a message. */
const SENTINEL = 'sentinel-leak@acme.test'

const SEND_OPTIONS = {
  to: 'jane@acme.com',
  from: 'noreply@acme.com',
  subject: 'Your code',
  html: '<p>Hello</p>'
}

/** A storage that implements the required contract only, so the failure carry is not available. */
class PlainStorage extends InMemoryOtpStorage {
  override recordFailure = undefined as never
  override getFailures = undefined as never
  override clearFailures = undefined as never
}

/** Lets every detached promise a startup hook started run to completion. */
const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

interface Row {
  /** Provokes the line, with the sentinel in every error it can be given. */
  readonly provoke: () => Promise<void> | void
  /** Whether the sentinel travels in the `err` copy, as the rule says an error does. */
  readonly errCarriesSentinel: boolean
  /** The entry has an `err` field, and the address the provider quoted is masked in it. */
  readonly errMasked?: boolean
}

const ROWS: Record<NotificationLogEvent, Row> = {
  NOTIFICATION_BOOTSTRAP_OK: {
    provoke: () => {
      BymaxNotificationModule.forRoot({
        email: { provider: new NoOpEmailProvider(), defaultFrom: SENTINEL }
      })
    },
    errCarriesSentinel: false
  },
  NOTIFICATION_PLAINTEXT_OTP_CODES: {
    provoke: () => {
      BymaxNotificationModule.forRoot({
        otp: { storage: new InMemoryOtpStorage() },
        email: { provider: new NoOpEmailProvider(), defaultFrom: SENTINEL }
      })
    },
    errCarriesSentinel: false
  },
  NOTIFICATION_REDIS_NAMESPACE_UNUSED: {
    provoke: () => {
      BymaxNotificationModule.forRoot({
        email: { provider: new NoOpEmailProvider(), defaultFrom: 'noreply@acme.com' },
        global: { redisNamespace: SENTINEL }
      })
    },
    errCarriesSentinel: false
  },
  NOTIFICATION_CHANNEL_NOT_USABLE: {
    provoke: () => {
      const provider = makeProvider()
      provider.isConfigured.mockReturnValue(false)
      const options = resolveOptions({
        email: { provider, defaultFrom: SENTINEL },
        audit: { repository: dummyRepo }
      })
      const email = new EmailService(options, provider, makeRenderer(), makeAudit())
      new NotificationService(email).onModuleInit()
    },
    errCarriesSentinel: false
  },
  NOTIFICATION_OTP_FAILURES_NOT_CARRIED: {
    provoke: () => {
      const options = resolveOptions({
        otp: { storage: InMemoryOtpStorage },
        audit: { repository: dummyRepo }
      })
      new OtpService(options, new PlainStorage(), makeAudit()).onModuleInit()
    },
    errCarriesSentinel: false
  },
  NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED: {
    provoke: async () => {
      const provider = makeProvider()
      const renderer = makeRenderer()
      renderer.hasTemplate.mockRejectedValue(new Error(`renderer failed for ${SENTINEL}`))
      const options = resolveOptions({
        otp: { storage: InMemoryOtpStorage },
        email: { provider, defaultFrom: 'no-reply@acme.com' },
        audit: { repository: dummyRepo }
      })
      const email = new EmailService(options, provider, renderer, makeAudit())
      new OtpService(options, new InMemoryOtpStorage(), makeAudit(), email).onModuleInit()
      await settle()
    },
    errCarriesSentinel: true
  },
  NOTIFICATION_AUDIT_WRITE_FAILED: {
    provoke: () => {
      const error = Object.assign(new Error(`repository rejected ${SENTINEL}`), {
        name: 'RepositoryError'
      })
      new AuditWriteWarning(new Logger('Test'), 'email').warn(error)
    },
    errCarriesSentinel: false
  },
  NOTIFICATION_NOOP_EMAIL: {
    provoke: async () => {
      await new NoOpEmailProvider().send({ ...SEND_OPTIONS, to: SENTINEL })
    },
    errCarriesSentinel: false
  },
  NOTIFICATION_RESEND_SEND_FAILED: {
    provoke: async () => {
      mockResendSend.mockResolvedValue({
        data: null,
        error: { message: `mailbox ${SENTINEL} unknown` }
      })
      await new ResendEmailProvider({ apiKey: 're_key' }).send(SEND_OPTIONS).catch(() => undefined)
    },
    errCarriesSentinel: false,
    errMasked: true
  },
  NOTIFICATION_SMTP_SEND_FAILED: {
    provoke: async () => {
      mockSendMail.mockRejectedValue(new Error(`550 ${SENTINEL} unknown`))
      await new SmtpEmailProvider({ host: 'h' }).send(SEND_OPTIONS).catch(() => undefined)
    },
    errCarriesSentinel: true
  },
  NOTIFICATION_SMTP_CLOSE_FAILED: {
    provoke: async () => {
      mockSendMail.mockResolvedValue({ messageId: '<abc@relay>' })
      mockTransportClose.mockImplementation(() => {
        throw new Error(`connection to ${SENTINEL} reset`)
      })
      const provider = new SmtpEmailProvider({ host: 'h' })
      await provider.send(SEND_OPTIONS)
      await provider.close()
    },
    errCarriesSentinel: false
  }
}

describe('log event messages', () => {
  const calls: Array<{ method: string; call: readonly unknown[] }> = []

  beforeEach(() => {
    calls.length = 0
    for (const method of ['log', 'warn', 'debug'] as const) {
      jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        calls.push({ method, call: args })
      })
    }
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should have one row for every event, and no row for an event that does not exist', () => {
    expect(Object.keys(ROWS).sort()).toEqual(Object.values(NOTIFICATION_LOG_EVENTS).sort())
  })

  describe.each(Object.entries(ROWS))('%s', (event, row) => {
    it('should write its line without the text of any error it was given', async () => {
      await row.provoke()

      const mine = calls.filter((entry) => loggedEvent(entry.call) === event)
      expect(mine.length).toBeGreaterThan(0)
      for (const entry of mine) {
        expect(loggedText(entry.call)).not.toContain(SENTINEL)
      }
    })

    it(
      row.errCarriesSentinel || row.errMasked === true
        ? 'should carry the error in the err field and in no other field'
        : 'should carry no error at all: its entry has only an event and a message',
      async () => {
        await row.provoke()

        const mine = calls.filter((entry) => loggedEvent(entry.call) === event)
        for (const entry of mine) {
          // Every key of the entry is read, so a field added to it cannot hold error text unseen.
          expect(Object.keys(entry.call[0] as object)).toEqual(
            row.errCarriesSentinel || row.errMasked === true
              ? ['err', 'event', 'message']
              : ['event', 'message']
          )
          expect(loggedAll(entry.call).includes(SENTINEL)).toBe(row.errCarriesSentinel)
        }
        expect(mine.length).toBeGreaterThan(0)
      }
    )
  })
})
