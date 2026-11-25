/**
 * @fileoverview Pins the whole error PushService raises for each refusal, the audit entry of a failed
 * send, the outcome the observer is told and the duration it is given.
 * @layer application
 */

import type { ResolvedNotificationOptions } from '../config/resolved-options'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import type { INotificationObserver } from '../interfaces/notification-observer.interface'
import type { IPushProvider } from '../interfaces/push-provider.interface'

import { PushService } from './push.service'

const TOKEN = 'ExponentPushToken[device-token-a]'

const options: ResolvedNotificationOptions = {
  global: { redisNamespace: 'notification', defaultLocale: 'en' },
  audit: { swallowErrors: true, maskRecipient: (recipient: string): string => recipient },
  push: {}
}

const send = { tenantId: 'tenant_a', tokens: [TOKEN], title: 'T', body: 'B' }

function provider(overrides: Partial<IPushProvider> = {}): IPushProvider {
  return {
    name: 'expo',
    isConfigured: () => true,
    send: async () => ({ results: [{ token: TOKEN, messageId: 'm' }] }),
    ...overrides
  }
}

function recorder(): { entries: NotificationLogEntry[]; audit: INotificationLogRepository } {
  const entries: NotificationLogEntry[] = []
  return {
    entries,
    audit: {
      name: 'audit',
      create: async (entry): Promise<void> => {
        entries.push(entry)
      }
    }
  }
}

/** The whole `error` of a rejection, as a host reads `getResponse()`. */
async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (thrown) {
    return (thrown as { getResponse(): { error: unknown } }).getResponse().error
  }
  throw new Error('expected a rejection')
}

const refusal = (parameter: string, reason: string, boundary = 'PushService'): unknown => ({
  code: 'notification.invalid_scope_identifier',
  details: { boundary, parameter, reason },
  message: `[${boundary}] ${parameter} ${reason}`
})

describe('the whole error of each PushService refusal', () => {
  it.each([
    ['a send that is null', null, refusal('input', 'must be an object')],
    ['a send that is a string', 'x', refusal('input', 'must be an object')],
    [
      'a send with a missing title',
      { ...send, title: undefined },
      refusal('title', 'must be a string of at most 4096 characters')
    ],
    [
      'a send with no tokens',
      { ...send, tokens: [] },
      refusal('tokens', 'needs at least one entry')
    ]
  ])('should say %s with owner, parameter and reason', async (_label, input, expected) => {
    const service = new PushService(options, provider(), recorder().audit)

    expect(await errorOf(service.send(input as never))).toEqual(expected)
  })

  it.each([
    ['an empty list', [], refusal('ticketIds', 'needs at least one entry')],
    [
      'an unusable id',
      [''],
      refusal('ticketIds', 'holds an entry that is not a bounded, printable string')
    ]
  ])(
    'should say %s of ticket ids with owner, parameter and reason',
    async (_label, ids, expected) => {
      const service = new PushService(
        options,
        provider({ fetchReceipts: async () => [] }),
        recorder().audit
      )

      expect(await errorOf(service.fetchReceipts(ids))).toEqual(expected)
    }
  )

  it('should say the provider has no receipts', async () => {
    const service = new PushService(options, provider(), recorder().audit)

    expect(await errorOf(service.fetchReceipts(['r']))).toEqual({
      code: 'notification.channel_disabled',
      details: { channel: 'push', reason: 'receipts_not_supported' },
      message: 'Channel not enabled in module config'
    })
  })

  it('should say a provider receipts answer that is not a list is a failed send, not retryable', async () => {
    const service = new PushService(
      options,
      provider({ fetchReceipts: async () => ({}) as never }),
      recorder().audit
    )

    expect(await errorOf(service.fetchReceipts(['r']))).toEqual({
      code: 'notification.push_send_failed',
      details: { providerName: 'expo', retryable: false },
      message: 'Failed to send push notification'
    })
  })
})

