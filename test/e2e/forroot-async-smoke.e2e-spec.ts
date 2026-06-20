/**
 * @fileoverview Smoke test for the complete `forRootAsync` graph.
 * @layer test
 *
 * Boots the module asynchronously with a `tenantIdResolver`, a Redis-backed OTP
 * storage (via an in-process Redis double), a NoOp email provider and an in-memory
 * audit repository, then proves two things end-to-end: (1) the async-wired services
 * resolve and record audit rows when exercised, and (2) the audit interceptor reads
 * the trusted tenant from the resolved options, overriding a spoofed payload tenant.
 */

import type { ExecutionContext } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { of } from 'rxjs'

import {
  BYMAX_NOTIFICATION_OPTIONS,
  BymaxNotificationModule,
  NoOpEmailProvider,
  NotificationAuditInterceptor,
  NotificationService,
  RedisOtpStorage
} from '@bymax-one/nest-notification'
import type {
  DispatchInput,
  INotificationLogRepository,
  NotificationLogEntry,
  RedisLike,
  ResolvedNotificationOptions
} from '@bymax-one/nest-notification'

const MS_PER_SECOND = 1000

/** In-process Redis double supporting the commands the OTP generate path uses. */
class FakeRedis implements RedisLike {
  private readonly data = new Map<string, string>()
  private readonly expiries = new Map<string, number>()

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    let hasNxFlag = false
    let expirySeconds: number | undefined
    for (let i = 0; i < args.length; i++) {
      const flag = String(args[i]).toUpperCase()
      if (flag === 'NX') {
        hasNxFlag = true
      } else if (flag === 'EX') {
        expirySeconds = Number(args[++i])
      }
    }
    if (hasNxFlag && this.data.has(key)) {
      return null
    }
    this.data.set(key, value)
    if (expirySeconds !== undefined) {
      this.expiries.set(key, Date.now() + expirySeconds * MS_PER_SECOND)
    }
    return 'OK'
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<'OK'> {
    this.data.set(key, value)
    this.expiries.set(key, Date.now() + ttlSeconds * MS_PER_SECOND)
    return 'OK'
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0
    for (const key of keys) {
      if (this.data.delete(key)) {
        removed += 1
      }
      this.expiries.delete(key)
    }
    return removed
  }

  async ttl(key: string): Promise<number> {
    const expiry = this.expiries.get(key)
    if (expiry === undefined) {
      return this.data.has(key) ? -1 : -2
    }
    return Math.ceil((expiry - Date.now()) / MS_PER_SECOND)
  }

  async pttl(key: string): Promise<number> {
    const expiry = this.expiries.get(key)
    return expiry === undefined ? -1 : expiry - Date.now()
  }

  async eval(): Promise<unknown> {
    return JSON.stringify({ status: 'not_found' })
  }
}

/** In-memory audit sink capturing recorded entries. */
class MemoryAuditRepo implements INotificationLogRepository {
  readonly name = 'memory-audit'
  readonly entries: NotificationLogEntry[] = []
  async create(entry: NotificationLogEntry): Promise<void> {
    this.entries.push(entry)
  }
}

/** Mocks an ExecutionContext exposing the dispatch arg + an HTTP request. */
function buildContext(input: DispatchInput, request: unknown): ExecutionContext {
  return {
    getArgs: <T>(): T => [input] as unknown as T,
    switchToHttp: () => ({ getRequest: <T>(): T => request as T })
  } as unknown as ExecutionContext
}

describe('forRootAsync smoke (E2E)', () => {
  let repo: MemoryAuditRepo
  let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>>

  beforeEach(async () => {
    repo = new MemoryAuditRepo()
    moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({
          useFactory: () => ({
            global: {
              tenantIdResolver: (req) => String(req.headers['x-tenant-id'] ?? 'default')
            },
            email: { provider: new NoOpEmailProvider(), defaultFrom: 'noreply@acme.com' },
            otp: { storage: new RedisOtpStorage({ redisClient: new FakeRedis() }) },
            audit: { repository: repo, swallowErrors: true }
          })
        })
      ]
    }).compile()
  })

  // The async-wired NotificationService records a 'generated' audit row on dispatch.
  it('records an audit row through the async-wired service graph', async () => {
    const notifications = moduleRef.get(NotificationService)

    await notifications.dispatch({
      channel: 'otp',
      tenantId: 'tenant_a',
      payload: { recipient: 'user@acme.com', purpose: 'login', action: 'generate', deliverVia: 'manual' }
    })

    const generated = repo.entries.find((entry) => entry.verb === 'generated')
    expect(generated?.tenantId).toBe('tenant_a')
    expect(generated?.channel).toBe('otp')
  })

  // The interceptor reads the trusted tenant from the resolved options (anti-spoofing).
  it('overrides a spoofed payload tenant via the resolved tenantIdResolver', async () => {
    const options = moduleRef.get<ResolvedNotificationOptions>(BYMAX_NOTIFICATION_OPTIONS)
    const interceptor = new NotificationAuditInterceptor(options, repo)
    const input: DispatchInput = {
      channel: 'otp',
      tenantId: 'spoofed_tenant',
      payload: { recipient: 'user@acme.com', purpose: 'login' }
    }
    const ctx = buildContext(input, { headers: { 'x-tenant-id': 'trusted_tenant' } })

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(ctx, { handle: () => of('ok') }).subscribe({
        error: reject,
        complete: resolve
      })
    })

    expect(repo.entries.at(-1)?.tenantId).toBe('trusted_tenant')
    expect(repo.entries.at(-1)?.providerName).toBe('__interceptor__')
  })
})
