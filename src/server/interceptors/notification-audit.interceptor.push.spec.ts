/**
 * @fileoverview Holds `NotificationAuditInterceptor` to deriving the verb of a push dispatch from
 * its per-token results: a push whose every token failed is audited `failed`, as the service
 * audits it, and a partial failure stays `sent`. The remaining specs live in
 * `notification-audit.interceptor.spec.ts`.
 * @layer infrastructure
 */

import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { firstValueFrom, of } from 'rxjs'

import type { ResolvedNotificationOptions } from '../config/resolved-options'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'

import { NotificationAuditInterceptor } from './notification-audit.interceptor'

const options: ResolvedNotificationOptions = {
  global: { redisNamespace: 'notification', defaultLocale: 'en' },
  audit: { swallowErrors: true, maskRecipient: (recipient: string): string => recipient }
}

const failedToken = { token: 't', reason: 'rate_limited', retryable: true }
const sentToken = { token: 't', messageId: 'm' }

const contextOf = (channel: string): ExecutionContext => {
  const input = {
    channel,
    tenantId: 'tenant_a',
    payload:
      channel === 'push'
        ? { tokens: ['a', 'b'], title: 't', body: 'b' }
        : { recipient: 'maria@x.com', purpose: 'login' }
  }
  return {
    getArgs: <T>(): T => [input] as unknown as T,
    switchToHttp: () => ({ getRequest: <T>(): T => undefined as T })
  } as unknown as ExecutionContext
}

async function audited(channel: string, value: unknown): Promise<NotificationLogEntry> {
  const entries: NotificationLogEntry[] = []
  const repo: INotificationLogRepository = {
    name: 'capture',
    create: async (entry) => {
      entries.push(entry)
    }
  }
  const handler: CallHandler = { handle: () => of(value) }
  await firstValueFrom(
    new NotificationAuditInterceptor(options, repo).intercept(contextOf(channel), handler)
  )
  return entries[0] as NotificationLogEntry
}

describe('NotificationAuditInterceptor and a push dispatch', () => {
  it.each([
    ['a dispatch result', { channel: 'push', result: { results: [failedToken, failedToken] } }],
    ['a send result', { results: [failedToken, failedToken] }]
  ])('should audit %s whose every token failed as failed', async (_label, value) => {
    const entry = await audited('push', value)

    expect(entry).toMatchObject({ verb: 'failed', channel: 'push', recipient: 'devices:2' })
    expect(entry.errorMessage).toBe('push provider failed')
  })

  it.each([
    ['a partial failure', { channel: 'push', result: { results: [failedToken, sentToken] } }],
    ['a full success', { channel: 'push', result: { results: [sentToken, sentToken] } }],
    ['a value that holds no results', { channel: 'push' }],
    ['an empty list of results', { results: [] }],
    ['results that are not a list', { results: 'x' }]
  ])('should audit %s as sent', async (_label, value) => {
    const entry = await audited('push', value)

    expect(entry.verb).toBe('sent')
    expect(entry).not.toHaveProperty('errorMessage')
  })

  it('should audit an email dispatch as sent whatever its value holds', async () => {
    const entry = await audited('otp', { results: [failedToken] })

    expect(entry.verb).toBe('sent')
  })
})
