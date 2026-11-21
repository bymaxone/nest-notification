/**
 * @fileoverview Holds `EmailService` to refusing a provider whose `isConfigured` answers anything
 * but a boolean, and the health indicator to reporting it as down.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'
import type { IEmailProvider } from '../interfaces'
import { EmailService } from './email.service'
import { makeAudit, makeOptions, makeRenderer } from './__tests__/email-service.fixtures'

const send = { tenantId: 'acme', to: 'a@b.com', subject: 's', html: '<p>x</p>' }

describe.each(['false', 'yes', 1, {}, null, undefined])(
  'a provider whose isConfigured answers %p',
  (answer) => {
    const provider = {
      name: 'odd',
      isConfigured: () => answer as boolean,
      send: jest.fn(async () => ({ messageId: 'm' }))
    } as IEmailProvider
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    it('should refuse the send before the provider is called', async () => {
      const caught: unknown = await service.send(send).catch((error: unknown) => error)

      expect(caught).toBeInstanceOf(NotificationException)
      expect((caught as NotificationException).code).toBe(
        'notification.email_provider_not_configured'
      )
      expect(provider.send).not.toHaveBeenCalled()
    })
  }
)
