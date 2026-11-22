/**
 * @fileoverview Holds the library to ignoring a key planted on the realm-root prototype. Code that
 * runs before the library can set `Object.prototype.bcc` or `Object.prototype.maxAttempts`; an
 * option or an input the host did not set must not take that value. Every row plants one key and
 * compares what the library does with what it does when nothing is planted, through the real
 * effect: the message the provider receives, the audit row, the attempts a code allows, what is
 * stored, the options the SMTP transport is built with.
 * @layer integration
 */

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'

import {
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_TEMPLATE_RENDERER
} from './bymax-notification.constants'
import { BymaxNotificationModule } from './bymax-notification.module'
import type { IEmailProvider, IOtpStorage } from './interfaces'
import { InMemoryOtpStorage } from './providers/in-memory-otp.storage'
import { ResendEmailProvider } from './providers/resend-email.provider'
import { SmtpEmailProvider } from './providers/smtp-email.provider'
import { EmailService } from './services/email.service'
import { OtpService } from './services/otp.service'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockCreateTransport = jest.fn()
jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

const EVIL = 'evil@evil.test'

/** Every key the library reads by name from something the host gave, each with a value that would show. */
const PLANTED: ReadonlyArray<readonly [string, unknown]> = [
  // The send input.
  ['bcc', EVIL],
  ['cc', EVIL],
  ['replyTo', EVIL],
  ['from', EVIL],
  ['fromName', 'Evil'],
  ['headers', { 'X-Planted': '1' }],
  ['attachments', [{ filename: 'a.txt', content: 'eA==' }]],
  ['tags', [{ name: 'planted', value: 'planted' }]],
  ['text', 'planted text'],
  ['userId', 'planted-user'],
  ['publishProviderText', false],
  ['auditRedactValues', ['bob']],
  ['redactValues', ['bob']],
  // The email channel.
  ['defaultReplyTo', EVIL],
  ['defaultFromName', 'Evil'],
  ['defaultTags', [{ name: 'planted', value: 'planted' }]],
  ['maxRecipients', 1],
  ['maxAttachmentBytes', 1],
  ['templateRenderer', {}],
  // The OTP channel and its input.
  ['defaultMaxAttempts', 1_000_000],
  ['maxAttempts', 1_000_000],
  ['resendCooldownSeconds', 0],
  ['codeSecret', 'planted-secret-planted-secret-0123456789'],
  ['perPurpose', { login: { maxAttempts: 99_999, resendCooldownSeconds: 0 } }],
  ['defaultLength', 1],
  ['defaultCodeType', 'alpha'],
  ['defaultTtlSeconds', 1],
  ['consumeOnVerify', true],
  ['strictPurposes', true],
  ['deliverVia', 'email'],
  ['code', '000000'],
  ['metadata', { planted: 1 }],
  // The audit and global sections.
  ['maskRecipient', () => 'PWNED'],
  ['swallowErrors', false],
  ['tenantIdResolver', () => 'evil-tenant'],
  ['redisNamespace', 'planted'],
  ['defaultLocale', 'xx']
]

/** The options of the providers and of the SMTP transport. */
const PLANTED_PROVIDER: ReadonlyArray<readonly [string, unknown]> = [
  ['apiKey', 're_planted'],
  ['host', 'planted.test'],
  ['port', 2525],
  ['secure', true],
  ['requireTls', true],
  ['credentials', { user: 'planted', pass: 'planted' }],
  ['user', 'planted'],
  ['pass', 'planted'],
  ['tls', { rejectUnauthorized: false }],
  ['rejectUnauthorized', false],
  ['minVersion', 'TLSv1'],
  ['maxVersion', 'TLSv1'],
  ['ciphers', 'NULL'],
  ['servername', 'planted.test'],
  ['ca', 'planted'],
  ['pool', { maxConnections: 99 }],
  ['timeoutMs', 'bad'],
  ['sendTimeoutMs', 'bad'],
  ['connectionTimeout', 1],
  ['greetingTimeout', 1],
  ['socketTimeout', 1]
]

function plant(key: string, value: unknown): void {
  Object.defineProperty(Object.prototype, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true
  })
}

function unplant(): void {
  for (const [key] of [...PLANTED, ...PLANTED_PROVIDER]) {
    Reflect.deleteProperty(Object.prototype, key)
  }
  Reflect.deleteProperty(Object.prototype, 'length')
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.catch((error: unknown) => {
    const thrown = error as { code?: unknown; cause?: { message?: unknown } }
    return { thrown: thrown.code, cause: thrown.cause?.message }
  })
}

