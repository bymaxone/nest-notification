/**
 * @fileoverview Holds the push channel's wiring: both registration forms register it, a configured
 * but unusable provider is reported and refused, a dispatch reaches the provider with the request's
 * tenant, and the audit entries of a push name a device count and never a token.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { firstValueFrom, of } from 'rxjs'

import {
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_PUSH_PROVIDER
} from './bymax-notification.constants'
import { BymaxNotificationModule } from './bymax-notification.module'
import { NotificationAuditInterceptor } from './interceptors/notification-audit.interceptor'
import type { IPushProvider } from './interfaces/push-provider.interface'
import type { INotificationLogRepository } from './interfaces/notification-log-repository.interface'
import { NotificationService } from './services/notification.service'
import { PushService } from './services/push.service'
import { loggedText } from './__tests__/logged'

const TOKEN = 'ExponentPushToken[device-token-secret]'

const makeProvider = (configured = true): jest.Mocked<IPushProvider> => ({
  name: 'expo',
  isConfigured: jest.fn(() => configured),
  send: jest.fn(async (options) => ({
    results: [options.tokens].flat().map((token) => ({ token, messageId: 'ticket-1' }))
  }))
})

class ClassProvider implements IPushProvider {
  readonly name = 'class'
  isConfigured(): boolean {
    return true
  }
  async send(): Promise<{ results: [] }> {
    return { results: [] }
  }
}

const compile = async (
  provider: IPushProvider,
  audit?: INotificationLogRepository
): Promise<NotificationService> => {
  const moduleRef = await Test.createTestingModule({
    imports: [
      BymaxNotificationModule.forRoot({
        push: { provider },
        ...(audit ? { audit: { repository: audit } } : {})
      })
    ]
  }).compile()
  return moduleRef.get(NotificationService)
}

describe('push channel registration', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should register only the push service and token for a push-only module', async () => {
    const provider = makeProvider()
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ push: { provider } })]
    }).compile()

    expect(moduleRef.get(BYMAX_NOTIFICATION_PUSH_PROVIDER)).toBe(provider)
    expect(moduleRef.get(PushService)).toBeInstanceOf(PushService)
    expect(moduleRef.get(NotificationService).getEnabledChannels()).toStrictEqual(['push'])
  })

  it('should wire a class provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ push: { provider: ClassProvider } })]
    }).compile()

    expect(moduleRef.get(BYMAX_NOTIFICATION_PUSH_PROVIDER)).toBeInstanceOf(ClassProvider)
  })

  it('should name push in the bootstrap log', () => {
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)

    BymaxNotificationModule.forRoot({ push: { provider: makeProvider() } })

    expect(loggedText(logSpy.mock.calls[0])).toBe(
      '[BYMAX_NOTIFICATION_MODULE_BOOTSTRAP_OK] Initialized with channels: push'
    )
  })

  it('should not register the push token when push is not configured', () => {
    const module = BymaxNotificationModule.forRoot({
      email: { provider: makeProvider() as never, defaultFrom: 'a@b.co' }
    })

    const tokens = (module.providers as { provide?: unknown }[]).map((p) => p.provide)
    expect(tokens).not.toContain(BYMAX_NOTIFICATION_PUSH_PROVIDER)
  })

  it('should register the push channel from forRootAsync, instance and class alike', async () => {
    const provider = makeProvider()
    const withInstance = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({ useFactory: () => ({ push: { provider } }) })
      ]
    }).compile()
    const withClass = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({
          useFactory: () => ({ push: { provider: ClassProvider, defaultTtlSeconds: 60 } })
        })
      ]
    }).compile()

    expect(withInstance.get(BYMAX_NOTIFICATION_PUSH_PROVIDER)).toBe(provider)
    expect(withInstance.get(PushService)).toBeInstanceOf(PushService)
    expect(withInstance.get(NotificationService).getEnabledChannels()).toStrictEqual(['push'])
    expect(withClass.get(BYMAX_NOTIFICATION_PUSH_PROVIDER)).toBeInstanceOf(ClassProvider)
    expect(withClass.get(BYMAX_NOTIFICATION_OPTIONS).push?.defaultTtlSeconds).toBe(60)
  })

  it('should leave push off in forRootAsync when it is not configured', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({
          useFactory: () => ({
            email: { provider: makeProvider() as never, defaultFrom: 'a@b.co' }
          })
        })
      ]
    }).compile()

    expect(moduleRef.get(BYMAX_NOTIFICATION_PUSH_PROVIDER)).toBeNull()
    expect(moduleRef.get(PushService, { strict: false })).toBeUndefined()
    expect(() => moduleRef.get(NotificationService).getPush()).toThrow(
      expect.objectContaining({ code: 'notification.channel_disabled' })
    )
  })
})

describe('push channel on NotificationService', () => {
  it('should dispatch to the provider with the request tenant, never the payload one', async () => {
    const provider = makeProvider()
    const notification = await compile(provider)

    const result = await notification.dispatch({
      channel: 'push',
      tenantId: 'tenant_real',
      payload: { tokens: [TOKEN], title: 'T', body: 'B', tenantId: 'tenant_forged' } as never
    })

    expect(result).toStrictEqual({
      channel: 'push',
      result: { results: [{ token: TOKEN, messageId: 'ticket-1' }] }
    })
    expect(provider.send).toHaveBeenCalledTimes(1)
  })

  it('should return the service when the provider is usable', async () => {
    const notification = await compile(makeProvider())

    expect(notification.getPush()).toBeInstanceOf(PushService)
  })

  it('should refuse and warn about a configured push channel whose provider is not usable', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const notification = await compile(makeProvider(false))

    notification.onModuleInit()

    expect(notification.getEnabledChannels()).toStrictEqual([])
    expect(() => notification.getPush()).toThrow(
      expect.objectContaining({ code: 'notification.channel_disabled' })
    )
    expect(loggedText(warn.mock.calls[0])).toContain('push channel is configured')
    warn.mockRestore()
  })
})

describe('push audit through the interceptor', () => {
  it('should record a device count and never a token or a message', async () => {
    const entries: unknown[] = []
    const repo: INotificationLogRepository = {
      name: 'capture',
      create: async (entry) => {
        entries.push(entry)
      }
    }
    const options = {
      global: { redisNamespace: 'n', defaultLocale: 'en' },
      audit: { swallowErrors: true, maskRecipient: (recipient: string): string => recipient }
    } as never
    const interceptor = new NotificationAuditInterceptor(options, repo)
    const context = {
      getArgs: () => [
        {
          channel: 'push',
          tenantId: 'tenant_a',
          payload: { tokens: [TOKEN, 'ExponentPushToken[b]'], title: 'T', body: 'B' }
        }
      ],
      switchToHttp: () => ({ getRequest: () => undefined })
    } as never

    await firstValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) }))
    await new Promise((resolve) => setImmediate(resolve))

    expect(entries[0]).toMatchObject({ channel: 'push', recipient: 'devices:2', verb: 'sent' })
    expect('purpose' in (entries[0] as object)).toBe(false)
    expect(JSON.stringify(entries)).not.toContain('device-token-secret')
  })

  it('should count a single string token as one device', async () => {
    const entries: unknown[] = []
    const repo: INotificationLogRepository = {
      name: 'capture',
      create: async (entry) => {
        entries.push(entry)
      }
    }
    const options = {
      global: { redisNamespace: 'n', defaultLocale: 'en' },
      audit: { swallowErrors: true, maskRecipient: (recipient: string): string => recipient }
    } as never
    const interceptor = new NotificationAuditInterceptor(options, repo)
    const context = {
      getArgs: () => [
        { channel: 'push', tenantId: 't', payload: { tokens: TOKEN, title: 'T', body: 'B' } }
      ],
      switchToHttp: () => ({ getRequest: () => undefined })
    } as never

    await firstValueFrom(interceptor.intercept(context, { handle: () => of(1) }))
    await new Promise((resolve) => setImmediate(resolve))

    expect(entries[0]).toMatchObject({ recipient: 'devices:1' })
  })
})
