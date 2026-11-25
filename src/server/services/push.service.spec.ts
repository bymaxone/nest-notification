/**
 * @fileoverview Holds PushService to its contract: one result per token, a failed token that does
 * not fail its batch, a failed call that carries none of the provider's text, and no device token,
 * title, body or data payload in any audit entry.
 * @layer application
 */

import type { HttpException } from '@nestjs/common'

import type { PushReceiptResult } from '../../shared/types/push.types'
import type { ResolvedNotificationOptions } from '../config/resolved-options'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import type { INotificationObserver } from '../interfaces/notification-observer.interface'
import type {
  IPushProvider,
  PushSendOptions,
  PushSendResult
} from '../interfaces/push-provider.interface'

import { PushService } from './push.service'
import type { PushSendInput } from './push.service'

const TOKEN_A = 'ExponentPushToken[secret-device-token-a]'
const TOKEN_B = 'ExponentPushToken[secret-device-token-b]'

const options = (
  push: ResolvedNotificationOptions['push'] | null = {},
  swallowErrors = true
): ResolvedNotificationOptions => ({
  global: { redisNamespace: 'notification', defaultLocale: 'en' },
  audit: { swallowErrors, maskRecipient: (recipient: string): string => recipient },
  ...(push ? { push } : {})
})

const answerFor = (send: PushSendOptions): PushSendResult => ({
  results: [send.tokens].flat().map((token, index) => ({ token, messageId: `ticket-${index}` }))
})

const makeProvider = (): jest.Mocked<IPushProvider> => ({
  name: 'expo',
  isConfigured: jest.fn(() => true),
  send: jest.fn(async (send: PushSendOptions) => answerFor(send)),
  fetchReceipts: jest.fn(async (ids: readonly string[]) =>
    ids.map((ticketId): PushReceiptResult => ({ ticketId, status: 'ok' }))
  )
})

const makeAudit = (): jest.Mocked<INotificationLogRepository> => ({
  name: 'audit',
  create: jest.fn(async (_entry: NotificationLogEntry): Promise<void> => undefined)
})

const input: PushSendInput = {
  tenantId: 'tenant_a',
  tokens: [TOKEN_A, TOKEN_B],
  title: 'Private title',
  body: 'Private body',
  data: { orderId: 'order-secret-1' }
}

const build = (
  provider = makeProvider(),
  audit = makeAudit(),
  push: ResolvedNotificationOptions['push'] | null = {},
  observer?: INotificationObserver
): PushService => new PushService(options(push), provider, audit, observer)

/** The error a promise rejects with, as an Error. */
async function failureOf(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await promise
  } catch (error) {
    return error as Error & { code?: string }
  }
  throw new Error('expected a rejection')
}

