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
  it('should not enable an email channel whose provider throws, and refuse it', async () => {
    const { facade, send } = withThrowingProvider()

    expect(facade.getEnabledChannels()).toEqual([])
    expect(() => facade.getEmail()).toThrow(
      expect.objectContaining({ code: 'notification.channel_disabled' })
    )
    await expect(
      facade.dispatch({ channel: 'email', tenantId: 'acme', payload: baseInput })
    ).rejects.toMatchObject({ code: 'notification.channel_disabled' })
    expect(send).not.toHaveBeenCalled()
  })

  it('should not enable an OTP channel whose store throws, and refuse it', async () => {
    const { facade, set } = withThrowingStore()

    expect(facade.getEnabledChannels()).toEqual([])
    expect(() => facade.getOtp()).toThrow(
      expect.objectContaining({ code: 'notification.channel_disabled' })
    )
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
    ).rejects.toMatchObject({ code: 'notification.channel_disabled' })
    expect(set).not.toHaveBeenCalled()
  })
})
