import { Logger } from '@nestjs/common'
import type { DynamicModule, Provider } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import {
  BYMAX_NOTIFICATION_EMAIL_PROVIDER,
  BYMAX_NOTIFICATION_LOG_REPOSITORY,
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_OTP_STORAGE,
  BYMAX_NOTIFICATION_TEMPLATE_RENDERER
} from './bymax-notification.constants'
import { BymaxNotificationModule } from './bymax-notification.module'
import type {
  IEmailProvider,
  INotificationLogRepository,
  IOtpStorage
} from './interfaces'
import { DefaultTemplateRenderer } from './providers/default-template-renderer'
import { NoOpNotificationLogRepository } from './providers/no-op-notification-log.repository'

const emailProvider: IEmailProvider = {
  name: 'fake',
  isConfigured: () => true,
  send: async () => ({ messageId: 'x' })
}
const validEmail = { provider: emailProvider, defaultFrom: 'noreply@example.com' }

class FakeOtpStorage {}
const auditRepository = { name: 'fake', create: async () => undefined } as INotificationLogRepository

type AnyProvider = Provider & { provide?: unknown }
const findProvider = (module: DynamicModule, token: symbol): AnyProvider | undefined =>
  (module.providers as AnyProvider[] | undefined)?.find((provider) => provider.provide === token)

describe('BymaxNotificationModule.forRoot', () => {
  // The dynamic module must be global and self-identifying so NestJS registers it.
  it('should return a global DynamicModule', () => {
    const module = BymaxNotificationModule.forRoot({ email: validEmail })

    expect(module.module).toBe(BymaxNotificationModule)
    expect(module.global).toBe(true)
  })

  // Email-only config registers exactly: options + audit (no-op) + provider + renderer.
  it('should register four providers for an email-only config', () => {
    const module = BymaxNotificationModule.forRoot({ email: validEmail })

    expect(module.providers).toHaveLength(4)
    expect(module.exports).toEqual([
      BYMAX_NOTIFICATION_OPTIONS,
      BYMAX_NOTIFICATION_LOG_REPOSITORY,
      BYMAX_NOTIFICATION_EMAIL_PROVIDER,
      BYMAX_NOTIFICATION_TEMPLATE_RENDERER
    ])
  })

  // Unconfigured channels must not register their token.
  it('should not register the OTP storage token when otp is not configured', () => {
    const module = BymaxNotificationModule.forRoot({ email: validEmail })

    expect(findProvider(module, BYMAX_NOTIFICATION_OTP_STORAGE)).toBeUndefined()
  })

  // OTP-only config registers the storage token (and omits the email tokens).
  it('should register the OTP storage token when otp is configured', () => {
    const module = BymaxNotificationModule.forRoot({ otp: { storage: new FakeOtpStorage() as IOtpStorage } })

    expect(findProvider(module, BYMAX_NOTIFICATION_OTP_STORAGE)).toBeDefined()
    expect(findProvider(module, BYMAX_NOTIFICATION_EMAIL_PROVIDER)).toBeUndefined()
  })

  // A class reference must become a useClass provider so NestJS instantiates it.
  it('should wire a class provider with useClass', () => {
    const module = BymaxNotificationModule.forRoot({
      otp: { storage: FakeOtpStorage as unknown as IOtpStorage }
    })
    const provider = findProvider(module, BYMAX_NOTIFICATION_OTP_STORAGE)

    expect(provider).toHaveProperty('useClass', FakeOtpStorage)
  })

  // A ready instance must become a useValue provider so NestJS uses it as-is.
  it('should wire an instance provider with useValue', () => {
    const module = BymaxNotificationModule.forRoot({ email: validEmail })
    const provider = findProvider(module, BYMAX_NOTIFICATION_EMAIL_PROVIDER)

    expect(provider).toHaveProperty('useValue', emailProvider)
  })

  // With no audit config the no-op repository is registered as the default sink.
  it('should default the audit repository to the no-op implementation', () => {
    const module = BymaxNotificationModule.forRoot({ email: validEmail })
    const provider = findProvider(module, BYMAX_NOTIFICATION_LOG_REPOSITORY)

    expect(provider).toHaveProperty('useClass', NoOpNotificationLogRepository)
  })

  // A configured audit repository instance must be registered under its token.
  it('should register a configured audit repository', () => {
    const module = BymaxNotificationModule.forRoot({
      email: validEmail,
      audit: { repository: auditRepository }
    })
    const provider = findProvider(module, BYMAX_NOTIFICATION_LOG_REPOSITORY)

    expect(provider).toHaveProperty('useValue', auditRepository)
  })

  // With no template renderer configured the default renderer is wired via factory.
  it('should default the template renderer to a factory', () => {
    const module = BymaxNotificationModule.forRoot({ email: validEmail })
    const provider = findProvider(module, BYMAX_NOTIFICATION_TEMPLATE_RENDERER)

    expect(provider).toHaveProperty('useFactory')
  })

  // A configured renderer instance must be registered under its token directly.
  it('should register a configured template renderer instance', () => {
    const renderer = new DefaultTemplateRenderer({ templates: {} })
    const module = BymaxNotificationModule.forRoot({
      email: { ...validEmail, templateRenderer: renderer }
    })
    const provider = findProvider(module, BYMAX_NOTIFICATION_TEMPLATE_RENDERER)

    expect(provider).toHaveProperty('useValue', renderer)
  })

  // Validation runs first: an empty config throws before any provider is built.
  it('should throw for an empty configuration', () => {
    expect(() => BymaxNotificationModule.forRoot({})).toThrow('At least one channel must be configured')
  })

  // A successful bootstrap emits the BOOTSTRAP_OK log naming the active channels.
  it('should emit a bootstrap log naming the active channels', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)

    BymaxNotificationModule.forRoot({ email: validEmail, otp: { storage: new FakeOtpStorage() as IOtpStorage } })

    const logged = String(logSpy.mock.calls[0]?.[0])
    expect(logged).toContain('BYMAX_NOTIFICATION_MODULE_BOOTSTRAP_OK')
    expect(logged).toContain('email')
    expect(logged).toContain('otp')
  })
})