/** A provider that records the message it receives and fails when the subject says so. */
function recordingProvider(sent: unknown[]): IEmailProvider {
  return {
    name: 'p',
    isConfigured: () => true,
    send: async (options) => {
      sent.push({
        to: options.to,
        cc: options.cc,
        bcc: options.bcc,
        replyTo: options.replyTo,
        from: options.from,
        fromName: options.fromName,
        headers: options.headers,
        attachments: options.attachments?.length,
        tags: options.tags,
        text: options.text
      })
      if (options.subject === 'fail') {
        throw Object.assign(new Error('550 <bob@x.com>: Recipient rejected'), { code: 'EFAIL' })
      }
      return { messageId: 'm1' }
    }
  }
}

/** The module with the options a host would give: only what is required, so the rest is unset. */
async function plainModule(
  provider: IEmailProvider,
  storage: IOtpStorage,
  rows: Array<Record<string, unknown>>
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [
      BymaxNotificationModule.forRoot({
        email: { provider, defaultFrom: 'no-reply@acme.com' },
        otp: { storage },
        audit: {
          repository: {
            name: 'r',
            create: async (entry) => {
              rows.push({ verb: entry.verb, recipient: entry.recipient, text: entry.errorMessage })
            }
          }
        }
      })
    ]
  }).compile()
}

/** The effects of the options that are read once, when the module is built. */
function observeOptions(moduleRef: TestingModule): Record<string, unknown> {
  const resolved = moduleRef.get<{ global: { tenantIdResolver?: unknown } }>(
    BYMAX_NOTIFICATION_OPTIONS
  )
  return {
    tenantIdResolver: typeof resolved.global.tenantIdResolver,
    renderer: (
      moduleRef.get<object>(BYMAX_NOTIFICATION_TEMPLATE_RENDERER).constructor as { name: string }
    ).name
  }
}

/** What the library does with a plain configuration and plain inputs, as data. */
async function observe(): Promise<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  const sent: unknown[] = []
  const storage = new InMemoryOtpStorage()
  const moduleRef = await plainModule(recordingProvider(sent), storage, rows)
  const email = moduleRef.get(EmailService)
  const otp = moduleRef.get(OtpService)
  const base = { tenantId: 't', html: '<p>hi</p>' }
  const otpRef = { tenantId: 't', recipient: 'bob@x.com', purpose: 'login' }
  const dropTime = (value: unknown): string =>
    JSON.stringify(value).replace(/"expiresAt":\d+/u, '"expiresAt":T')
  const out: Record<string, unknown> = {
    fail: await rejection(email.send({ ...base, to: 'bob@x.com', subject: 'fail' })),
    ok: await rejection(email.send({ ...base, to: 'alice@x.com', subject: 'ok' })),
    many: await rejection(email.send({ ...base, to: ['a@x.com', 'b@x.com'], subject: 'ok' })),
    generated: dropTime(await rejection(otp.generate({ ...otpRef, deliverVia: 'manual' }))),
    wrong: await rejection(otp.verify({ ...otpRef, code: 'zzzzzz' })),
    strict: dropTime(
      await rejection(
        otp.generate({ ...otpRef, recipient: 'c@x.com', purpose: 'zzz', deliverVia: 'manual' })
      )
    )
  }
  const stored = await storage.get('t', 'bob@x.com', 'login')
  out.stored = stored === null ? null : { shape: /^\d{6}$/u.test(stored.code) ? 'plain' : 'other' }
  return { ...out, sent, rows, ...observeOptions(moduleRef) }
}

/** What the SMTP and Resend providers do with empty options, and the options the transport gets. */
function observeProviders(): Record<string, unknown> {
  mockCreateTransport.mockReset()
  mockCreateTransport.mockImplementation(() => ({ sendMail: async () => ({ messageId: 'x' }) }))
  const built = (make: () => { isConfigured(): boolean }): unknown => {
    try {
      return { configured: make().isConfigured() }
    } catch (error) {
      return { threw: (error as Error).message }
    }
  }
  return {
    smtp: built(() => new SmtpEmailProvider({})),
    resend: built(() => new ResendEmailProvider({})),
    smtpWithHost: built(() => new SmtpEmailProvider({ host: 'h' }))
  }
}

async function transportOptions(): Promise<unknown> {
  mockCreateTransport.mockReset()
  mockCreateTransport.mockImplementation(() => ({ sendMail: async () => ({ messageId: 'x' }) }))
  // The host sets only a server name for the TLS: the rest of that object must stay unset.
  await new SmtpEmailProvider({
    host: 'h',
    credentials: { user: 'u', pass: 'p' },
    tls: { servername: 's' }
  }).send({
    to: 'a@x.com',
    subject: 's',
    html: '<p>x</p>',
    from: 'f@x.com'
  })
  return JSON.stringify(mockCreateTransport.mock.calls[0]?.[0])
}