describe('a send the provider failed', () => {
  it('should audit the count of devices and nothing the provider said', async () => {
    const { entries, audit } = recorder()
    const service = new PushService(
      options,
      provider({
        send: async () => {
          throw new Error(`boom ${TOKEN}`)
        }
      }),
      audit
    )

    expect(await errorOf(service.send({ ...send, userId: 'u1' }))).toEqual({
      code: 'notification.push_send_failed',
      details: { providerName: 'expo', retryable: false },
      message: 'Failed to send push notification'
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      tenantId: 'tenant_a',
      channel: 'push',
      verb: 'failed',
      recipient: 'devices:1',
      providerName: 'expo',
      errorMessage: 'push provider failed',
      metadata: { tokens: 1 },
      userId: 'u1'
    })
    expect(JSON.stringify(entries)).not.toContain(TOKEN)
  })

  it('should keep the token of a returned failure out of the audit entry and the log', async () => {
    const { entries, audit } = recorder()
    const logged = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const service = new PushService(
        options,
        provider({
          send: async () => ({
            results: [{ token: TOKEN, reason: 'token_unregistered', retryable: false }]
          })
        }),
        audit
      )

      const result = await service.send({ ...send, userId: 'u1' })

      expect(result.results[0]?.token).toBe(TOKEN)
      expect(JSON.stringify(entries)).not.toContain(TOKEN)
      expect(entries[0]).toMatchObject({ verb: 'failed', metadata: { tokens: 1, failed: 1 } })
      expect(JSON.stringify(logged.mock.calls)).not.toContain(TOKEN)
    } finally {
      logged.mockRestore()
    }
  })

  it('should audit a send that accepted with the counts of devices and failures', async () => {
    const { entries, audit } = recorder()
    const two = [TOKEN, 'ExponentPushToken[device-token-b]']
    const service = new PushService(
      options,
      provider({
        send: async () => ({
          results: [
            { token: two[0] as string, messageId: 'm' },
            { token: two[1] as string, reason: 'token_invalid', retryable: false }
          ]
        })
      }),
      audit
    )

    await service.send({ ...send, tokens: two })

    expect(entries[0]).toMatchObject({ verb: 'sent', metadata: { tokens: 2, failed: 1 } })
  })
})

describe('what the observer is told of a push', () => {
  function observing(): { observer: INotificationObserver; events: unknown[] } {
    const events: unknown[] = []
    const observer = {
      onSend: (event: unknown) => events.push(event),
      onOtp: jest.fn(),
      span: async (_n: string, _a: unknown, run: () => unknown) => run()
    } as unknown as INotificationObserver
    return { observer, events }
  }

  it('should report a refused send as rejected, with the channel', async () => {
    const { observer, events } = observing()
    const service = new PushService(options, provider(), recorder().audit, observer)

    await errorOf(service.send({ ...send, title: undefined } as never))

    expect(events).toStrictEqual([
      { channel: 'push', outcome: 'rejected', seconds: expect.any(Number) }
    ])
  })

  it('should report a provider failure as failed', async () => {
    const { observer, events } = observing()
    const service = new PushService(
      options,
      provider({
        send: async () => {
          throw new Error('x')
        }
      }),
      recorder().audit,
      observer
    )

    await errorOf(service.send(send))

    expect(events).toMatchObject([{ channel: 'push', outcome: 'failed' }])
  })

  it('should report the seconds between the two clock reads', async () => {
    const { observer, events } = observing()
    const clock = jest
      .spyOn(process.hrtime, 'bigint')
      .mockReturnValueOnce(1_000_000_000n)
      .mockReturnValue(3_500_000_000n)
    try {
      await new PushService(options, provider(), recorder().audit, observer).send(send)
    } finally {
      clock.mockRestore()
    }

    expect(events).toStrictEqual([{ channel: 'push', outcome: 'sent', seconds: 2.5 }])
  })
})