describe('PushService.send', () => {
  it('should answer one result per token and hand the provider the message', async () => {
    const provider = makeProvider()

    const result = await build(provider).send(input)

    expect(result.results.map((entry) => entry.token)).toStrictEqual([TOKEN_A, TOKEN_B])
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: [TOKEN_A, TOKEN_B], title: 'Private title' })
    )
  })

  it('should apply the configured default time-to-live only when the push sets none', async () => {
    const provider = makeProvider()
    const service = build(provider, makeAudit(), { defaultTtlSeconds: 600 })

    await service.send(input)
    await service.send({ ...input, ttlSeconds: 30 })

    expect(provider.send.mock.calls[0]?.[0]?.ttlSeconds).toBe(600)
    expect(provider.send.mock.calls[1]?.[0]?.ttlSeconds).toBe(30)
  })

  it('should send no time-to-live when neither the push nor the options set one', async () => {
    const provider = makeProvider()

    await build(provider).send(input)

    expect('ttlSeconds' in (provider.send.mock.calls[0]?.[0] ?? {})).toBe(false)
  })

  it('should audit a count, never a token, a title, a body or a data value', async () => {
    const audit = makeAudit()

    await build(makeProvider(), audit).send({ ...input, userId: 'user-1' })

    const entry = audit.create.mock.calls[0]?.[0]
    expect(entry).toMatchObject({
      channel: 'push',
      verb: 'sent',
      recipient: 'devices:2',
      providerName: 'expo',
      tenantId: 'tenant_a',
      userId: 'user-1',
      metadata: { tokens: 2, failed: 0 }
    })
    const text = JSON.stringify(entry)
    for (const secret of ['secret-device-token', 'Private title', 'Private body', 'order-secret']) {
      expect(text).not.toContain(secret)
    }
  })

  it('should leave userId out of the entry when none was given', async () => {
    const audit = makeAudit()

    await build(makeProvider(), audit).send(input)

    expect('userId' in (audit.create.mock.calls[0]?.[0] ?? {})).toBe(false)
  })

  it('should return a failed token as a result and not throw, so one bad token spares the batch', async () => {
    const provider = makeProvider()
    provider.send.mockResolvedValue({
      results: [
        { token: TOKEN_A, messageId: 'ticket-0' },
        { token: TOKEN_B, reason: 'token_unregistered', retryable: false }
      ]
    })
    const audit = makeAudit()

    const result = await build(provider, audit).send(input)

    expect(result.results[1]).toMatchObject({ reason: 'token_unregistered' })
    expect(audit.create.mock.calls[0]?.[0]).toMatchObject({
      verb: 'sent',
      metadata: { tokens: 2, failed: 1 }
    })
  })

  it('should audit a send whose every token failed as failed, and still return the results', async () => {
    const provider = makeProvider()
    provider.send.mockResolvedValue({
      results: [
        { token: TOKEN_A, reason: 'token_unregistered', retryable: false },
        { token: TOKEN_B, reason: 'token_unregistered', retryable: false }
      ]
    })
    const audit = makeAudit()

    const result = await build(provider, audit).send(input)

    expect(result.results).toHaveLength(2)
    expect(audit.create.mock.calls[0]?.[0]).toMatchObject({ verb: 'failed' })
  })

  describe('a token that cannot be one', () => {
    it.each([
      ['empty', ''],
      ['with a control character', 'bad\ntoken'],
      ['too long', 'x'.repeat(5000)]
    ])(
      'should answer a token that is %s as token_invalid and still send the rest',
      async (_name, bad) => {
        const provider = makeProvider()

        const result = await build(provider).send({ ...input, tokens: [TOKEN_A, bad, TOKEN_B] })

        expect(result.results.map((entry) => entry.reason)).toStrictEqual([
          undefined,
          'token_invalid',
          undefined
        ])
        expect(provider.send.mock.calls[0]?.[0]?.tokens).toStrictEqual([TOKEN_A, TOKEN_B])
      }
    )

    it('should not call the provider and should report failed when no token is usable', async () => {
      const provider = makeProvider()
      const audit = makeAudit()
      const observer = {
        onSend: jest.fn(),
        span: jest.fn(async (_n: string, _a: unknown, run: () => Promise<unknown>) => run())
      } as never

      const result = await build(provider, audit, {}, observer).send({
        ...input,
        tokens: ['', 'a\nb']
      })

      expect(result.results.every((entry) => entry.reason === 'token_invalid')).toBe(true)
      expect(provider.send).not.toHaveBeenCalled()
      expect(audit.create.mock.calls[0]?.[0]).toMatchObject({ verb: 'failed' })
      expect((observer as { onSend: jest.Mock }).onSend).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failed' })
      )
    })
  })

  it('should report failed to the observer when the provider failed every token, as the audit does', async () => {
    const provider = makeProvider()
    provider.send.mockImplementation(async (send: PushSendOptions) => ({
      results: [send.tokens].flat().map((token) => ({
        token,
        reason: 'token_unregistered' as const,
        retryable: false
      }))
    }))
    const audit = makeAudit()
    const onSend = jest.fn()
    const observer = {
      onSend,
      span: jest.fn(async (_n: string, _a: unknown, run: () => Promise<unknown>) => run())
    } as never

    await build(provider, audit, {}, observer).send(input)

    expect(audit.create.mock.calls[0]?.[0]).toMatchObject({ verb: 'failed' })
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
  })

  describe('when the provider throws', () => {
    const throwing = (error: unknown): jest.Mocked<IPushProvider> => {
      const provider = makeProvider()
      provider.send.mockRejectedValue(error)
      return provider
    }

    it('should throw PUSH_SEND_FAILED carrying none of the provider text, a cause or a token', async () => {
      const leaked = new Error(`bad ${TOKEN_A} key sk-secret-key`)
      const audit = makeAudit()

      const error = await failureOf(build(throwing(leaked), audit).send(input))

      expect(error).toMatchObject({ code: 'notification.push_send_failed', status: 502 })
      expect((error as { cause?: unknown }).cause).toBeUndefined()
      expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toMatch(
        /secret|ExponentPushToken/u
      )
      expect(JSON.stringify(audit.create.mock.calls)).not.toMatch(/secret|ExponentPushToken/u)
      expect(audit.create.mock.calls[0]?.[0]).toMatchObject({
        verb: 'failed',
        errorMessage: 'push provider failed',
        recipient: 'devices:2'
      })
    })

    it('should include the user in the failed entry when one was given', async () => {
      const audit = makeAudit()

      await failureOf(build(throwing(new Error('x')), audit).send({ ...input, userId: 'user-9' }))

      expect(audit.create.mock.calls[0]?.[0]).toMatchObject({ userId: 'user-9' })
    })

    it('should answer 503 when the provider could not be reached, and 502 otherwise', async () => {
      const unreachable = Object.assign(new Error('down'), { code: 'EUNAVAILABLE' })

      const down = await failureOf(build(throwing(unreachable)).send(input))
      const refused = await failureOf(build(throwing(new Error('no'))).send(input))

      expect(down).toMatchObject({ status: 503 })
      expect(refused).toMatchObject({ status: 502 })
      expect((down as HttpException).getResponse()).toMatchObject({
        error: { details: { retryable: true } }
      })
      expect((refused as HttpException).getResponse()).toMatchObject({
        error: { details: { retryable: false } }
      })
    })

    it('should pass a refusal of the message on as a refusal and audit no failed delivery', async () => {
      const audit = makeAudit()
      const refusal = await failureOf(build(makeProvider(), audit).send({ ...input, tokens: [] }))
      const provider = throwing(refusal)

      const error = await failureOf(build(provider, audit).send(input))

      expect(error).toMatchObject({ code: 'notification.invalid_scope_identifier' })
      expect(audit.create).not.toHaveBeenCalled()
    })

    it.each([
      ['not an object', 'ok'],
      ['no results', {}],
      ['the wrong number of results', { results: [{ token: TOKEN_A }] }]
    ])('should fail the send when the answer is %s', async (_name, answer) => {
      const provider = makeProvider()
      provider.send.mockResolvedValue(answer as never)

      const error = await failureOf(build(provider).send(input))

      expect(error).toMatchObject({ code: 'notification.push_send_failed' })
    })

    it('should fail the send when the answer is null', async () => {
      const provider = makeProvider()
      provider.send.mockResolvedValue(null as never)

      const error = await failureOf(build(provider).send(input))

      expect(error).toMatchObject({ code: 'notification.push_send_failed' })
    })
  })

  describe('input checks', () => {
    it.each([
      ['', 'empty'],
      ['  ', 'blank'],
      ['a\nb', 'with a control character']
    ])('should refuse a tenant id that is %s', async (tenantId) => {
      const provider = makeProvider()

      const error = await failureOf(build(provider).send({ ...input, tenantId }))

      expect(error).toMatchObject({ code: 'notification.invalid_scope_identifier' })
      expect(provider.send).not.toHaveBeenCalled()
    })

    it('should refuse a malformed push before the provider is called', async () => {
      const provider = makeProvider()

      const error = await failureOf(build(provider).send({ ...input, title: 5 as never }))

      expect(error).toMatchObject({ code: 'notification.invalid_scope_identifier' })
      expect(provider.send).not.toHaveBeenCalled()
    })

    it('should refuse a push when the channel is not configured', async () => {
      const error = await failureOf(build(makeProvider(), makeAudit(), null).send(input))

      expect(error).toMatchObject({ code: 'notification.channel_disabled' })
    })
  })

  describe('audit write', () => {
    it('should swallow an audit failure by default', async () => {
      const audit = makeAudit()
      audit.create.mockRejectedValue(new Error('db down'))

      await expect(build(makeProvider(), audit).send(input)).resolves.toBeDefined()
    })

    it('should surface an audit failure when audit.swallowErrors is false', async () => {
      const audit = makeAudit()
      audit.create.mockRejectedValue(new Error('db down'))
      const service = new PushService(options({}, false), makeProvider(), audit)

      const error = await failureOf(service.send(input))

      expect(error).toMatchObject({ code: 'notification.audit_log_failed' })
    })
  })

  it('should name an unreadable provider as such in the audit entry', async () => {
    const provider = makeProvider()
    Object.defineProperty(provider, 'name', {
      get: () => {
        throw new Error('hostile')
      }
    })
    const audit = makeAudit()

    await build(provider, audit).send(input)

    expect(audit.create.mock.calls[0]?.[0]).toMatchObject({ providerName: '[unreadable]' })
  })
})

