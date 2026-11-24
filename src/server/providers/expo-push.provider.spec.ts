/**
 * @fileoverview Behavior of the Expo push adapter against a scripted `fetch`.
 * @layer infrastructure
 */

import { ExpoPushProvider } from './expo-push.provider'
import { EXPO_RECEIPTS_URL, EXPO_SEND_URL } from './expo-push.client'
import type { ExpoFetch } from './expo-push.client'

const TOKEN_A = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'
const TOKEN_B = 'ExpoPushToken[bbbbbbbbbbbbbbbbbbbbbb]'
const TOKEN_C = 'ExponentPushToken[cccccccccccccccccccccc]'
const SECRET = 'expo-access-token-SECRET-value'

type Step = { status?: number; body?: unknown; text?: string; throws?: unknown }

interface Call {
  url: string
  init: RequestInit
}

/** A fetch that answers from a script, one step per call, and records what it was asked. */
function scripted(steps: Step[]): { fetch: ExpoFetch; calls: Call[] } {
  const calls: Call[] = []
  const fetch: ExpoFetch = (url, init) => {
    calls.push({ url, init })
    const step = steps.shift() ?? { status: 200, body: { data: [] } }
    if (step.throws !== undefined) {
      return Promise.reject(step.throws)
    }
    const text = step.text ?? JSON.stringify(step.body ?? {})
    return Promise.resolve(new Response(text, { status: step.status ?? 200 }))
  }
  return { fetch, calls }
}

function messagesOf(call: Call | undefined): Array<Record<string, unknown>> {
  return JSON.parse(String(call?.init.body)) as Array<Record<string, unknown>>
}

/** Awaits a call that must reject and hands back the error it rejected with. */
async function failureOf(pending: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await pending
  } catch (error) {
    return error as Error & { code?: string }
  }
  throw new Error('the call was expected to reject')
}

const base = { title: 't', body: 'b' }

