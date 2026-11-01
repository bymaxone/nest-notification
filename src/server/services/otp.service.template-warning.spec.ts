/**
 * @fileoverview Specifies the startup warning for an OTP channel whose default email template
 * cannot be found: when it fires, when it stays silent, that it names the hosts it does not
 * apply to, and that the check can never break or delay boot.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import * as vm from 'node:vm'

import { resolveOptions } from '../config/resolved-options'
import type { ResolvedNotificationOptions } from '../config/resolved-options'
import type { IEmailProvider } from '../interfaces/email-provider.interface'
import type { IEmailTemplateRenderer } from '../interfaces/email-template-renderer.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeProvider, makeRenderer } from './__tests__/email-service.fixtures'
import { dummyRepo } from './__tests__/otp-service.fixtures'
import { EmailService } from './email.service'
import { OtpService } from './otp.service'

const CODE = 'BYMAX_NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED'

/** Lets every detached promise the hook started run to completion. */
const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve))
}

interface Setup {
  readonly service: OtpService
  readonly renderer: jest.Mocked<IEmailTemplateRenderer>
  readonly provider: jest.Mocked<IEmailProvider>
}

/** An OTP channel with an email channel behind it, unless `email` is false. */
const build = (
  opts: {
    otp?: boolean
    email?: boolean
    configured?: boolean
    locale?: string
    storage?: InMemoryOtpStorage
  } = {}
): Setup => {
  const { otp = true, email = true, configured = true, locale = 'en', storage } = opts
  const options: ResolvedNotificationOptions = resolveOptions({
    global: { defaultLocale: locale },
    ...(otp ? { otp: { storage: InMemoryOtpStorage } } : {}),
    ...(email
      ? {
          email: {
            provider: makeProvider(),
            defaultFrom: 'no-reply@acme.com'
          }
        }
      : {}),
    audit: { repository: dummyRepo }
  })
  const provider = makeProvider()
  provider.isConfigured.mockReturnValue(configured)
  const renderer = makeRenderer()
  renderer.hasTemplate.mockResolvedValue(false)
  const emailService = email
    ? new EmailService(options, provider, renderer, makeAudit())
    : undefined
  const service = new OtpService(
    options,
    storage ?? new InMemoryOtpStorage(),
    makeAudit(),
    emailService
  )
  return { service, renderer, provider }
}

describe('OtpService startup warning for an unresolved default template', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const ours = (): string[] =>
    warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes(CODE))

  // The case the warning exists for.
  it('should warn when otp_code resolves in neither the default locale nor en', async () => {
    const { service } = build({ locale: 'pt-BR' })

    service.onModuleInit()
    await settle()

    expect(ours()).toHaveLength(1)
    expect(ours()[0]).toContain('otp_code')
    expect(ours()[0]).toContain('pt-BR')
    expect(ours()[0]).toContain('DefaultTemplateRenderer')
  })

  // The line is read by hosts it does not apply to, and says so.
  it('should name the hosts the warning does not apply to', async () => {
    const { service } = build()

    service.onModuleInit()
    await settle()

    expect(ours()[0]).toContain('emailTemplate')
    expect(ours()[0]).toContain('manual')
  })

  // One line per process, however often the hook runs.
  it('should warn once', async () => {
    const { service } = build()

    service.onModuleInit()
    service.onModuleInit()
    await settle()

    expect(ours()).toHaveLength(1)
  })

  // Each condition, flipped alone, silences the line.
  it.each([
    ['there is no OTP channel', { otp: false }],
    ['there is no email channel', { email: false }],
    ['the email provider is not configured', { configured: false }]
  ])('should stay silent when %s', async (_label, opts) => {
    const { service, renderer } = build(opts)

    service.onModuleInit()
    await settle()

    expect(ours()).toHaveLength(0)
    expect(renderer.hasTemplate).not.toHaveBeenCalled()
  })

  it('should stay silent when the default locale has the template', async () => {
    const { service, renderer } = build({ locale: 'pt-BR' })
    renderer.hasTemplate.mockImplementation(async (_t, locale) => locale === 'pt-BR')

    service.onModuleInit()
    await settle()

    expect(ours()).toHaveLength(0)
  })

  it('should stay silent when only the en fallback has the template', async () => {
    const { service, renderer } = build({ locale: 'pt-BR' })
    renderer.hasTemplate.mockImplementation(async (_t, locale) => locale === 'en')

    service.onModuleInit()
    await settle()

    expect(ours()).toHaveLength(0)
  })

  // A storage that carries failures returns early from its own check; this one is separate.
  it('should still check when the storage carries failures', async () => {
    const { service } = build()

    service.onModuleInit()
    await settle()

    expect(ours()).toHaveLength(1)
  })

  // The storage check returns early for a storage that cannot carry failures; that must not
  // skip this one, and neither line may hide the other.
  it('should warn about the template and the storage independently', async () => {
    const storage = new InMemoryOtpStorage()
    Object.defineProperty(storage, 'recordFailure', { value: undefined })
    const { service } = build({ storage })

    service.onModuleInit()
    await settle()

    const lines = warn.mock.calls.map((call) => String(call[0]))
    expect(lines.filter((line) => line.includes('OTP_FAILURES_NOT_CARRIED'))).toHaveLength(1)
    expect(ours()).toHaveLength(1)
  })

  // What the warning predicts: the first email delivery fails, and says how to fix it.
  it('should fail the first email delivery with the remedy the warning predicts', async () => {
    const { service } = build()

    const error: unknown = await service
      .generate({ tenantId: 'acme', recipient: 'jane@acme.com', purpose: 'email_verification' })
      .catch((thrown: unknown) => thrown)

    expect(error).toMatchObject({ code: 'notification.template_not_found' })
    expect(
      (error as { getResponse: () => { error: { details: { remedy: string } } } }).getResponse()
        .error.details.remedy
    ).toContain("'otp_code'")
  })

  describe('a renderer that cannot answer', () => {
    // The hook itself does not throw, whatever the renderer does.
    it.each([
      [
        'throws synchronously',
        (): never => {
          throw new Error('store down')
        },
        'store down'
      ],
      [
        'rejects with an Error',
        async (): Promise<boolean> => Promise.reject(new Error('refused')),
        'refused'
      ],
      [
        'rejects with a plain { message }',
        async (): Promise<boolean> => Promise.reject({ message: 'plain failure' }),
        'plain failure'
      ],
      [
        'rejects with an Error from another realm',
        async (): Promise<boolean> =>
          Promise.reject(vm.runInNewContext('new Error("foreign failure")')),
        'foreign failure'
      ],
      [
        'rejects with an object with no prototype',
        async (): Promise<boolean> => Promise.reject(Object.create(null)),
        'unprintable error'
      ]
    ])('should warn, not throw, when hasTemplate %s', async (_label, hasTemplate, reason) => {
      const { service, renderer } = build()
      renderer.hasTemplate.mockImplementation(hasTemplate)

      expect(() => service.onModuleInit()).not.toThrow()
      await settle()

      expect(ours()).toHaveLength(1)
      expect(ours()[0]).toContain('Could not check')
      expect(ours()[0]).toContain(reason)
    })

    // A probe that never settles must not hold boot: the hook returns at once, with nothing logged.
    it('should return at once and stay quiet while hasTemplate never settles', async () => {
      const { service, renderer } = build()
      renderer.hasTemplate.mockImplementation(() => new Promise<boolean>(() => undefined))

      const result: unknown = service.onModuleInit()
      await settle()

      expect(result).toBeUndefined()
      expect(ours()).toHaveLength(0)
    })
  })
})
