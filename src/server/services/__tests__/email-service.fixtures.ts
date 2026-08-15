/**
 * @fileoverview Shared fixtures for the EmailService spec files. Lives under
 * `__tests__/`, which the coverage and mutation configs exclude.
 * @layer application
 */

import type { ResolvedNotificationOptions } from '../../config/resolved-options'
import type {
  EmailSendOptions,
  EmailSendResult,
  IEmailProvider
} from '../../interfaces/email-provider.interface'
import type {
  IEmailTemplateRenderer,
  RenderedEmail
} from '../../interfaces/email-template-renderer.interface'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../../interfaces/notification-log-repository.interface'

type EmailOpts = NonNullable<ResolvedNotificationOptions['email']>

export const makeOptions = (
  email: Partial<EmailOpts> | null = {},
  audit: Partial<ResolvedNotificationOptions['audit']> = {}
): ResolvedNotificationOptions => ({
  global: { redisNamespace: 'notification', defaultLocale: 'en' },
  audit: { swallowErrors: true, maskRecipient: (recipient: string): string => recipient, ...audit },
  ...(email
    ? {
        email: {
          defaultFrom: 'noreply@acme.com',
          defaultTags: [],
          maxAttachmentBytes: 1_000_000,
          ...email
        }
      }
    : {})
})

export const makeProvider = (): jest.Mocked<IEmailProvider> => ({
  name: 'resend',
  isConfigured: jest.fn((): boolean => true),
  send: jest.fn(async (_options: EmailSendOptions): Promise<EmailSendResult> => ({
    messageId: 'msg_1'
  }))
})

export const makeRenderer = (): jest.Mocked<IEmailTemplateRenderer> => ({
  name: 'default',
  hasTemplate: jest.fn(async (_template: string, _locale: string): Promise<boolean> => true),
  render: jest.fn(
    async (
      _template: string,
      _data: Record<string, unknown>,
      _locale: string
    ): Promise<RenderedEmail> => ({
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi'
    })
  )
})

export const makeAudit = (): jest.Mocked<INotificationLogRepository> => ({
  name: 'audit',
  create: jest.fn(async (_entry: NotificationLogEntry): Promise<void> => undefined)
})

export const baseInput = {
  tenantId: 'tenant_a',
  to: 'jane@acme.com',
  subject: 'S',
  html: '<p>B</p>'
}
