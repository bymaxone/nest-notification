import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { firstValueFrom, of, throwError } from 'rxjs'
import type { Observable } from 'rxjs'

import type { ResolvedNotificationOptions } from '../config/resolved-options'
import { NotificationException } from '../errors/notification-exception'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import type { DispatchInput } from '../services/notification.service'

import { NotificationAuditInterceptor } from './notification-audit.interceptor'

/** Audit repository double recording every entry; `create` is swappable for failure cases. */
class CapturingRepo implements INotificationLogRepository {
  readonly name = 'capture'
  readonly entries: NotificationLogEntry[] = []
  create = jest.fn(async (entry: NotificationLogEntry): Promise<void> => {
    this.entries.push(entry)
  })
}

const otpInput: DispatchInput = {
  channel: 'otp',
  tenantId: 'payload_tenant',
  payload: { recipient: 'maria@x.com', purpose: 'email_verification' }
}

/** Builds resolved options, defaulting to swallow-on, identity mask, no resolver. */
function buildOptions(
  overrides: Partial<{
    swallowErrors: boolean
    maskRecipient: (recipient: string) => string
    tenantIdResolver: ResolvedNotificationOptions['global']['tenantIdResolver']
  }> = {}
): ResolvedNotificationOptions {
  return {
    global: {
      redisNamespace: 'notification',
      defaultLocale: 'en',
      ...(overrides.tenantIdResolver ? { tenantIdResolver: overrides.tenantIdResolver } : {})
    },
    audit: {
      swallowErrors: overrides.swallowErrors ?? true,
      maskRecipient: overrides.maskRecipient ?? ((recipient: string): string => recipient)
    }
  }
}

/** Mocks an ExecutionContext over the given handler args and optional HTTP request. */
function buildContext(
  args: unknown[],
  options: { request?: unknown; throwOnHttp?: boolean } = {}
): ExecutionContext {
  return {
    getArgs: <T>(): T => args as unknown as T,
    switchToHttp: () => {
      if (options.throwOnHttp) {
        throw new Error('not an http context')
      }
      return { getRequest: <T>(): T => options.request as T }
    }
  } as unknown as ExecutionContext
}

/** Wraps an observable as a CallHandler. */
function handlerOf(observable: Observable<unknown>): CallHandler {
  return { handle: () => observable }
}

