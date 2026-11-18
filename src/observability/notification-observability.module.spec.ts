/**
 * @fileoverview Holds the module to wiring the pieces to the services as the README shows: after
 * `BymaxNotificationModule` and `NotificationObservabilityModule.register()`, a real send and a
 * real code leave their samples on a real registry, the readiness check sees the module's provider,
 * and a host that never imports the observability module is unaffected.
 * @layer observability
 */

import { Test } from '@nestjs/testing'
import { Registry } from 'prom-client'

import { BymaxNotificationModule } from '../server/bymax-notification.module'
import { BYMAX_NOTIFICATION_OBSERVER } from '../server/bymax-notification.constants'
import type {
  EmailSendOptions,
  IEmailProvider
} from '../server/interfaces/email-provider.interface'
import { InMemoryOtpStorage } from '../server/providers/in-memory-otp.storage'
import { EmailService } from '../server/services/email.service'
import { OtpService } from '../server/services/otp.service'

import { NOTIFICATION_METRIC_NAMES } from './constants'
import {
  NOTIFICATION_HEALTH_OPTIONS,
  NotificationHealthIndicator
} from './notification-health.indicator'
import { NotificationMetrics } from './notification-metrics'
import { NotificationObservabilityModule } from './notification-observability.module'

const relay = {
  name: 'relay',
  isConfigured: (): boolean => true,
  send: jest.fn(async (_options: EmailSendOptions) => ({ messageId: 'm1' })),
  verify: jest.fn(async () => undefined)
} satisfies IEmailProvider & { verify: () => Promise<void> }

const channels = {
  email: { provider: relay, defaultFrom: 'noreply@acme.com' },
  otp: { storage: new InMemoryOtpStorage(), resendCooldownSeconds: 0 }
}

/** The value of one sample of a scrape, by its series. */
async function sample(registry: Registry, series: string): Promise<number | undefined> {
  const line = (await registry.metrics()).split('\n').find((text) => text.startsWith(`${series} `))
  return line === undefined ? undefined : Number(line.slice(series.length + 1))
}

describe('NotificationObservabilityModule', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('should leave the samples of a real send and a real code on the registry', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRoot(channels),
        NotificationObservabilityModule.register()
      ]
    }).compile()
    const registry = new Registry()
    moduleRef.get(NotificationMetrics).registerMetrics(registry)

    await moduleRef.get(EmailService).send({
      tenantId: 'acme',
      to: 'jane@acme.com',
      subject: 'Hello',
      html: '<p>Hello</p>'
    })
    const otp = moduleRef.get(OtpService)
    const scope = { tenantId: 'acme', recipient: 'jane@acme.com', purpose: 'email_verification' }
    await otp.generate({ ...scope, deliverVia: 'manual' })
    await otp.verify({ ...scope, code: 'wrong' })

    expect(
      await sample(
        registry,
        `${NOTIFICATION_METRIC_NAMES.messages}{channel="email",outcome="sent"}`
      )
    ).toBe(1)
    expect(
      await sample(registry, `${NOTIFICATION_METRIC_NAMES.sendDuration}_count{channel="email"}`)
    ).toBe(1)
    expect(await sample(registry, `${NOTIFICATION_METRIC_NAMES.otp}{event="issued"}`)).toBe(1)
    expect(await sample(registry, `${NOTIFICATION_METRIC_NAMES.otp}{event="failed"}`)).toBe(1)
    await moduleRef.close()
  })

  it('should register the observer under the token the services read', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRoot(channels),
        NotificationObservabilityModule.register()
      ]
    }).compile()

    const observer = moduleRef.get(BYMAX_NOTIFICATION_OBSERVER)

    expect(Object.keys(observer).sort()).toEqual(['onOtp', 'onSend', 'span'])
    await expect(
      observer.span('notification.send', { channel: 'email' }, async () => 7)
    ).resolves.toBe(7)
    await moduleRef.close()
  })

  it('should give the readiness check the module provider, and never send', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRoot(channels),
        NotificationObservabilityModule.register({ health: { timeoutMs: 1000 } })
      ]
    }).compile()

    await expect(moduleRef.get(NotificationHealthIndicator).check()).resolves.toEqual({
      status: 'up'
    })

    expect(relay.verify).toHaveBeenCalledTimes(1)
    expect(relay.send).not.toHaveBeenCalled()
    await moduleRef.close()
  })

  it('should leave a host that does not import it unaffected', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot(channels)]
    }).compile()

    await expect(
      moduleRef.get(EmailService).send({
        tenantId: 'acme',
        to: 'jane@acme.com',
        subject: 'Hello',
        html: '<p>Hello</p>'
      })
    ).resolves.toEqual({ messageId: 'm1' })
    await moduleRef.close()
  })
})

describe('NotificationObservabilityModule.register', () => {
  it('should be global, so the services see the observer without importing it', () => {
    expect(NotificationObservabilityModule.register().global).toBe(true)
  })

  it('should give the readiness check an empty options object when none are given', () => {
    const provided = NotificationObservabilityModule.register().providers?.find(
      (entry) =>
        typeof entry === 'object' &&
        'provide' in entry &&
        entry.provide === NOTIFICATION_HEALTH_OPTIONS
    )

    expect(provided).toMatchObject({ useValue: {} })
  })

  it('should hand the readiness options the host gave', () => {
    const provided = NotificationObservabilityModule.register({
      health: { timeoutMs: 1234 }
    }).providers?.find(
      (entry) =>
        typeof entry === 'object' &&
        'provide' in entry &&
        entry.provide === NOTIFICATION_HEALTH_OPTIONS
    )

    expect(provided).toMatchObject({ useValue: { timeoutMs: 1234 } })
  })
})
