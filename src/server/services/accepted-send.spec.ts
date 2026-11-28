/**
 * @fileoverview Holds a send the provider accepted to being reported as sent: a realm found changed
 * after the acceptance never turns the answer into a refusal, since a caller told the send failed
 * sends it again (RFC 5321 section 6.1: after the `250` the relay answers for the message).
 * @layer integration
 */

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'

import { BYMAX_NOTIFICATION_OBSERVER } from '../bymax-notification.constants'
import { BymaxNotificationModule } from '../bymax-notification.module'
import type { IEmailProvider } from '../interfaces/email-provider.interface'
import type { INotificationObserver } from '../interfaces/notification-observer.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { EmailService } from './email.service'
import { NotificationService } from './notification.service'
import { OtpService } from './otp.service'

const ROOT = Object.prototype as unknown as Record<string, unknown>
const calledThen = jest.fn()

/** What is planted on the realm root while the provider has the message. */
const PLANTS: ReadonlyArray<readonly [string, string, unknown]> = [
  ['an unrelated string key', 'zzz', 'x'],
  ['a then function', 'then', calledThen]
]

let planted: string | undefined

/** Plants the key, as something else in the process could while the relay has the message. */
function plant(key: string, value: unknown): void {
  if (key === '') {
    return
  }
  ROOT[key] = value
  planted = key
}

/** Puts the realm back. */
function restore(): void {
  if (planted !== undefined) {
    delete ROOT[planted]
    planted = undefined
  }
}

/** Runs the operation and restores the realm before anything else looks at it. */
async function settle<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } finally {
    restore()
  }
}

interface Rig {
  readonly module: TestingModule
  readonly rows: Array<{ verb: string }>
  readonly outcomes: string[]
  readonly storage: InMemoryOtpStorage
  readonly codes: string[]
}

const renderer = {
  name: 'test-renderer',
  render: async (): Promise<{ subject: string; html: string }> => ({
    subject: 'Your code',
    html: '<p>code</p>'
  }),
  hasTemplate: async (): Promise<boolean> => true
}

/** Holds the observer where the library's module can inject it. */
class ObserverModule {}

/** The module around a provider that accepts every message, planting the key as it answers. */
async function build(
  key: string,
  value: unknown,
  options: { span?: boolean; sinkFails?: boolean; swallowErrors?: boolean } = {}
): Promise<Rig> {
  const rows: Array<{ verb: string }> = []
  const outcomes: string[] = []
  const codes: string[] = []
  const storage = new InMemoryOtpStorage()
  const provider: IEmailProvider = {
    name: 'accepting',
    isConfigured: () => true,
    send: async (message) => {
      codes.push(message.redactValues?.[0] ?? '')
      await new Promise((resolve) => setImmediate(resolve))
      plant(key, value)
      // No prototype, as the library's own adapters answer: nothing is read off it.
      return Object.assign(Object.create(null) as object, { messageId: 'm1' }) as {
        messageId: string
      }
    }
  }
  const observer: INotificationObserver = {
    onSend: (event) => {
      outcomes.push(event.outcome)
    },
    ...(options.span
      ? { span: <T>(_name: unknown, _attributes: unknown, run: () => Promise<T>) => run() }
      : {})
  }
  const module = await Test.createTestingModule({
    imports: [
      {
        module: ObserverModule,
        global: true,
        providers: [{ provide: BYMAX_NOTIFICATION_OBSERVER, useValue: observer }],
        exports: [BYMAX_NOTIFICATION_OBSERVER]
      },
      BymaxNotificationModule.forRoot({
        email: { provider, defaultFrom: 'no-reply@acme.com', templateRenderer: renderer },
        otp: { storage },
        audit: {
          ...(options.swallowErrors === undefined ? {} : { swallowErrors: options.swallowErrors }),
          repository: {
            name: 'r',
            create: async (entry) => {
              rows.push({ verb: entry.verb })
              if (options.sinkFails) {
                throw new Error('sink down')
              }
            }
          }
        }
      })
    ]
  }).compile()
  return { module, rows, outcomes, storage, codes }
}