describe('PushService observer', () => {
  const recorder = (): jest.Mocked<Required<INotificationObserver>> =>
    ({
      onSend: jest.fn(),
      onOtp: jest.fn(),
      span: jest.fn(async (_name, _attributes, run) => run())
    }) as never

  it('should report a sent push on the push channel, inside a span', async () => {
    const observer = recorder()

    await build(makeProvider(), makeAudit(), {}, observer).send(input)

    expect(observer.span).toHaveBeenCalledWith(
      'notification.send',
      { channel: 'push' },
      expect.any(Function)
    )
    expect(observer.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'push', outcome: 'sent' })
    )
  })

  it('should report a failed provider call as failed', async () => {
    const observer = recorder()
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('x'))

    await failureOf(build(provider, makeAudit(), {}, observer).send(input))

    expect(observer.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'push', outcome: 'failed' })
    )
  })

  it('should report a push the library refused as rejected', async () => {
    const observer = recorder()

    await failureOf(
      build(makeProvider(), makeAudit(), {}, observer).send({ ...input, title: 1 as never })
    )

    expect(observer.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'push', outcome: 'rejected' })
    )
  })

  it('should report a failure that is not the library as failed even before the provider', async () => {
    const observer = recorder()
    const service = build(makeProvider(), makeAudit(), {}, observer)

    await failureOf(service.send(null as never))

    expect(observer.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'push', outcome: 'failed' })
    )
  })

  it('should count a push the provider accepted as sent even when its audit write throws', async () => {
    const observer = recorder()
    const audit = makeAudit()
    audit.create.mockRejectedValue(new Error('db'))
    const service = new PushService(options({}, false), makeProvider(), audit, observer)

    await failureOf(service.send(input))

    expect(observer.onSend).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'push', outcome: 'sent' })
    )
  })
})