describe('ExpoPushProvider', () => {
  describe('options', () => {
    it('is configured with no credential and is named expo', () => {
      /* Arrange / Act */
      const provider = new ExpoPushProvider()
      /* Assert */
      expect(provider.name).toBe('expo')
      expect(provider.isConfigured()).toBe(true)
    })

    it.each([
      [{ accessToken: '' }, 'accessToken must be a non-empty string'],
      [{ accessToken: 5 as never }, 'accessToken must be a non-empty string'],
      [{ timeoutMs: 0 }, 'timeoutMs must be a positive integer'],
      [{ fetch: 'x' as never }, 'fetch must be a function']
    ])('refuses a bad option %#', (options, message) => {
      /* Act / Assert */
      expect(() => new ExpoPushProvider(options)).toThrow(message)
    })

    it('refuses options that are not an object', () => {
      /* Act / Assert */
      expect(() => new ExpoPushProvider(null as never)).toThrow('options must be an object')
    })
  })

  describe('send', () => {
    it('posts to the fixed URL with redirects refused, a timeout and the bearer token', async () => {
      /* Arrange */
      const { fetch, calls } = scripted([{ body: { data: [{ status: 'ok', id: 'T1' }] } }])
      const provider = new ExpoPushProvider({ fetch, accessToken: SECRET })
      /* Act */
      const result = await provider.send({ ...base, tokens: TOKEN_A })
      /* Assert */
      expect(result.results).toEqual([{ token: TOKEN_A, messageId: 'T1' }])
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(EXPO_SEND_URL)
      expect(calls[0]?.init.redirect).toBe('error')
      expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal)
      expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
        `Bearer ${SECRET}`
      )
    })

    it('sends no authorization header without an access token', async () => {
      /* Arrange */
      const { fetch, calls } = scripted([{ body: { data: [{ status: 'ok', id: 'T1' }] } }])
      /* Act */
      await new ExpoPushProvider({ fetch }).send({ ...base, tokens: [TOKEN_A] })
      /* Assert */
      expect(calls[0]?.init.headers as Record<string, string>).not.toHaveProperty('authorization')
    })

    it('maps every message field to the service payload', async () => {
      /* Arrange */
      const { fetch, calls } = scripted([{ body: { data: [{ status: 'ok', id: 'T1' }] } }])
      /* Act */
      await new ExpoPushProvider({ fetch }).send({
        tokens: TOKEN_A,
        title: 'Hi',
        body: 'Body',
        data: { k: 'v' },
        sound: 'default',
        badge: 3,
        ttlSeconds: 60,
        priority: 'high',
        channelId: 'ch',
        subtitle: 'sub',
        categoryId: 'cat',
        mutableContent: true,
        contentAvailable: true,
        imageUrl: 'https://example.com/i.png'
      })
      /* Assert */
      expect(messagesOf(calls[0])).toEqual([
        {
          to: TOKEN_A,
          title: 'Hi',
          body: 'Body',
          data: { k: 'v' },
          sound: 'default',
          badge: 3,
          ttl: 60,
          priority: 'high',
          channelId: 'ch',
          subtitle: 'sub',
          categoryId: 'cat',
          mutableContent: true,
          _contentAvailable: true,
          richContent: { image: 'https://example.com/i.png' }
        }
      ])
    })

    it('refuses a malformed token locally and does not send it', async () => {
      /* Arrange */
      const { fetch, calls } = scripted([{ body: { data: [{ status: 'ok', id: 'T1' }] } }])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({
        ...base,
        tokens: ['not-a-token', TOKEN_A]
      })
      /* Assert */
      expect(result.results).toEqual([
        { token: 'not-a-token', reason: 'token_invalid', retryable: false },
        { token: TOKEN_A, messageId: 'T1' }
      ])
      expect(messagesOf(calls[0]).map((m) => m.to)).toEqual([TOKEN_A])
    })

    it('makes no call when every token is malformed, and does not throw', async () => {
      /* Arrange */
      const { fetch, calls } = scripted([])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({ ...base, tokens: ['x'] })
      /* Assert */
      expect(calls).toHaveLength(0)
      expect(result.results[0]?.reason).toBe('token_invalid')
    })

    it('reports an unregistered token and keeps the rest of the batch', async () => {
      /* Arrange */
      const { fetch } = scripted([
        {
          body: {
            data: [
              {
                status: 'error',
                message: 'secret provider text',
                details: { error: 'DeviceNotRegistered' }
              },
              { status: 'ok', id: 'T2' }
            ]
          }
        }
      ])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({
        ...base,
        tokens: [TOKEN_A, TOKEN_B]
      })
      /* Assert */
      expect(result.results).toEqual([
        { token: TOKEN_A, reason: 'token_unregistered', retryable: false },
        { token: TOKEN_B, messageId: 'T2' }
      ])
      expect(JSON.stringify(result)).not.toContain('secret provider text')
    })

    it.each([
      ['MessageTooBig', 'message_too_big', false],
      ['MessageRateExceeded', 'rate_limited', true],
      ['MismatchSenderId', 'credentials', false],
      ['InvalidCredentials', 'credentials', false],
      ['SomethingNew', 'unknown', false]
    ])('classifies the ticket error %s as %s', async (code, reason, retryable) => {
      /* Arrange */
      const { fetch } = scripted([
        { body: { data: [{ status: 'error', details: { error: code } }] } }
      ])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({ ...base, tokens: TOKEN_A })
      /* Assert */
      expect(result.results[0]).toEqual({ token: TOKEN_A, reason, retryable })
    })

    it('reads a ticket that is neither ok nor error as unknown', async () => {
      /* Arrange */
      const { fetch } = scripted([{ body: { data: [{ status: 'weird' }] } }])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({ ...base, tokens: TOKEN_A })
      /* Assert */
      expect(result.results[0]).toEqual({
        token: TOKEN_A,
        reason: 'provider_unavailable',
        retryable: false
      })
    })

    it('reads a body whose tickets do not match the tokens as outcome-unknown for all', async () => {
      /* Arrange */
      const { fetch } = scripted([{ body: { data: [{ status: 'ok', id: 'T1' }] } }])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({
        ...base,
        tokens: [TOKEN_A, TOKEN_B]
      })
      /* Assert */
      expect(result.results.map((r) => [r.reason, r.retryable])).toEqual([
        ['provider_unavailable', false],
        ['provider_unavailable', false]
      ])
    })

    it('splits 250 tokens into calls of at most 100', async () => {
      /* Arrange */
      const tokens = Array.from(
        { length: 250 },
        (_, i) => `ExponentPushToken[t${String(i).padStart(4, '0')}]`
      )
      const ok = (n: number): Step => ({
        body: {
          data: Array.from({ length: n }, (_, i) => ({ status: 'ok', id: `id${String(i)}` }))
        }
      })
      const { fetch, calls } = scripted([ok(100), ok(100), ok(50)])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({ ...base, tokens })
      /* Assert */
      expect(calls.map((c) => messagesOf(c).length)).toEqual([100, 100, 50])
      expect(result.results).toHaveLength(250)
    })

    it('keeps earlier tickets when a later chunk fails, with the failed chunk retryable', async () => {
      /* Arrange */
      const tokens = Array.from(
        { length: 150 },
        (_, i) => `ExponentPushToken[t${String(i).padStart(4, '0')}]`
      )
      const { fetch } = scripted([
        { body: { data: Array.from({ length: 100 }, () => ({ status: 'ok', id: 'X' })) } },
        { status: 503, body: {} }
      ])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({ ...base, tokens })
      /* Assert */
      expect(result.results.slice(0, 100).every((r) => r.messageId === 'X')).toBe(true)
      expect(
        result.results
          .slice(100)
          .every((r) => r.reason === 'provider_unavailable' && r.retryable === true)
      ).toBe(true)
    })

    it('throws, naming only the reason, when nothing was sent (503 on the only call)', async () => {
      /* Arrange */
      const { fetch } = scripted([
        { status: 503, body: { errors: [{ code: 'X', message: SECRET }] } }
      ])
      const provider = new ExpoPushProvider({ fetch, accessToken: SECRET })
      /* Act */
      const failure = await failureOf(provider.send({ ...base, tokens: TOKEN_A }))
      /* Assert */
      expect(failure).toBeInstanceOf(Error)
      expect(failure.message).toBe('ExpoPushProvider: the push was not sent (provider_unavailable)')
      expect(String(failure.stack)).not.toContain(SECRET)
      expect(failure.code).toBe('EUNAVAILABLE')
    })

    it('carries no code on a thrown refusal that is not an outage', async () => {
      /* Arrange */
      const { fetch } = scripted([{ status: 401, body: { errors: [{ code: 'UNAUTHORIZED' }] } }])
      /* Act */
      const failure = await failureOf(
        new ExpoPushProvider({ fetch }).send({ ...base, tokens: TOKEN_A })
      )
      /* Assert */
      expect(failure.message).toContain('(credentials)')
      expect(failure.code).toBeUndefined()
    })

    it.each([
      [429, undefined, 'rate_limited', true],
      [400, 'TOO_MANY_REQUESTS', 'rate_limited', true],
      [403, undefined, 'credentials', false],
      [400, 'PUSH_TOO_MANY_NOTIFICATIONS', 'unknown', false],
      [500, undefined, 'provider_unavailable', true]
    ])(
      'classifies a whole-call refusal (status %s, code %s) as %s',
      async (status, code, reason, retryable) => {
        /* Arrange */
        const { fetch } = scripted([
          { status, body: code === undefined ? {} : { errors: [{ code }] } },
          { body: { data: [{ status: 'ok', id: 'T2' }] } }
        ])
        const tokens = Array.from(
          { length: 101 },
          (_, i) => `ExponentPushToken[t${String(i).padStart(4, '0')}]`
        )
        /* Act */
        const result = await new ExpoPushProvider({ fetch }).send({ ...base, tokens })
        /* Assert: the first chunk failed whole, the second chunk was served */
        expect(result.results[0]).toEqual({ token: tokens[0], reason, retryable })
        expect(result.results[100]?.messageId).toBe('T2')
      }
    )

    it('does not treat a lost answer as safe to resend (timeout after the call went out)', async () => {
      /* Arrange */
      const timeout = Object.assign(new Error('The operation was aborted'), {
        name: 'TimeoutError',
        code: 23
      })
      const { fetch } = scripted([{ throws: timeout }])
      /* Act */
      const answer = await new ExpoPushProvider({ fetch }).send({ ...base, tokens: TOKEN_A })
      /* Assert: something may have been delivered, so the send answers instead of throwing */
      expect(answer.results[0]).toEqual({
        token: TOKEN_A,
        reason: 'provider_unavailable',
        retryable: false
      })
    })

    it('treats a refused connection as retryable and throws since nothing was sent', async () => {
      /* Arrange */
      const refused = Object.assign(new TypeError('fetch failed'), {
        cause: { code: 'ECONNREFUSED' }
      })
      const { fetch } = scripted([{ throws: refused }])
      /* Act */
      const failure = await failureOf(
        new ExpoPushProvider({ fetch }).send({ ...base, tokens: TOKEN_A })
      )
      /* Assert */
      expect(failure.message).toContain('(provider_unavailable)')
    })

    it('treats a 2xx whose body is not JSON as outcome-unknown', async () => {
      /* Arrange */
      const { fetch } = scripted([{ text: '<html>' }])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({ ...base, tokens: TOKEN_A })
      /* Assert */
      expect(result.results[0]).toEqual({
        token: TOKEN_A,
        reason: 'provider_unavailable',
        retryable: false
      })
    })

    it('answers a token given twice once, in place', async () => {
      /* Arrange */
      const { fetch } = scripted([
        {
          body: {
            data: [
              { status: 'ok', id: 'T1' },
              { status: 'ok', id: 'T2' }
            ]
          }
        }
      ])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({
        ...base,
        tokens: [TOKEN_A, TOKEN_A]
      })
      /* Assert */
      expect(result.results).toHaveLength(2)
      expect(result.results.every((r) => r.token === TOKEN_A)).toBe(true)
    })

    it('never puts a token or the access token in a thrown error or the result of a failure', async () => {
      /* Arrange */
      const { fetch } = scripted([
        { status: 500, body: { errors: [{ code: 'X', message: `${SECRET} ${TOKEN_A}` }] } }
      ])
      /* Act */
      const failure = await failureOf(
        new ExpoPushProvider({ fetch, accessToken: SECRET }).send({ ...base, tokens: TOKEN_A })
      )
      /* Assert */
      expect(JSON.stringify(failure) + failure.message + String(failure.stack)).not.toContain(
        SECRET
      )
      expect(failure.message).not.toContain(TOKEN_A)
    })
  })

  describe('edge cases', () => {
    it('reads a ticket error with no details as unknown', async () => {
      /* Arrange */
      const { fetch } = scripted([{ body: { data: [{ status: 'error' }] } }])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({ ...base, tokens: TOKEN_A })
      /* Assert */
      expect(result.results[0]).toEqual({ token: TOKEN_A, reason: 'unknown', retryable: false })
    })

    it('uses the platform fetch when none is injected', async () => {
      /* Arrange */
      const spy = jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ data: [{ status: 'ok', id: 'T1' }] })))
      try {
        /* Act */
        const result = await new ExpoPushProvider().send({ ...base, tokens: TOKEN_A })
        /* Assert */
        expect(result.results[0]?.messageId).toBe('T1')
        expect(spy.mock.calls[0]?.[0]).toBe(EXPO_SEND_URL)
      } finally {
        spy.mockRestore()
      }
    })

    it('refuses a data payload that is not a plain object or has too many keys', async () => {
      /* Arrange */
      const { fetch } = scripted([])
      const provider = new ExpoPushProvider({ fetch })
      const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${String(i)}`, 'v']))
      /* Act / Assert */
      await expect(provider.send({ ...base, tokens: TOKEN_A, data: many })).rejects.toBeInstanceOf(
        Error
      )
      await expect(
        provider.send({ ...base, tokens: TOKEN_A, data: new Map() as never })
      ).rejects.toBeInstanceOf(Error)
    })
  })

  describe('requests that mix projects', () => {
    const mixed = (details: unknown): Step => ({
      status: 400,
      body: { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'x', details }] }
    })

    it('sends each project on its own and refuses a token the answer does not place', async () => {
      /* Arrange */
      const { fetch, calls } = scripted([
        mixed({
          '@a/one': [TOKEN_A, TOKEN_B],
          '@a/two': [TOKEN_A, 7, 'ExponentPushToken[zzzzzzzzzzzzzzzzzz]']
        }),
        {
          body: {
            data: [
              { status: 'ok', id: 'T1' },
              { status: 'ok', id: 'T2' }
            ]
          }
        },
        { status: 500, body: {} }
      ])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({
        ...base,
        tokens: [TOKEN_A, TOKEN_B, TOKEN_C]
      })
      /* Assert */
      expect(calls).toHaveLength(2)
      expect(messagesOf(calls[1]).map((m) => m.to)).toEqual([TOKEN_A, TOKEN_B])
      expect(result.results.map((r) => r.messageId ?? r.reason)).toEqual([
        'T1',
        'T2',
        'token_invalid'
      ])
    })

    it('reports a group the service then fails, without losing the other', async () => {
      /* Arrange */
      const { fetch } = scripted([
        mixed({ one: [TOKEN_A], two: [TOKEN_B], odd: 'not-a-list' }),
        { body: { data: [{ status: 'ok', id: 'T1' }] } },
        { throws: new Error('reset') }
      ])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).send({
        ...base,
        tokens: [TOKEN_A, TOKEN_B]
      })
      /* Assert */
      expect(result.results[0]?.messageId).toBe('T1')
      expect(result.results[1]).toEqual({
        token: TOKEN_B,
        reason: 'provider_unavailable',
        retryable: false
      })
    })

    it('throws, since nothing was sent, when the details name none of the tokens', async () => {
      /* Arrange */
      const { fetch, calls } = scripted([mixed('nope')])
      /* Act */
      const failure = await failureOf(
        new ExpoPushProvider({ fetch }).send({ ...base, tokens: [TOKEN_A] })
      )
      /* Assert */
      expect(failure.message).toContain('the push was not sent')
      expect(calls).toHaveLength(1)
    })
  })

  describe('fetchReceipts', () => {
    it('answers per ticket id, with pending for an id the service omitted', async () => {
      /* Arrange */
      const { fetch, calls } = scripted([
        {
          body: {
            data: {
              A: { status: 'ok' },
              B: { status: 'error', message: 'text', details: { error: 'DeviceNotRegistered' } }
            }
          }
        }
      ])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).fetchReceipts(['A', 'B', 'C'])
      /* Assert */
      expect(calls[0]?.url).toBe(EXPO_RECEIPTS_URL)
      expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ ids: ['A', 'B', 'C'] })
      expect(result).toEqual([
        { ticketId: 'A', status: 'ok' },
        { ticketId: 'B', status: 'error', reason: 'token_unregistered', retryable: false },
        { ticketId: 'C', status: 'pending' }
      ])
    })

    it('does not read an inherited name as a receipt', async () => {
      /* Arrange */
      const { fetch } = scripted([{ body: { data: {} } }])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).fetchReceipts(['constructor'])
      /* Assert */
      expect(result).toEqual([{ ticketId: 'constructor', status: 'pending' }])
    })

    it('reads a body with no data as all pending', async () => {
      /* Arrange */
      const { fetch } = scripted([{ body: {} }])
      /* Act */
      const result = await new ExpoPushProvider({ fetch }).fetchReceipts(['A'])
      /* Assert */
      expect(result).toEqual([{ ticketId: 'A', status: 'pending' }])
    })

    it('reads 1000 ids in one call and refuses 1001', async () => {
      /* Arrange */
      const ids = Array.from({ length: 1001 }, (_, i) => `id${String(i)}`)
      const { fetch, calls } = scripted([{ body: { data: {} } }])
      const provider = new ExpoPushProvider({ fetch })
      /* Act */
      const read = await provider.fetchReceipts(ids.slice(0, 1000))
      /* Assert */
      expect(read).toHaveLength(1000)
      expect(calls).toHaveLength(1)
      await expect(provider.fetchReceipts(ids)).rejects.toMatchObject({
        code: 'notification.invalid_scope_identifier'
      })
    })

    it('throws only when no chunk was read', async () => {
      /* Arrange */
      const { fetch } = scripted([{ status: 429, body: {} }])
      /* Act */
      const failure = await failureOf(new ExpoPushProvider({ fetch }).fetchReceipts(['A']))
      /* Assert */
      expect(failure.message).toContain('(rate_limited)')
    })

    it.each([[[]], [['']], [[5]], ['x\u0000']])('refuses ticket ids %j', async (ids) => {
      /* Act / Assert */
      await expect(
        new ExpoPushProvider({ fetch: scripted([]).fetch }).fetchReceipts(ids as string[])
      ).rejects.toThrow()
    })
  })

  describe('input', () => {
    it.each([
      [{ tokens: [], title: 't', body: 'b' }],
      [{ tokens: TOKEN_A, title: 5, body: 'b' }],
      [{ tokens: TOKEN_A, title: 't', body: 'b', data: [] }],
      [{ tokens: TOKEN_A, title: 't', body: 'b', data: { k: 1 } }],
      [{ tokens: TOKEN_A, title: 't', body: 'b', badge: -1 }],
      [{ tokens: TOKEN_A, title: 't', body: 'b', mutableContent: 'yes' }],
      [{ tokens: TOKEN_A, title: 't', body: 'b', priority: 'urgent' }],
      [null]
    ])('refuses a bad push %#', async (options) => {
      /* Arrange */
      const { fetch, calls } = scripted([])
      /* Act / Assert */
      await expect(new ExpoPushProvider({ fetch }).send(options as never)).rejects.toThrow()
      expect(calls).toHaveLength(0)
    })

    it('builds the payload from its own copy, so a key planted on the realm root is not sent', async () => {
      /* Arrange */
      Object.defineProperty(Object.prototype, 'sound', { value: 'planted', configurable: true })
      const { fetch, calls } = scripted([{ body: { data: [{ status: 'ok', id: 'T1' }] } }])
      let refused: unknown
      try {
        /* Act */
        await new ExpoPushProvider({ fetch }).send({ ...base, tokens: TOKEN_A })
      } catch (error) {
        refused = error
      } finally {
        Reflect.deleteProperty(Object.prototype, 'sound')
      }
      /* Assert: the library refuses a changed realm root, and what went out never held the planted field */
      expect(refused).toMatchObject({ code: 'notification.invalid_scope_identifier' })
      expect(calls.every((call) => !String(call.init.body).includes('planted'))).toBe(true)
    })
  })
})
