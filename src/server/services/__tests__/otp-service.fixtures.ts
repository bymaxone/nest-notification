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
 * Freezes `Date.now()` at a value SHORTER than a numeric OTP, for the tests
 * that assert the code appears nowhere in a serialized audit entry.
 *
 * Those assertions compare a generated code against the whole entry, and the
 * entry carries a 13-digit epoch — eight overlapping six-digit windows, every
 * one of them a value the generator can produce (`010101` included). So the
 * comparison fails by coincidence roughly once in 10^5 runs and reads as a leak
 * rather than a flake. A five-digit clock has no six-digit window at all, which
 * removes the coincidence by construction while keeping the FULL entry under
 * assertion — excluding the field would have weakened the gate instead.
 *
 * @returns A restore function; call it once the assertion has run.
 */
export const freezeClockAwayFromCodes = (): (() => void) => {
  const spy = jest.spyOn(Date, 'now').mockReturnValue(12_345)
  return () => {
    spy.mockRestore()
  }
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