describe('PushService.isConfigured', () => {
  it('should be false when the channel has no options', () => {
    expect(build(makeProvider(), makeAudit(), null).isConfigured()).toBe(false)
  })

  it('should follow the provider', () => {
    const provider = makeProvider()
    provider.isConfigured.mockReturnValue(false)

    expect(build(provider).isConfigured()).toBe(false)
    expect(build(makeProvider()).isConfigured()).toBe(true)
  })

  it('should refuse a provider that answers with something that is not a boolean', () => {
    const provider = makeProvider()
    provider.isConfigured.mockReturnValue('yes' as never)

    expect(() => build(provider).isConfigured()).toThrow(
      expect.objectContaining({ code: 'notification.push_provider_not_configured' })
    )
  })

  it('should refuse a provider whose check throws, keeping the error as the cause', () => {
    const provider = makeProvider()
    const cause = new Error('x')
    provider.isConfigured.mockImplementation(() => {
      throw cause
    })

    expect(() => build(provider).isConfigured()).toThrow(
      expect.objectContaining({
        code: 'notification.push_provider_not_configured',
        cause
      })
    )
  })
})

describe('PushService.fetchReceipts', () => {
  it('should return the provider receipts for the ids', async () => {
    const provider = makeProvider()

    const result = await build(provider).fetchReceipts(['t1', 't2'])

    expect(provider.fetchReceipts).toHaveBeenCalledWith(['t1', 't2'])
    expect(result).toStrictEqual([
      { ticketId: 't1', status: 'ok' },
      { ticketId: 't2', status: 'ok' }
    ])
  })

  it('should refuse a malformed id list before the provider is called', async () => {
    const provider = makeProvider()

    const error = await failureOf(build(provider).fetchReceipts([]))

    expect(error).toMatchObject({ code: 'notification.invalid_scope_identifier' })
    expect(provider.fetchReceipts).not.toHaveBeenCalled()
  })

  it('should say the channel cannot read receipts when the provider has none', async () => {
    const provider = makeProvider()
    delete provider.fetchReceipts

    const error = await failureOf(build(provider).fetchReceipts(['t1']))

    expect(error).toMatchObject({ code: 'notification.channel_disabled' })
  })

  it('should classify a failing provider and carry none of its text', async () => {
    const provider = makeProvider()
    provider.fetchReceipts = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error('leak sk-secret'), { code: 'EUNAVAILABLE' }))

    const error = await failureOf(build(provider).fetchReceipts(['t1']))

    expect(error).toMatchObject({ code: 'notification.push_send_failed', status: 503 })
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain('secret')
  })

  it('should fail when the provider answers with something that is not a list', async () => {
    const provider = makeProvider()
    provider.fetchReceipts = jest.fn().mockResolvedValue('nope')

    const error = await failureOf(build(provider).fetchReceipts(['t1']))

    expect(error).toMatchObject({ code: 'notification.push_send_failed' })
  })

  it('should pass a refusal of the ids on as a refusal', async () => {
    const provider = makeProvider()
    const refusal = await failureOf(build(provider).fetchReceipts([]))
    provider.fetchReceipts = jest.fn().mockRejectedValue(refusal)

    const error = await failureOf(build(provider).fetchReceipts(['t1']))

    expect(error).toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })
})