describe('NotificationAuditInterceptor', () => {
  // A successful dispatch records a 'sent' entry tagged with the interceptor marker.
  it('records a sent entry and passes the value through', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
    const ctx = buildContext([otpInput])

    const value = await firstValueFrom(interceptor.intercept(ctx, handlerOf(of('RESULT'))))

    expect(value).toBe('RESULT')
    expect(repo.entries).toHaveLength(1)
    expect(repo.entries[0]).toMatchObject({
      channel: 'otp',
      verb: 'sent',
      tenantId: 'payload_tenant',
      recipient: 'maria@x.com',
      purpose: 'email_verification',
      providerName: '__interceptor__',
      metadata: { interceptedBy: 'NotificationAuditInterceptor' }
    })
    expect(repo.entries[0]).not.toHaveProperty('errorMessage')
  })

  // A rejected dispatch records a 'failed' entry then re-throws the ORIGINAL error.
  it('records a failed entry and re-throws the original error', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
    const ctx = buildContext([otpInput])
    const error = new Error('downstream boom')

    await expect(
      firstValueFrom(interceptor.intercept(ctx, handlerOf(throwError(() => error))))
    ).rejects.toBe(error)
    expect(repo.entries[0]).toMatchObject({ verb: 'failed', errorMessage: 'downstream boom' })
  })

  // A non-Error rejection is stringified for the audit message.
  it('stringifies a non-Error rejection', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
    const ctx = buildContext([otpInput])

    await expect(
      firstValueFrom(interceptor.intercept(ctx, handlerOf(throwError(() => 'string failure'))))
    ).rejects.toBe('string failure')
    expect(repo.entries[0]).toMatchObject({ verb: 'failed', errorMessage: 'string failure' })
  })

  // The tenant resolver is the trusted source — it overrides a spoofed payload tenantId.
  it('prefers the tenantIdResolver over the payload tenantId (anti-spoofing)', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(
      buildOptions({
        tenantIdResolver: (req) => String(req.headers['x-tenant-id'])
      }),
      repo
    )
    const ctx = buildContext([otpInput], { request: { headers: { 'x-tenant-id': 'trusted' } } })

    await firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))

    expect(repo.entries[0]?.tenantId).toBe('trusted')
  })

  // With a resolver set but no resolvable request, the payload tenantId is the fallback.
  it('falls back to the payload tenantId when the request is absent', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(
      buildOptions({ tenantIdResolver: () => 'never_used' }),
      repo
    )
    const ctx = buildContext([otpInput], { request: undefined })

    await firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))

    expect(repo.entries[0]?.tenantId).toBe('payload_tenant')
  })

  // A non-HTTP context (switchToHttp throws) also falls back to the payload tenantId.
  it('falls back to the payload tenantId outside an HTTP context', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(
      buildOptions({ tenantIdResolver: () => 'never_used' }),
      repo
    )
    const ctx = buildContext([otpInput], { throwOnHttp: true })

    await firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))

    expect(repo.entries[0]?.tenantId).toBe('payload_tenant')
  })

  // Nothing is recorded when no argument matches the dispatch shape.
  it('skips recording when no dispatch argument is present', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
    const ctx = buildContext([{ unrelated: true }])

    const value = await firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))

    expect(value).toBe('ok')
    expect(repo.entries).toHaveLength(0)
  })

  // Non-object and null args are rejected by the shape guard — pins the
  // `typeof value !== 'object' || value === null` branch. `swallowErrors: false`
  // ensures a broken guard that property-accesses `null` surfaces as a throw
  // rather than being silently swallowed (which would mask the mutant).
  it('skips a null argument without recording', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions({ swallowErrors: false }), repo)
    const ctx = buildContext([null, 'a string', 42])

    await expect(firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))).resolves.toBe('ok')
    expect(repo.entries).toHaveLength(0)
  })

  // An object shaped like a dispatch input but whose `payload` is not an object is
  // rejected — pins the `typeof payload === 'object' && payload !== null` guard. A
  // broken guard would record an entry (mis-detection), which the length check fails.
  it('skips an arg with a non-object payload', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions({ swallowErrors: false }), repo)
    const ctx = buildContext([{ channel: 'otp', tenantId: 't', payload: 'not-an-object' }])

    await expect(firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))).resolves.toBe('ok')
    expect(repo.entries).toHaveLength(0)
  })

  // An object with a valid channel but a null payload is also rejected — pins the
  // `payload !== null` half of the guard.
  it('skips an arg with a null payload', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions({ swallowErrors: false }), repo)
    const ctx = buildContext([{ channel: 'email', tenantId: 't', payload: null }])

    await expect(firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))).resolves.toBe('ok')
    expect(repo.entries).toHaveLength(0)
  })

  // A function carrying dispatch-shaped properties is rejected by the `typeof value
  // !== 'object'` half of the guard — pins it specifically: a mutant dropping that
  // operand would treat the (callable) function as a dispatch input and record an
  // entry, since its `channel`/`tenantId`/`payload` props otherwise pass every check.
  it('skips a function argument that carries dispatch-shaped properties', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions({ swallowErrors: false }), repo)
    const fnArg = Object.assign(() => undefined, {
      channel: 'otp',
      tenantId: 't',
      payload: { recipient: 'maria@x.com', purpose: 'login' }
    })
    const ctx = buildContext([fnArg])

    await expect(firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))).resolves.toBe('ok')
    expect(repo.entries).toHaveLength(0)
  })

  // An object whose channel is neither 'email' nor 'otp' is rejected — pins the
  // channel discrimination, then the valid input later in the arg list is recorded.
  it('skips a wrong-channel arg but records a later valid dispatch input', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
    const ctx = buildContext([{ channel: 'sms', tenantId: 't', payload: {} }, otpInput])

    await firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))

    expect(repo.entries).toHaveLength(1)
    expect(repo.entries[0]?.channel).toBe('otp')
  })

  // By default an audit write failure is swallowed and the flow proceeds.
  it('swallows audit write failures by default', async () => {
    const repo = new CapturingRepo()
    repo.create.mockRejectedValueOnce(new Error('db down'))
    const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
    const ctx = buildContext([otpInput])

    await expect(
      firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))
    ).resolves.toBe('ok')
  })

  // With swallowErrors=false an audit write failure propagates as AUDIT_LOG_FAILED.
  it('propagates audit failures when swallowErrors is false', async () => {
    const repo = new CapturingRepo()
    repo.create.mockRejectedValueOnce(new Error('db down'))
    const interceptor = new NotificationAuditInterceptor(buildOptions({ swallowErrors: false }), repo)
    const ctx = buildContext([otpInput])

    // Assert the rethrow carries the underlying cause — pins the `{ cause }` detail.
    await expect(
      firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))
    ).rejects.toMatchObject({
      code: 'notification.audit_log_failed',
      response: { error: { details: { cause: 'db down' } } }
    })
  })

  // A non-Error audit rejection is stringified into the AUDIT_LOG_FAILED cause.
  it('stringifies a non-Error audit rejection cause', async () => {
    const repo = new CapturingRepo()
    repo.create.mockRejectedValueOnce('raw failure')
    const interceptor = new NotificationAuditInterceptor(buildOptions({ swallowErrors: false }), repo)
    const ctx = buildContext([otpInput])

    await expect(
      firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))
    ).rejects.toBeInstanceOf(NotificationException)
  })

  // Security gate: a verify payload's guessed code must never reach the entry.
  it('never serializes the dispatch payload (no code leak)', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
    const verifyInput: DispatchInput = {
      channel: 'otp',
      tenantId: 't',
      payload: { recipient: 'maria@x.com', purpose: 'login', action: 'verify', code: 'SECRET99' }
    }

    await firstValueFrom(interceptor.intercept(buildContext([verifyInput]), handlerOf(of('ok'))))

    expect(JSON.stringify(repo.entries)).not.toContain('SECRET99')
  })

  // The configured mask is applied to the recipient before it is written.
  it('applies the recipient mask', async () => {
    const repo = new CapturingRepo()
    const interceptor = new NotificationAuditInterceptor(
      buildOptions({ maskRecipient: () => 'masked' }),
      repo
    )
    const ctx = buildContext([otpInput])

    await firstValueFrom(interceptor.intercept(ctx, handlerOf(of('ok'))))

    expect(repo.entries[0]?.recipient).toBe('masked')
  })

  describe('email recipient and purpose extraction', () => {
    // A string `to` is used verbatim; the template becomes the audit purpose.
    it('extracts a string recipient and the template purpose', async () => {
      const repo = new CapturingRepo()
      const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
      const input: DispatchInput = {
        channel: 'email',
        tenantId: 't',
        payload: { to: 'jane@acme.com', template: 'welcome' }
      }

      await firstValueFrom(interceptor.intercept(buildContext([input]), handlerOf(of('ok'))))

      expect(repo.entries[0]).toMatchObject({
        channel: 'email',
        recipient: 'jane@acme.com',
        purpose: 'welcome'
      })
    })

    // An array `to` audits its first element.
    it('extracts the first recipient from an array `to`', async () => {
      const repo = new CapturingRepo()
      const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
      const input: DispatchInput = {
        channel: 'email',
        tenantId: 't',
        payload: { to: ['first@acme.com', 'second@acme.com'], subject: 'Hi', html: '<p>Hi</p>' }
      }

      await firstValueFrom(interceptor.intercept(buildContext([input]), handlerOf(of('ok'))))

      expect(repo.entries[0]?.recipient).toBe('first@acme.com')
    })

    // An empty array `to` yields an empty recipient; a raw email omits the purpose.
    it('handles an empty array `to` and omits the purpose for a raw email', async () => {
      const repo = new CapturingRepo()
      const interceptor = new NotificationAuditInterceptor(buildOptions(), repo)
      const input: DispatchInput = {
        channel: 'email',
        tenantId: 't',
        payload: { to: [], subject: 'Hi', html: '<p>Hi</p>' }
      }

      await firstValueFrom(interceptor.intercept(buildContext([input]), handlerOf(of('ok'))))

      expect(repo.entries[0]?.recipient).toBe('')
      expect(repo.entries[0]).not.toHaveProperty('purpose')
    })
  })

  describe('dispatch shape detection', () => {
    const interceptor = new NotificationAuditInterceptor(buildOptions(), new CapturingRepo())

    // Each malformed argument must be rejected by the shape guard (no entry recorded).
    it.each([
      ['a primitive', 123],
      ['null', null],
      ['an unknown channel', { channel: 'sms', tenantId: 't', payload: {} }],
      ['a non-string tenantId', { channel: 'otp', tenantId: 5, payload: {} }],
      ['a non-object payload', { channel: 'otp', tenantId: 't', payload: 'x' }],
      ['a null payload', { channel: 'otp', tenantId: 't', payload: null }]
    ])('ignores %s', async (_label, arg) => {
      const repo = new CapturingRepo()
      const local = new NotificationAuditInterceptor(buildOptions(), repo)

      await firstValueFrom(local.intercept(buildContext([arg]), handlerOf(of('ok'))))

      expect(repo.entries).toHaveLength(0)
    })

    // A well-formed otp argument among others is detected and recorded.
    it('detects a valid dispatch argument among unrelated ones', async () => {
      const repo = new CapturingRepo()
      const local = new NotificationAuditInterceptor(buildOptions(), repo)
      const ctx = buildContext(['noise', otpInput])

      await firstValueFrom(local.intercept(ctx, handlerOf(of('ok'))))

      expect(repo.entries).toHaveLength(1)
    })

    // Sanity: the shared interceptor instance is usable (constructs without DI).
    it('constructs without a DI container', () => {
      expect(interceptor).toBeInstanceOf(NotificationAuditInterceptor)
    })
  })
})
