/**
 * @fileoverview Holds `NotificationAuditInterceptor` to deriving the verb of a push dispatch from
 * its per-token results: a push whose every token failed is audited `failed`, as the service
 * audits it, and a partial failure stays `sent`. The remaining specs live in
 * `notification-audit.interceptor.spec.ts`.
 * @layer infrastructure
 */

import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { firstValueFrom, of, throwError } from 'rxjs'

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
    [
      'an error entry for every token',
      {
        results: [
          { token: 't', error: 'x' },
          { token: 't', error: 'x' }
        ]
      }
    ],
    ['a reason or an error for every token', { results: [failedToken, { token: 't', error: 'x' }] }]
  ])('should audit %s as failed, as the service counts it', async (_label, value) => {
    const entry = await audited('push', value)

    expect(entry.verb).toBe('failed')
  })

  it.each([
    ['a partial failure', { channel: 'push', result: { results: [failedToken, sentToken] } }],
    ['a full success', { channel: 'push', result: { results: [sentToken, sentToken] } }],
    ['a value that holds no results', { channel: 'push' }],
    ['an empty list of results', { results: [] }],
    [
      'a list of holes, which is by design not a failure of every token',
      { results: new Array<unknown>(2) }
    ],
    ['results that are not a list', { results: 'x' }]
  ])('should audit %s as sent', async (_label, value) => {
    const entry = await audited('push', value)

    expect(entry.verb).toBe('sent')
    expect(entry).not.toHaveProperty('errorMessage')
  })

  it.each(['email', 'otp'])(
    'should audit an %s dispatch as sent whatever its value holds',
    async (channel) => {
      const entry = await audited(channel, { results: [failedToken] })

      expect(entry.verb).toBe('sent')
    }
  )

  it('should let a handler succeed when an argument has a throwing channel getter', async () => {
    const hostile = {
      get channel(): string {
        throw new Error('hostile')
      }
    }
    const context = {
      getArgs: <T>(): T => [hostile] as unknown as T,
      switchToHttp: () => ({ getRequest: <T>(): T => undefined as T })
    } as unknown as ExecutionContext
    const repo: INotificationLogRepository = { name: 'capture', create: async () => undefined }
    const handler: CallHandler = { handle: () => of('done') }

    await expect(
      firstValueFrom(new NotificationAuditInterceptor(options, repo).intercept(context, handler))
    ).resolves.toBe('done')
  })

  it('should audit a push whose result cannot be read as sent, and still return it', async () => {
    const hostile = {
      get results(): unknown {
        throw new Error('hostile')
      }
    }

    const entry = await audited('push', hostile)

    expect(entry).toMatchObject({ verb: 'sent', channel: 'push' })
  })

  it('should audit a rejected push handler as failed and rethrow the same error', async () => {
    const entries: NotificationLogEntry[] = []
    const repo: INotificationLogRepository = {
      name: 'capture',
      create: async (entry) => {
        entries.push(entry)
      }
    }
    const boom = new Error('boom')
    const handler: CallHandler = { handle: () => throwError(() => boom) }

    await expect(
      firstValueFrom(
        new NotificationAuditInterceptor(options, repo).intercept(contextOf('push'), handler)
      )
    ).rejects.toBe(boom)

    expect(entries[0]).toMatchObject({ verb: 'failed', channel: 'push' })
  })

  it('should report a hostile argument as AUDIT_LOG_FAILED when write errors are not swallowed', async () => {
    const hostile = {
      get channel(): string {
        throw new Error('hostile')
      }
    }
    const context = {
      getArgs: <T>(): T => [hostile] as unknown as T,
      switchToHttp: () => ({ getRequest: <T>(): T => undefined as T })
    } as unknown as ExecutionContext
    const repo: INotificationLogRepository = { name: 'capture', create: async () => undefined }
    const strict: ResolvedNotificationOptions = {
      ...options,
      audit: { ...options.audit, swallowErrors: false }
    }

    await expect(
      firstValueFrom(
        new NotificationAuditInterceptor(strict, repo).intercept(context, {
          handle: () => of('done')
        })
      )
    ).rejects.toMatchObject({ response: { error: { code: 'notification.audit_log_failed' } } })
  })
})
