/**
 * @fileoverview Holds `BymaxNotificationModule` to handing every audit writer a repository that
 * escapes, through the real dependency graph of `forRoot` and of `forRootAsync`: the interceptor,
 * `OtpService` and `EmailService` each write an entry whose strings carry a control character, and
 * the repository the host configured receives it escaped. The token the host injects still
 * resolves to the repository it passed in.
 * @layer infrastructure
 */

import type { CallHandler, DynamicModule, ExecutionContext } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { firstValueFrom, throwError } from 'rxjs'

import { BYMAX_NOTIFICATION_LOG_REPOSITORY } from './bymax-notification.constants'
import { BymaxNotificationModule } from './bymax-notification.module'
import { NotificationAuditInterceptor } from './interceptors/notification-audit.interceptor'
import type {
  BymaxNotificationModuleOptions,
  IEmailProvider,
  INotificationLogRepository
} from './interfaces'
import type { NotificationLogEntry } from './interfaces/notification-log-repository.interface'
import { InMemoryOtpStorage } from './providers/in-memory-otp.storage'
import { EmailService } from './services/email.service'
import { OtpService } from './services/otp.service'

const emailProvider: IEmailProvider = {
  name: 'fake',
  isConfigured: () => true,
  send: async () => ({ messageId: 'm1' })
}

class Capture implements INotificationLogRepository {
  readonly name = 'capture'
  readonly entries: NotificationLogEntry[] = []
  async create(entry: NotificationLogEntry): Promise<void> {
    this.entries.push(entry)
  }
  /** A method of the host's own that it reaches through the injected token. */
  findAll(): NotificationLogEntry[] {
    return this.entries
  }
}

const optionsFor = (audit: INotificationLogRepository): BymaxNotificationModuleOptions => ({
  email: { provider: emailProvider, defaultFrom: 'noreply@acme.com' },
  otp: { storage: new InMemoryOtpStorage() },
  audit: { repository: audit }
})

const MODULES: ReadonlyArray<readonly [string, (audit: Capture) => DynamicModule]> = [
  ['forRoot', (audit) => BymaxNotificationModule.forRoot(optionsFor(audit))],
  [
    'forRootAsync',
    (audit) => BymaxNotificationModule.forRootAsync({ useFactory: () => optionsFor(audit) })
  ]
]

function contextOf(payload: Record<string, unknown>): ExecutionContext {
  const input = { channel: 'otp', tenantId: 'tenant_a', payload }
  return {
    getArgs: <T>(): T => [input] as unknown as T,
    switchToHttp: () => ({ getRequest: <T>(): T => undefined as T })
  } as unknown as ExecutionContext
}

describe.each(MODULES)('%s and the audit writers', (_name, build) => {
  async function compile(audit: Capture) {
    return Test.createTestingModule({
      imports: [build(audit)],
      providers: [NotificationAuditInterceptor]
    }).compile()
  }

  it('should escape the entry the interceptor writes after a failed call', async () => {
    const audit = new Capture()
    const moduleRef = await compile(audit)
    const interceptor = moduleRef.get(NotificationAuditInterceptor)
    const error = new Error('refused')
    const handler: CallHandler = { handle: () => throwError(() => error) }

    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextOf({ recipient: 'a@x.com\nforged', purpose: 'login' }),
          handler
        )
      )
    ).rejects.toBe(error)

    expect(audit.entries).toHaveLength(1)
    expect(audit.entries[0]).toMatchObject({ verb: 'failed', recipient: 'a@x.com\\nforged' })
    expect(audit.entries[0]?.recipient).not.toContain('\n')
  })

  it('should escape the entry OtpService writes', async () => {
    const audit = new Capture()
    const moduleRef = await compile(audit)

    await moduleRef.get(OtpService).generate({
      tenantId: 'tenant_a',
      recipient: 'jane@acme.com',
      purpose: 'login',
      userId: 'u\rx',
      deliverVia: 'manual'
    })

    expect(audit.entries.length).toBeGreaterThan(0)
    for (const written of audit.entries) {
      expect(written.userId).toBe('u\\rx')
    }
  })

  it('should escape the entry EmailService writes', async () => {
    const audit = new Capture()
    const moduleRef = await compile(audit)

    await moduleRef.get(EmailService).send({
      tenantId: 'tenant_a',
      to: 'jane@acme.com',
      subject: 's',
      html: '<p>x</p>',
      userId: 'u\ny'
    })

    expect(audit.entries).toHaveLength(1)
    expect(audit.entries[0]?.userId).toBe('u\\ny')
  })

  // The token is public and a host may inject it to reach its own repository: it still resolves to
  // the very instance that was configured, not to the wrapper the writers use.
  it('should keep resolving the public token to the repository that was configured', async () => {
    const audit = new Capture()
    const moduleRef = await compile(audit)

    const resolved = moduleRef.get<Capture>(BYMAX_NOTIFICATION_LOG_REPOSITORY)

    expect(resolved).toBe(audit)
    expect(resolved.findAll()).toBe(audit.entries)
  })
})