describe('BymaxNotificationModule resolved options container', () => {
  // The resolved, frozen options must be globally available under their token.
  it('should expose the resolved options globally', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ email: validEmail })]
    }).compile()

    const options = moduleRef.get(BYMAX_NOTIFICATION_OPTIONS)
    expect(options.email?.defaultFrom).toBe('noreply@example.com')
    expect(Object.isFrozen(options)).toBe(true)
  })

  // The default renderer must resolve to a DefaultTemplateRenderer instance.
  it('should resolve the default template renderer', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ email: validEmail })]
    }).compile()

    expect(moduleRef.get(BYMAX_NOTIFICATION_TEMPLATE_RENDERER)).toBeInstanceOf(DefaultTemplateRenderer)
  })
})

describe('BymaxNotificationModule.forRootAsync', () => {
  // The async form returns a global module exposing the options token.
  it('should return a global module exposing the options token', () => {
    const module = BymaxNotificationModule.forRootAsync({ useFactory: () => ({ email: validEmail }) })

    expect(module.global).toBe(true)
    expect(module.exports).toEqual([BYMAX_NOTIFICATION_OPTIONS])
    expect(module.imports).toEqual([])
  })

  // imports and inject are passed through when supplied.
  it('should pass through imports and inject', () => {
    const module = BymaxNotificationModule.forRootAsync({
      imports: [],
      inject: ['CONFIG'],
      useFactory: () => ({ email: validEmail })
    })
    const provider = module.providers?.[0] as { inject?: unknown[] }

    expect(provider.inject).toEqual(['CONFIG'])
  })

  // The async factory must validate and resolve the options it produces.
  it('should validate and resolve options from the factory', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({ useFactory: () => ({ otp: { storage: new FakeOtpStorage() as IOtpStorage } }) })
      ]
    }).compile()

    const options = moduleRef.get(BYMAX_NOTIFICATION_OPTIONS)
    expect(options.otp?.defaultLength).toBe(6)
  })
})
