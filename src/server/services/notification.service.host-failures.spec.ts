/**
 * @fileoverview Holds NotificationService to a channel whose provider or store cannot say whether it
 * is configured: the answer is a refusal, never a quieter path. The channel is not enabled, the
 * accessors and `dispatch` refuse it with `CHANNEL_DISABLED`, and nothing is sent or stored.
 * @layer application
 */

import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import {
  baseInput,
  makeAudit,
  makeOptions as makeEmailOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { makeAudit as makeOtpAudit, makeOptions } from './__tests__/otp-service.fixtures'
import { EmailService } from './email.service'
import { NotificationService } from './notification.service'
import { OtpService } from './otp.service'

/** A facade over an email channel whose provider's isConfigured throws. */
function withThrowingProvider(): {
  facade: NotificationService
  send: ReturnType<typeof makeProvider>['send']
} {
  const provider = makeProvider()
  provider.isConfigured.mockImplementation(() => {
    throw new Error('isConfigured of the host')
  })
  const email = new EmailService(makeEmailOptions(), provider, makeRenderer(), makeAudit())
  return { facade: new NotificationService(email), send: provider.send }
}

/** A facade over an OTP channel whose store's isConfigured throws. */
function withThrowingStore(): { facade: NotificationService; set: jest.SpyInstance } {
  const storage = new InMemoryOtpStorage()
  storage.isConfigured = () => {
    throw new Error('isConfigured of the host')
  }
  const set = jest.spyOn(storage, 'set')
  const otp = new OtpService(makeOptions({}), storage, makeOtpAudit())
  return { facade: new NotificationService(undefined, otp), set }
}

describe('NotificationService with a channel that cannot say whether it is configured', () => {
  it('should refuse an email channel whose provider throws, with the code and the cause', async () => {
    const { facade, send } = withThrowingProvider()
    const refusal = expect.objectContaining({
      code: 'notification.email_provider_not_configured',
      cause: expect.objectContaining({ message: 'isConfigured of the host' })
    })

    expect(() => facade.getEnabledChannels()).toThrow(refusal)
    expect(() => facade.getEmail()).toThrow(refusal)
    await expect(
      facade.dispatch({ channel: 'email', tenantId: 'acme', payload: baseInput })
    ).rejects.toEqual(refusal)
    expect(send).not.toHaveBeenCalled()
  })

  it('should refuse an OTP channel whose store throws, with the code and the cause', async () => {
    const { facade, set } = withThrowingStore()
    const refusal = expect.objectContaining({
      code: 'notification.otp_storage_not_configured',
      cause: expect.objectContaining({ message: 'isConfigured of the host' })
    })

    expect(() => facade.getEnabledChannels()).toThrow(refusal)
    expect(() => facade.getOtp()).toThrow(refusal)
    await expect(
      facade.dispatch({
        channel: 'otp',
        tenantId: 'acme',
        payload: {
          action: 'generate',
          recipient: 'a@example.com',
          purpose: 'login',
          deliverVia: 'manual'
        }
      })
    ).rejects.toEqual(refusal)
    expect(set).not.toHaveBeenCalled()
  })

  // Start-up stays fail-closed: the boot hook refuses, it does not warn and carry on with the
  // channel disabled.
  it.each([
    ['an email provider', withThrowingProvider, 'notification.email_provider_not_configured'],
    ['an OTP store', withThrowingStore, 'notification.otp_storage_not_configured']
  ])('should fail start-up when isConfigured of %s throws', (_label, build, code) => {
    const { facade } = build()

    expect(() => facade.onModuleInit()).toThrow(expect.objectContaining({ code }))
  })
})
