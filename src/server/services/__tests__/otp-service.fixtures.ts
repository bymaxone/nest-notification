/**
 * @fileoverview Shared fixtures for the OtpService spec files. Lives under
 * `__tests__/`, which the coverage and mutation configs exclude.
 * @layer application
 */

import { resolveOptions } from '../../config/resolved-options'
import type { ResolvedNotificationOptions } from '../../config/resolved-options'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../../interfaces/notification-log-repository.interface'
import type {
  AuditOptions,
  OtpChannelOptions
} from '../../interfaces/notification-module-options.interface'
import { InMemoryOtpStorage } from '../../providers/in-memory-otp.storage'
import type { EmailService } from '../email.service'

export const dummyRepo = {
  name: 'x',
  create: async (): Promise<void> => undefined
} as INotificationLogRepository

export const makeOptions = (
  otp: Partial<OtpChannelOptions> | null = {},
  audit: Partial<AuditOptions> = {}
): ResolvedNotificationOptions =>
  resolveOptions({
    ...(otp ? { otp: { storage: InMemoryOtpStorage, ...otp } } : {}),
    audit: { repository: dummyRepo, ...audit }
  })

export const makeAudit = (): jest.Mocked<INotificationLogRepository> => ({
  name: 'audit',
  create: jest.fn(async (_entry: NotificationLogEntry): Promise<void> => undefined)
})

export const emailSendTemplate = jest.fn()
export const emailServiceStub = { sendTemplate: emailSendTemplate } as unknown as EmailService

export const ref = {
  tenantId: 'tenant_a',
  recipient: 'jane@acme.com',
  purpose: 'email_verification'
}

/**
 * Serializes an error the way a cause-walking log serializer would: message,
 * stack, enumerable own properties, HTTP response body, and every nested
 * `cause`, recursively.
 */
export const serializeErrorChain = (error: unknown): string => {
  if (error === null || typeof error !== 'object') {
    return String(error)
  }
  const chained = error as Error & { cause?: unknown; getResponse?: () => unknown }
  return [
    chained.name,
    chained.message,
    chained.stack ?? '',
    JSON.stringify({ ...chained }),
    typeof chained.getResponse === 'function' ? JSON.stringify(chained.getResponse()) : '',
    'cause' in chained ? serializeErrorChain(chained.cause) : ''
  ].join('\n')
}