describe('a key planted on the realm-root prototype', () => {
  let baseline: Record<string, unknown>
  let baselineProviders: Record<string, unknown>
  let baselineTransport: unknown

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    baseline = await observe()
    baselineProviders = observeProviders()
    baselineTransport = await transportOptions()
  })

  afterEach(unplant)

  afterAll(() => {
    jest.restoreAllMocks()
  })

  it.each(PLANTED)(
    'should change nothing the library does when %s is planted',
    async (key, value) => {
      plant(key, value)

      const observed = await observe()

      expect(observed).toStrictEqual(baseline)
    }
  )

  it.each([...PLANTED_PROVIDER])(
    'should not configure or alter a provider when %s is planted',
    (key, value) => {
      plant(key, value)

      expect(observeProviders()).toStrictEqual(baselineProviders)
    }
  )

  it.each([...PLANTED_PROVIDER])(
    'should build the SMTP transport the same when %s is planted',
    async (key, value) => {
      plant(key, value)

      expect(await transportOptions()).toBe(baselineTransport)
    }
  )

  describe('the effects that matter most, stated outright', () => {
    it('should not copy a message to a planted bcc', async () => {
      plant('bcc', EVIL)

      const observed = await observe()

      expect(JSON.stringify(observed.sent)).not.toContain(EVIL)
    })

    it('should keep the attempt ceiling the host set, not a planted one', async () => {
      plant('defaultMaxAttempts', 1_000_000)
      plant('maxAttempts', 1_000_000)

      const observed = await observe()

      expect(observed.wrong).toStrictEqual({
        valid: false,
        reason: 'invalid_code',
        remainingAttempts: 4
      })
    })

    it('should keep the resend cooldown, not a planted zero', async () => {
      plant('resendCooldownSeconds', 0)

      expect(String((await observe()).generated)).toContain('"cooldownSeconds":60')
    })

    it('should not store codes under a planted secret', async () => {
      plant('codeSecret', 'planted-secret-planted-secret-0123456789')

      expect(((await observe()).stored as { shape: string }).shape).toBe('plain')
    })

    it('should not mask recipients with a planted function', async () => {
      plant('maskRecipient', () => 'PWNED')

      expect(JSON.stringify((await observe()).rows)).not.toContain('PWNED')
    })

    it('should not resolve a tenant with a planted function or render with a planted renderer', async () => {
      plant('tenantIdResolver', () => 'evil-tenant')
      plant('templateRenderer', {})

      const observed = await observe()

      expect(observed.tenantIdResolver).toBe('undefined')
      expect(observed.renderer).toBe('DefaultTemplateRenderer')
    })

    it('should not weaken the TLS or the login of the SMTP transport with planted keys', async () => {
      plant('rejectUnauthorized', false)
      plant('minVersion', 'TLSv1')

      const options = JSON.parse(String(await transportOptions())) as {
        tls?: Record<string, unknown>
        auth?: Record<string, unknown>
      }

      // Own keys: a parsed object would answer for a planted key through its own prototype.
      expect(Object.keys(options.tls ?? {})).toStrictEqual(['servername'])
    })

    it('should not give a pool the host left unset a planted limit', async () => {
      plant('maxConnections', 99)
      plant('maxMessages', 99)
      mockCreateTransport.mockReset()
      mockCreateTransport.mockImplementation(() => ({ sendMail: async () => ({ messageId: 'x' }) }))

      await new SmtpEmailProvider({ host: 'h', pool: {} }).send({
        to: 'a@x.com',
        from: 'f@x.com',
        subject: 's',
        html: '<p>x</p>'
      })

      const options = mockCreateTransport.mock.calls[0]?.[0] as Record<string, unknown>
      expect(Object.keys(options)).not.toContain('maxConnections')
      expect(JSON.stringify(options)).not.toContain('99')
    })

    it('should not take a plain pool for a sequence because of a planted length', async () => {
      plant('length', 3)

      const sending = new SmtpEmailProvider({ host: 'h', pool: { maxConnections: 2 } }).send({
        to: 'a@x.com',
        from: 'f@x.com',
        subject: 's',
        html: '<p>x</p>'
      })

      await expect(sending).resolves.toStrictEqual({ messageId: 'x' })
    })

    it('should not complete the login of the SMTP transport with a planted password', async () => {
      plant('pass', 'planted')

      const sending = new SmtpEmailProvider({ host: 'h', credentials: { user: 'u' } }).send({
        to: 'a@x.com',
        from: 'f@x.com',
        subject: 's',
        html: '<p>x</p>'
      })

      await expect(sending).rejects.toThrow(/incomplete credentials/u)
    })

    it('should not configure a provider from a planted host or api key', () => {
      plant('host', 'planted.test')
      plant('apiKey', 're_planted')

      const observed = observeProviders()

      expect(observed.smtp).toStrictEqual({ configured: false })
      expect(observed.resend).toStrictEqual({ configured: false })
    })
  })
})
