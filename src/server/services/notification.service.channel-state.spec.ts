/**
 * @fileoverview Specifies how `NotificationService` reports a channel that is configured but
 * cannot be used (its provider or storage says `isConfigured() === false`): the accessors
 * refuse it exactly as `getEnabledChannels()` omits it, and one warning per such channel is
 * logged at startup.
 * @layer domain
 */
import { Logger } from '@nestjs/common'

import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import {
  makeAudit,
  makeOptions as emailOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { makeOptions as otpOptions } from './__tests__/otp-service.fixtures'
import { EmailService } from './email.service'
import { NotificationService } from './notification.service'
import { OtpService } from './otp.service'

/** An email service over a provider that does, or does not, report itself configured. */
const email = (configured: boolean): EmailService => {
  const provider = makeProvider()
  provider.isConfigured.mockReturnValue(configured)
  return new EmailService(emailOptions(), provider, makeRenderer(), makeAudit())
}

/** A storage that reports itself unconfigured, like an adapter that lacks its client. */
class UnconfiguredStorage extends InMemoryOtpStorage {
  override isConfigured(): boolean {
    return false
  }
}

/** An OTP service over a storage that does, or does not, report itself configured. */
const otp = (configured: boolean): OtpService =>
  new OtpService(
    otpOptions(),
    configured ? new InMemoryOtpStorage() : new UnconfiguredStorage(),
    makeAudit()
  )

describe('NotificationService channel state', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  // The accessor and the listing must agree: a channel is returned by getEmail()/getOtp()
  // exactly when getEnabledChannels() names it.
  it.each([
    ['absent', undefined, false],
    ['configured but unusable', email(false), false],
    ['usable', email(true), true]
  ])(
    'should agree between getEmail() and getEnabledChannels() when email is %s',
    (_label, service, usable) => {
      const notification = new NotificationService(service)

      expect(notification.getEnabledChannels().includes('email')).toBe(usable)
      if (usable) {
        expect(notification.getEmail()).toBe(service)
      } else {
        expect(() => notification.getEmail()).toThrow(
          expect.objectContaining({ code: 'notification.channel_disabled' })
        )
      }
    }
  )

  it.each([
    ['absent', undefined, false],
    ['configured but unusable', otp(false), false],
    ['usable', otp(true), true]
  ])(
    'should agree between getOtp() and getEnabledChannels() when otp is %s',
    (_label, service, usable) => {
      const notification = new NotificationService(undefined, service)

      expect(notification.getEnabledChannels().includes('otp')).toBe(usable)
      if (usable) {
        expect(notification.getOtp()).toBe(service)
      } else {
        expect(() => notification.getOtp()).toThrow(
          expect.objectContaining({ code: 'notification.channel_disabled' })
        )
      }
    }
  )

  // The refusal of an unusable channel says why, so it is not mistaken for a missing section.
  it('should name the reason when the channel is configured but unusable', () => {
    const notification = new NotificationService(email(false), otp(false))

    expect(() => notification.getEmail()).toThrow(
      expect.objectContaining({
        response: {
          error: expect.objectContaining({
            details: { channel: 'email', reason: 'provider_not_configured' }
          })
        }
      })
    )
    expect(() => notification.getOtp()).toThrow(
      expect.objectContaining({
        response: {
          error: expect.objectContaining({
            details: { channel: 'otp', reason: 'storage_not_configured' }
          })
        }
      })
    )
  })

  // An absent channel keeps its plain refusal, with no reason to explain.
  it('should not add a reason when the channel is absent', () => {
    const notification = new NotificationService()

    expect(() => notification.getEmail()).toThrow(
      expect.objectContaining({
        response: { error: expect.objectContaining({ details: { channel: 'email' } }) }
      })
    )
  })

  // A dispatch to an unusable channel is a disabled channel, not a send that fails later.
  it('should refuse a dispatch to an unusable email channel', async () => {
    const notification = new NotificationService(email(false))

    await expect(
      notification.dispatch({
        channel: 'email',
        tenantId: 't',
        payload: { to: 'a@x.com', subject: 's', html: '<p>h</p>' }
      })
    ).rejects.toMatchObject({ code: 'notification.channel_disabled' })
  })

  describe('onModuleInit', () => {
    const warnings = (spy: jest.SpyInstance): string[] =>
      spy.mock.calls.map((call) => String(call[0]))

    // A channel that is configured but unusable would otherwise only show up at the first send.
    it('should warn once per configured-but-unusable channel', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      new NotificationService(email(false), otp(false)).onModuleInit()

      const messages = warnings(warn)
      expect(messages).toHaveLength(2)
      expect(messages[0]).toContain('BYMAX_NOTIFICATION_CHANNEL_NOT_USABLE')
      expect(messages[0]).toContain('email')
      expect(messages[0]).toContain('isConfigured()')
      expect(messages[1]).toContain('otp')
    })

    it('should stay silent for usable and absent channels', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

      new NotificationService(email(true), otp(true)).onModuleInit()
      new NotificationService().onModuleInit()

      expect(warnings(warn)).toHaveLength(0)
    })
  })
})
