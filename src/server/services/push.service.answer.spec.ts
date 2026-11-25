/**
 * @fileoverview Holds PushService to counting only an answer it can match to its tokens: an entry
 * per token, in order, each an object naming its own token; a partial failure is a send, not a
 * failure; and a send that is not an object is refused the way the other channels refuse it.
 * @layer application
 */

import type { ResolvedNotificationOptions } from '../config/resolved-options'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import type { INotificationObserver } from '../interfaces/notification-observer.interface'
import type { IPushProvider, PushSendOptions } from '../interfaces/push-provider.interface'

import { NotificationException } from '../errors/notification-exception'
import { PushService } from './push.service'
import type { PushSendInput } from './push.service'

const TOKEN_A = 'ExponentPushToken[secret-device-token-a]'
const TOKEN_B = 'ExponentPushToken[secret-device-token-b]'

const options: ResolvedNotificationOptions = {
  global: { redisNamespace: 'notification', defaultLocale: 'en' },
  audit: { swallowErrors: true, maskRecipient: (recipient: string): string => recipient },
  push: {}
}

const input: PushSendInput = {
  tenantId: 'tenant_a',
  tokens: [TOKEN_A, TOKEN_B],
  title: 'Title',
  body: 'Body'
}

/** A provider whose answer is whatever the case says, whatever it was asked. */
const answering = (answer: unknown): IPushProvider => ({
  name: 'expo',
  isConfigured: () => true,
  send: jest.fn(async (_send: PushSendOptions) => answer as never)
})

const recorder = (): { entries: NotificationLogEntry[]; audit: INotificationLogRepository } => {
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

const observing = (): { observer: INotificationObserver; outcomes: unknown[] } => {
  const outcomes: unknown[] = []
  const observer = {
    onSend: (event: { outcome: string }) => outcomes.push(event.outcome),
    onOtp: jest.fn(),
    span: jest.fn(async (_name: string, _attributes: unknown, run: () => unknown) => run())
  } as unknown as INotificationObserver
  return { observer, outcomes }
}

async function failureOf(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise
  } catch (error) {
    return error as Error & { code?: string }
  }
  throw new Error('expected a rejection')
}