const MAIL = { tenantId: 't1', to: 'user@acme.com' }
const CODE_FOR = { tenantId: 't1', recipient: 'user@acme.com', purpose: 'email_verification' }

describe('a send the provider accepted before the realm was found changed', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    calledThen.mockReset()
  })

  afterEach(() => {
    restore()
    jest.restoreAllMocks()
  })

  describe.each(PLANTS)('with %s planted', (_label, key, value) => {
    // The raw send: answered as sent, audited as sent, counted as sent.
    it.each([false, true])('should answer send as sent (observer span: %s)', async (span) => {
      const rig = await build(key, value, { span })
      const email = rig.module.get(EmailService)
      const result = await settle(() => email.send({ ...MAIL, subject: 's', html: '<p>h</p>' }))
      expect(result).toEqual({ messageId: 'm1' })
      expect(rig.rows).toEqual([{ verb: 'sent' }])
      expect(rig.outcomes).toEqual(['sent'])
      expect(calledThen).not.toHaveBeenCalled()
    })

    // The template send goes through one more layer of the service.
    it('should answer sendTemplate as sent', async () => {
      const rig = await build(key, value)
      const email = rig.module.get(EmailService)
      const result = await settle(() =>
        email.sendTemplate({ ...MAIL, template: 'welcome', data: {} })
      )
      expect(result).toEqual({ messageId: 'm1' })
      expect(calledThen).not.toHaveBeenCalled()
    })

    // The dispatch facade builds an answer of its own around the id.
    it('should answer an email dispatch with the message id', async () => {
      const rig = await build(key, value)
      const notifications = rig.module.get(NotificationService)
      const result = await settle(() =>
        notifications.dispatch({
          channel: 'email',
          tenantId: 't1',
          payload: { to: MAIL.to, subject: 's', html: '<p>h</p>' }
        })
      )
      expect(result).toEqual({ channel: 'email', messageId: 'm1' })
      expect(calledThen).not.toHaveBeenCalled()
    })

    // The code is in the recipient's mailbox: it must stay usable and the call must not fail.
    it('should keep an emailed code and answer generate', async () => {
      const rig = await build(key, value)
      const otp = rig.module.get(OtpService)
      const result = await settle(() => otp.generate(CODE_FOR))
      expect(result.cooldownSeconds).toBeGreaterThan(0)
      expect(calledThen).not.toHaveBeenCalled()
      await expect(otp.verify({ ...CODE_FOR, code: rig.codes[0] as string })).resolves.toEqual({
        valid: true
      })
    })

    // The same code path reached through the facade.
    it('should answer an otp dispatch that emailed a code', async () => {
      const rig = await build(key, value)
      const notifications = rig.module.get(NotificationService)
      const result = await settle(() =>
        notifications.dispatch({
          channel: 'otp',
          tenantId: 't1',
          payload: { recipient: CODE_FOR.recipient, purpose: CODE_FOR.purpose }
        })
      )
      expect(result).toMatchObject({ channel: 'otp' })
      expect(calledThen).not.toHaveBeenCalled()
    })
  })

  // A host that asked for audit failures to surface still gets them while the realm is unchanged.
  it('should still surface a failed audit write when swallowErrors is false', async () => {
    const rig = await build('', undefined, { sinkFails: true, swallowErrors: false })
    const email = rig.module.get(EmailService)
    await expect(email.send({ ...MAIL, subject: 's', html: '<p>h</p>' })).rejects.toMatchObject({
      code: 'notification.audit_log_failed'
    })
  })

  // On a changed realm the sink's promise is not awaited: the row is started, the loss is warned
  // about, and the accepted send is still answered as sent.
  it('should warn and answer as sent when the realm change hides how the audit write ended', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn')
    const rig = await build('zzz', 'x', { sinkFails: true, swallowErrors: false })
    const email = rig.module.get(EmailService)
    const result = await settle(() => email.send({ ...MAIL, subject: 's', html: '<p>h</p>' }))
    expect(result).toEqual({ messageId: 'm1' })
    expect(rig.rows).toEqual([{ verb: 'sent' }])
    expect(JSON.stringify(warn.mock.calls)).toContain('BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED')
  })
})
