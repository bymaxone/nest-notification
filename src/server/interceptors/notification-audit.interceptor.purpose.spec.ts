/**
 * @fileoverview Holds `NotificationAuditInterceptor` to writing an OTP purpose into an audit entry
 * only when it is a plain name. The interceptor sees the payload before the service refuses it, and
 * it audits a refused call too, so the value it records must not be the refused one: a control
 * character forges a log record, and a length is unbounded. The remaining interceptor specs live
 * in `notification-audit.interceptor.spec.ts`.
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

class CapturingRepo implements INotificationLogRepository {
  readonly name = 'capture'
  readonly entries: NotificationLogEntry[] = []
  create = jest.fn(async (entry: NotificationLogEntry): Promise<void> => {
    this.entries.push(entry)
  })
}

const options: ResolvedNotificationOptions = {
  global: { redisNamespace: 'notification', defaultLocale: 'en' },
  audit: { swallowErrors: true, maskRecipient: (recipient: string): string => recipient }
}

function contextOf(purpose: unknown): ExecutionContext {
  const input = {
    channel: 'otp',
    tenantId: 'tenant_a',
    payload: { recipient: 'maria@x.com', purpose }
  }
  return {
    getArgs: <T>(): T => [input] as unknown as T,
    switchToHttp: () => ({ getRequest: <T>(): T => undefined as T })
  } as unknown as ExecutionContext
}

const handlerOf = (
  observable: CallHandler['handle'] extends () => infer R ? R : never
): CallHandler => ({
  handle: () => observable
})

const REFUSED = ['x\nforged record', 'a'.repeat(65), 'a b', 'auth.login', '', 7, null]

describe('NotificationAuditInterceptor and the OTP purpose', () => {
  it.each(REFUSED)(
    'should not record the refused purpose %j after a failed call',
    async (purpose) => {
      const repo = new CapturingRepo()
      const interceptor = new NotificationAuditInterceptor(options, repo)
      const error = new Error('refused')

      await expect(
        firstValueFrom(
          interceptor.intercept(contextOf(purpose), handlerOf(throwError(() => error)))
        )
      ).rejects.toBe(error)

      expect(repo.entries).toHaveLength(1)
      expect(repo.entries[0]).toMatchObject({ verb: 'failed', errorMessage: 'refused' })
      expect(repo.entries[0]).not.toHaveProperty('purpose')
    }
  )

  it.each(REFUSED)(
    'should not record the refused purpose %j after a sent call',
    async (purpose) => {
      const repo = new CapturingRepo()
      const interceptor = new NotificationAuditInterceptor(options, repo)

      await firstValueFrom(interceptor.intercept(contextOf(purpose), handlerOf(of('ok'))))

      expect(repo.entries[0]).toMatchObject({ verb: 'sent' })
      expect(repo.entries[0]).not.toHaveProperty('purpose')
    }
  )

  it('should not carry a refused purpose anywhere in the entry', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(options, repo)

    await firstValueFrom(interceptor.intercept(contextOf('x\nforged record'), handlerOf(of('ok'))))

    expect(JSON.stringify(repo.entries[0])).not.toContain('forged')
  })

  it.each(['email_verification', 'auth:login', 'a'.repeat(64), ':'.repeat(64)])(
    'should record the plain purpose %j',
    async (purpose) => {
      const repo = new CapturingRepo()
      const interceptor = new NotificationAuditInterceptor(options, repo)

      await firstValueFrom(interceptor.intercept(contextOf(purpose), handlerOf(of('ok'))))

      expect(repo.entries[0]).toMatchObject({ purpose })
    }
  )
})