describe('PushService and the answer of a host provider', () => {
  it.each([
    ['an entry that is null', [null, { token: TOKEN_B, messageId: 'b' }]],
    ['an entry that is not an object', ['x', { token: TOKEN_B, messageId: 'b' }]],
    [
      'entries in the reverse order',
      [
        { token: TOKEN_B, messageId: 'b' },
        { token: TOKEN_A, messageId: 'a' }
      ]
    ],
    ['an entry that names no token', [{ messageId: 'a' }, { token: TOKEN_B, messageId: 'b' }]],
    ['more entries than tokens', [{ token: TOKEN_A }, { token: TOKEN_B }, { token: TOKEN_B }]],
    ['fewer entries than tokens', [{ token: TOKEN_A, messageId: 'a' }]],
    ['an extra entry that names no token', [{ token: TOKEN_A }, { token: TOKEN_B }, {}]],
    ['a list with holes', new Array<unknown>(2)],
    ['a hole after a good entry', Object.assign(new Array<unknown>(2), [{ token: TOKEN_A }])]
  ])(
    'should refuse %s as a failed send and still write the audit entry',
    async (_label, results) => {
      const { entries, audit } = recorder()
      const service = new PushService(options, answering({ results }), audit)

      const error = await failureOf(service.send(input))

      expect(error.code).toBe('notification.push_send_failed')
      expect(error).not.toBeInstanceOf(TypeError)
      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({ verb: 'failed', recipient: 'devices:2' })
    }
  )

  it('should count an entry that carries an error as failed', async () => {
    const { entries, audit } = recorder()
    const provider = answering({
      results: [
        { token: TOKEN_A, error: 'boom' },
        { token: TOKEN_B, error: 'boom' }
      ]
    })

    await new PushService(options, provider, audit).send(input)

    expect(entries[0]).toMatchObject({ verb: 'failed', metadata: { tokens: 2, failed: 2 } })
  })

  it('should count a send as sent when an answer entry pollutes the realm root as it is read', async () => {
    const { observer, outcomes } = observing()
    const planting = {
      get token(): string {
        Reflect.set(Object.prototype, 'plantedByProvider', 1)
        return TOKEN_A
      },
      messageId: 'a'
    }
    const provider = answering({ results: [planting, { token: TOKEN_B, messageId: 'b' }] })
    const { audit } = recorder()

    try {
      await expect(new PushService(options, provider, audit, observer).send(input)).rejects.toThrow(
        NotificationException
      )
    } finally {
      Reflect.deleteProperty(Object.prototype, 'plantedByProvider')
    }

    expect(outcomes).toStrictEqual(['sent'])
  })

  it('should audit a partial failure as sent, with the failed count', async () => {
    const { entries, audit } = recorder()
    const { observer, outcomes } = observing()
    const provider = answering({
      results: [
        { token: TOKEN_A, messageId: 'a' },
        { token: TOKEN_B, reason: 'token_unregistered', retryable: false }
      ]
    })

    await new PushService(options, provider, audit, observer).send(input)

    expect(entries[0]).toMatchObject({ verb: 'sent', metadata: { tokens: 2, failed: 1 } })
    expect(outcomes).toStrictEqual(['sent'])
  })

  it('should audit and report a send whose every token failed as failed', async () => {
    const { entries, audit } = recorder()
    const { observer, outcomes } = observing()
    const provider = answering({
      results: [
        { token: TOKEN_A, reason: 'rate_limited', retryable: true },
        { token: TOKEN_B, reason: 'rate_limited', retryable: true }
      ]
    })

    await new PushService(options, provider, audit, observer).send(input)

    expect(entries[0]).toMatchObject({ verb: 'failed' })
    expect(outcomes).toStrictEqual(['failed'])
  })

  it.each([null, undefined, 'tokens', 7, []])(
    'should refuse a send of %j with the library refusal, not a TypeError',
    async (bad) => {
      const service = new PushService(options, answering({ results: [] }), recorder().audit)

      const error = await failureOf(service.send(bad as never))

      expect(error.code).toBe('notification.invalid_scope_identifier')
      expect(error).not.toBeInstanceOf(TypeError)
    }
  )

  it('should name the input and the reason when a send is not an object', async () => {
    const service = new PushService(options, answering({ results: [] }), recorder().audit)

    const error = (await failureOf(service.send(null as never))) as NotificationException

    expect(error.getResponse()).toMatchObject({
      error: {
        details: { boundary: 'PushService', parameter: 'input', reason: 'must be an object' }
      }
    })
  })

  it('should answer a refusal by the provider on a send as PushService refusing the message', async () => {
    const refusal = new NotificationException('INVALID_SCOPE_IDENTIFIER')
    const provider = { ...answering({}), send: jest.fn().mockRejectedValue(refusal) }

    const error = (await failureOf(
      new PushService(options, provider, recorder().audit).send(input)
    )) as NotificationException

    expect(error.getResponse()).toMatchObject({
      error: { details: { boundary: 'PushService', parameter: 'message' } }
    })
  })

  it('should answer a refusal by the provider on receipts as PushService refusing the message', async () => {
    const refusal = new NotificationException('INVALID_SCOPE_IDENTIFIER')
    const provider = {
      ...answering({}),
      fetchReceipts: jest.fn().mockRejectedValue(refusal)
    } as unknown as IPushProvider

    const error = (await failureOf(
      new PushService(options, provider, recorder().audit).fetchReceipts(['id-1'])
    )) as NotificationException

    expect(error.getResponse()).toMatchObject({
      error: { details: { boundary: 'PushService', parameter: 'message' } }
    })
  })
})
