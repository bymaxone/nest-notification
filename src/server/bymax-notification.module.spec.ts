import { Logger, Module } from '@nestjs/common'
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
  BymaxNotificationModuleAsyncOptions,
  IEmailProvider,
  INotificationLogRepository,
  IOtpStorage
} from './interfaces'
import { DefaultTemplateRenderer } from './providers/default-template-renderer'
import { NoOpNotificationLogRepository } from './providers/no-op-notification-log.repository'
import { EmailService } from './services/email.service'
import { NotificationService } from './services/notification.service'
import { OtpService } from './services/otp.service'

const emailProvider: IEmailProvider = {
  name: 'fake',
  isConfigured: () => true,
  send: async () => ({ messageId: 'x' })
}
const validEmail = { provider: emailProvider, defaultFrom: 'noreply@example.com' }

/** Minimal IOtpStorage stub used to exercise channel registration (no real storage). */
class FakeOtpStorage implements IOtpStorage {
  readonly name = 'fake'
  async set(): Promise<void> {}
  async get(): Promise<null> {
    return null
  }
  async consumeAttempt(): Promise<{ status: 'not_found' }> {
    return { status: 'not_found' }
  }
  async update(): Promise<void> {}
  async delete(): Promise<void> {}
  async tryAcquireCooldown(): Promise<boolean> {
    return true
  }
  async getCooldown(): Promise<number> {
    return 0
  }
  async clearCooldown(): Promise<void> {}
  isConfigured(): boolean {
    return true
  }
}
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

  // Email-only config registers the 4 token providers + EmailService + NotificationService.
  it('should register the token providers and email/notification services for email-only', () => {
    const module = BymaxNotificationModule.forRoot({ email: validEmail })

    expect(module.providers).toHaveLength(6)
    expect(module.exports).toEqual([
      BYMAX_NOTIFICATION_OPTIONS,
      BYMAX_NOTIFICATION_LOG_REPOSITORY,
      BYMAX_NOTIFICATION_EMAIL_PROVIDER,
      BYMAX_NOTIFICATION_TEMPLATE_RENDERER,
      EmailService,
      NotificationService
    ])
  })

  // OtpService is registered (and exported) only when the OTP channel is configured.
  it('should register OtpService only for an OTP-configured module', () => {
    const emailOnly = BymaxNotificationModule.forRoot({ email: validEmail })
    const withOtp = BymaxNotificationModule.forRoot({ otp: { storage: new FakeOtpStorage() } })

    expect(emailOnly.exports).not.toContain(OtpService)
    expect(withOtp.exports).toContain(OtpService)
    expect(withOtp.exports).not.toContain(EmailService)
    expect(withOtp.exports).toContain(NotificationService)
  })

  // Unconfigured channels must not register their token.
  it('should not register the OTP storage token when otp is not configured', () => {
    const module = BymaxNotificationModule.forRoot({ email: validEmail })

    expect(findProvider(module, BYMAX_NOTIFICATION_OTP_STORAGE)).toBeUndefined()
  })

  // OTP-only config registers the storage token (and omits the email tokens).
  it('should register the OTP storage token when otp is configured', () => {
    const module = BymaxNotificationModule.forRoot({ otp: { storage: new FakeOtpStorage() } })

    expect(findProvider(module, BYMAX_NOTIFICATION_OTP_STORAGE)).toBeDefined()
    expect(findProvider(module, BYMAX_NOTIFICATION_EMAIL_PROVIDER)).toBeUndefined()
  })

  // A class reference must become a useClass provider so NestJS instantiates it.
  it('should wire a class provider with useClass', () => {
    const module = BymaxNotificationModule.forRoot({
      otp: { storage: FakeOtpStorage }
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

    BymaxNotificationModule.forRoot({ email: validEmail, otp: { storage: new FakeOtpStorage() } })

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

const CONFIG = Symbol('CONFIG')

/** A tiny module exporting a config value, used to prove `forRootAsync` inject works. */
@Module({
  providers: [{ provide: CONFIG, useValue: { from: 'cfg@acme.com' } }],
  exports: [CONFIG]
})
class ConfigStubModule {}

describe('BymaxNotificationModule.forRootAsync', () => {
  // The async form returns a global module exposing every public token + service.
  it('should return a global module exposing the public tokens and services', () => {
    const module = BymaxNotificationModule.forRootAsync({ useFactory: () => ({ email: validEmail }) })

    expect(module.global).toBe(true)
    expect(module.imports).toEqual([])
    expect(module.exports).toEqual(
      expect.arrayContaining([
        BYMAX_NOTIFICATION_OPTIONS,
        BYMAX_NOTIFICATION_LOG_REPOSITORY,
        BYMAX_NOTIFICATION_EMAIL_PROVIDER,
        BYMAX_NOTIFICATION_TEMPLATE_RENDERER,
        BYMAX_NOTIFICATION_OTP_STORAGE,
        EmailService,
        OtpService,
        NotificationService
      ])
    )
  })

  // imports and inject are passed through to the raw-options provider when supplied.
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
        BymaxNotificationModule.forRootAsync({ useFactory: () => ({ otp: { storage: new FakeOtpStorage() } }) })
      ]
    }).compile()

    const options = moduleRef.get(BYMAX_NOTIFICATION_OPTIONS)
    expect(options.otp?.defaultLength).toBe(6)
  })

  // A full async config wires every channel token: instances pass through, classes instantiate.
  it('should wire every channel token from a full async config', async () => {
    const renderer = new DefaultTemplateRenderer({ templates: {} })
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({
          useFactory: () => ({
            email: { provider: emailProvider, defaultFrom: 'noreply@example.com', templateRenderer: renderer },
            otp: { storage: FakeOtpStorage },
            audit: { repository: auditRepository }
          })
        })
      ]
    }).compile()

    expect(moduleRef.get(BYMAX_NOTIFICATION_EMAIL_PROVIDER)).toBe(emailProvider)
    expect(moduleRef.get(BYMAX_NOTIFICATION_OTP_STORAGE)).toBeInstanceOf(FakeOtpStorage)
    expect(moduleRef.get(BYMAX_NOTIFICATION_TEMPLATE_RENDERER)).toBe(renderer)
    expect(moduleRef.get(BYMAX_NOTIFICATION_LOG_REPOSITORY)).toBe(auditRepository)
    expect(moduleRef.get(EmailService)).toBeInstanceOf(EmailService)
    expect(moduleRef.get(OtpService)).toBeInstanceOf(OtpService)
  })

  // An OTP-only async config: email token is null, audit + renderer fall back to defaults.
  it('should default absent channels and audit in async mode', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({ useFactory: () => ({ otp: { storage: new FakeOtpStorage() } }) })
      ]
    }).compile()

    expect(moduleRef.get(BYMAX_NOTIFICATION_EMAIL_PROVIDER)).toBeNull()
    expect(moduleRef.get(BYMAX_NOTIFICATION_OTP_STORAGE)).toBeInstanceOf(FakeOtpStorage)
    expect(moduleRef.get(BYMAX_NOTIFICATION_LOG_REPOSITORY)).toBeInstanceOf(NoOpNotificationLogRepository)
    expect(moduleRef.get(BYMAX_NOTIFICATION_TEMPLATE_RENDERER)).toBeInstanceOf(DefaultTemplateRenderer)
  })

  // An email-only async config resolves the OTP storage token to null.
  it('should resolve the otp storage token to null when otp is absent', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRootAsync({ useFactory: () => ({ email: validEmail }) })]
    }).compile()

    expect(moduleRef.get(BYMAX_NOTIFICATION_OTP_STORAGE)).toBeNull()
  })

  // The factory receives injected dependencies (e.g. a ConfigService) positionally.
  it('should resolve options from an injected dependency', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({
          imports: [ConfigStubModule],
          inject: [CONFIG],
          useFactory: (cfg: { from: string }) => ({
            email: { provider: emailProvider, defaultFrom: cfg.from }
          })
        })
      ]
    }).compile()

    expect(moduleRef.get(BYMAX_NOTIFICATION_OPTIONS).email?.defaultFrom).toBe('cfg@acme.com')
  })

  // The unsupported async forms fail fast with an explicit message.
  it('should reject the useClass async form', () => {
    expect(() =>
      BymaxNotificationModule.forRootAsync({
        useClass: class {}
      } as unknown as BymaxNotificationModuleAsyncOptions)
    ).toThrow('not yet implemented')
  })

  it('should reject the useExisting async form', () => {
    expect(() =>
      BymaxNotificationModule.forRootAsync({
        useExisting: 'SOME_TOKEN'
      } as unknown as BymaxNotificationModuleAsyncOptions)
    ).toThrow('not yet implemented')
  })

  it('should require a useFactory', () => {
    expect(() =>
      BymaxNotificationModule.forRootAsync({} as unknown as BymaxNotificationModuleAsyncOptions)
    ).toThrow('requires a `useFactory`')
  })
})

describe('BymaxNotificationModule service wiring (smoke)', () => {
  // An email-only consumer can resolve EmailService + NotificationService; OtpService is absent.
  it('should resolve EmailService and NotificationService but not OtpService for email-only', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ email: validEmail })]
    }).compile()

    expect(moduleRef.get(EmailService)).toBeInstanceOf(EmailService)
    expect(moduleRef.get(NotificationService)).toBeInstanceOf(NotificationService)
    expect(() => moduleRef.get(OtpService)).toThrow()
  })

  // An OTP-only consumer can resolve OtpService + NotificationService; EmailService is absent.
  it('should resolve OtpService and NotificationService but not EmailService for otp-only', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ otp: { storage: new FakeOtpStorage() } })]
    }).compile()

    expect(moduleRef.get(OtpService)).toBeInstanceOf(OtpService)
    expect(moduleRef.get(NotificationService)).toBeInstanceOf(NotificationService)
    expect(() => moduleRef.get(EmailService)).toThrow()
  })
})
