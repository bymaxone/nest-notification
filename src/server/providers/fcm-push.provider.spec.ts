/**
 * @fileoverview Behavior of the FCM adapter against a scripted `fetch`: options, token exchange,
 * requests, background pushes and how every answer is classified.
 * @layer infrastructure
 */

import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'

import { NotificationException } from '../errors/notification-exception'
import type { PushSendOptions } from '../interfaces/push-provider.interface'
import { GOOGLE_TOKEN_URL } from './fcm-push.client'
import type { FcmFetch } from './fcm-push.client'
import { FcmPushProvider } from './fcm-push.provider'
import type { FcmPushProviderOptions } from './fcm-push.provider'

const KEYS = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})
const SEND_URL = 'https://fcm.googleapis.com/v1/projects/demo-project/messages:send'
const ACCESS = 'access-token-SECRET'
const credentials = {
  projectId: 'demo-project',
  clientEmail: 'push@demo-project.iam.gserviceaccount.com',
  privateKey: KEYS.privateKey
}
const base = { title: 't', body: 'b' }

type Step = { status?: number; body?: unknown; text?: string; throws?: unknown }

interface Call {
  url: string
  init: RequestInit
}

interface Script {
  fetch: FcmFetch
  calls: Call[]
  sends: () => Array<{ message: Record<string, unknown> & { token: string } }>
  exchanges: () => Call[]
}

const granted = (token = ACCESS, seconds: unknown = 3600): Step => ({
  body: { access_token: token, expires_in: seconds }
})
const accepted: Step = { body: { name: 'projects/demo-project/messages/1' } }

/** An FCM error envelope. */
function fcmError(
  status: number,
  errorCode?: string,
  extra: { violation?: string; grpc?: string } = {}
): Step {
  const details: unknown[] = []
  if (errorCode !== undefined) {
    details.push({ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode })
  }
  if (extra.violation !== undefined) {
    details.push({
      '@type': 'type.googleapis.com/google.rpc.BadRequest',
      fieldViolations: [{ field: extra.violation, description: 'SECRET provider words' }]
    })
  }
  return {
    status,
    body: { error: { status: extra.grpc ?? 'X', message: 'SECRET provider words', details } }
  }
}

/** A fetch that answers the exchange and the sends from two scripts and records every call. */
function scripted(sendSteps: Step[] = [], grantSteps: Step[] = []): Script {
  const calls: Call[] = []
  const fetch: FcmFetch = (url, init) => {
    calls.push({ url, init })
    const exchange = url === GOOGLE_TOKEN_URL
    const step = (exchange ? grantSteps : sendSteps).shift() ?? (exchange ? granted() : accepted)
    if (step.throws !== undefined) {
      return Promise.reject(step.throws)
    }
    const text = step.text ?? JSON.stringify(step.body ?? {})
    return Promise.resolve(new Response(text, { status: step.status ?? 200 }))
  }
  return {
    fetch,
    calls,
    sends: () =>
      calls.filter((c) => c.url !== GOOGLE_TOKEN_URL).map((c) => JSON.parse(String(c.init.body))),
    exchanges: () => calls.filter((c) => c.url === GOOGLE_TOKEN_URL)
  }
}

function providerWith(
  script: Script,
  extra: Partial<FcmPushProviderOptions> = {}
): FcmPushProvider {
  return new FcmPushProvider({ ...credentials, fetch: script.fetch, ...extra })
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

/** The response body of a library exception. */
function responseOf(error: object): string {
  if (!(error instanceof NotificationException)) {
    throw new Error('expected a NotificationException')
  }
  return JSON.stringify(error.getResponse())
}

const refusedConnection = Object.assign(new Error('x'), { cause: { code: 'ECONNREFUSED' } })
const timedOut = Object.assign(new Error('x'), { name: 'TimeoutError' })

describe('FcmPushProvider', () => {
  describe('options', () => {
    it('is named fcm and configured', () => {
      /* Act */
      const provider = new FcmPushProvider(credentials)
      /* Assert */
      expect(provider.name).toBe('fcm')
      expect(provider.isConfigured()).toBe(true)
    })

    it.each<[object, string]>([
      [{ projectId: undefined }, 'projectId'],
      [{ projectId: '' }, 'projectId'],
      [{ projectId: 'a/b' }, 'projectId'],
      [{ projectId: '..' }, 'projectId'],
      [{ projectId: 'a?x' }, 'projectId'],
      [{ projectId: `a${'b'.repeat(127)}` }, 'projectId'],
      [{ clientEmail: undefined }, 'clientEmail'],
      [{ clientEmail: 'no-at-sign' }, 'clientEmail'],
      [{ clientEmail: 'a@b@c' }, 'clientEmail'],
      [{ clientEmail: 'a b@c' }, 'clientEmail'],
      [{ privateKey: undefined }, 'privateKey'],
      [{ privateKey: 5 }, 'privateKey'],
      [{ privateKey: 'not a key SECRET' }, 'privateKey'],
      [{ privateKey: KEYS.publicKey }, 'privateKey'],
      [
        {
          privateKey: generateKeyPairSync('ec', {
            namedCurve: 'P-256',
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' }
          }).privateKey
        },
        'privateKey'
      ],
      [{ concurrency: 0 }, 'concurrency'],
      [{ concurrency: 501 }, 'concurrency'],
      [{ concurrency: 1.5 }, 'concurrency'],
      [{ timeoutMs: 0 }, 'timeoutMs'],
      [{ fetch: 'x' }, 'fetch must be a function']
    ])('refuses a bad option %#', (bad, message) => {
      /* Act */
      const build = (): FcmPushProvider => new FcmPushProvider({ ...credentials, ...bad })
      /* Assert */
      expect(build).toThrow(`FcmPushProvider: ${message}`)
      expect(build).not.toThrow('SECRET')
      expect(build).not.toThrow('BEGIN')
    })

    it.each([1, 500])('takes a concurrency of %d', (concurrency) => {
      /* Act / Assert */
      expect(() => new FcmPushProvider({ ...credentials, concurrency })).not.toThrow()
    })

    it('takes a domain-scoped project id', () => {
      /* Act / Assert */
      expect(
        () => new FcmPushProvider({ ...credentials, projectId: 'example.com:app' })
      ).not.toThrow()
    })

    it('refuses options that are not an object', () => {
      /* Act / Assert */
      expect(() => new FcmPushProvider(null as never)).toThrow('options must be an object')
    })

    it('calls the global fetch when none is injected', async () => {
      /* Arrange */
      const script = scripted()
      const spy = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(((url: string, init) =>
          script.fetch(url, init as RequestInit)) as typeof fetch)
      /* Act */
      const result = await new FcmPushProvider(credentials).send({ ...base, tokens: 'a' })
      spy.mockRestore()
      /* Assert */
      expect(result.results[0]?.messageId).toBe('projects/demo-project/messages/1')
    })
  })

  describe('access token', () => {
    beforeEach(() => jest.useFakeTimers({ now: 1_000_000_500, doNotFake: ['nextTick'] }))
    afterEach(() => jest.useRealTimers())

    it('exchanges an RS256 assertion at the fixed endpoint', async () => {
      /* Arrange */
      const script = scripted()
      /* Act */
      await providerWith(script).send({ ...base, tokens: 'a' })
      /* Assert */
      const [exchange] = script.exchanges()
      expect(exchange?.init.method).toBe('POST')
      expect(exchange?.init.redirect).toBe('error')
      expect(exchange?.init.signal).toBeInstanceOf(AbortSignal)
      expect(exchange?.init.headers).toEqual({
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      })
      const form = new URLSearchParams(String(exchange?.init.body))
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
      const [header, claims, signature] = String(form.get('assertion')).split('.')
      const read = (part = ''): unknown => JSON.parse(Buffer.from(part, 'base64url').toString())
      expect(read(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
      expect(read(claims)).toEqual({
        iss: credentials.clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: GOOGLE_TOKEN_URL,
        iat: 1_000_000,
        exp: 1_003_600
      })
      expect(
        verify(
          'sha256',
          Buffer.from(`${header}.${claims}`),
          createPublicKey(KEYS.publicKey),
          Buffer.from(String(signature), 'base64url')
        )
      ).toBe(true)
    })

    it('reuses a token until five minutes before its end', async () => {
      /* Arrange */
      const script = scripted([], [granted('one'), granted('two')])
      const provider = providerWith(script)
      /* Act */
      await provider.send({ ...base, tokens: 'a' })
      jest.advanceTimersByTime(3_299_999)
      await provider.send({ ...base, tokens: 'a' })
      const before = script.exchanges().length
      jest.advanceTimersByTime(1)
      await provider.send({ ...base, tokens: 'a' })
      /* Assert */
      expect(before).toBe(1)
      expect(script.exchanges()).toHaveLength(2)
    })

    it.each([300, null, '3600'])('does not cache a token with expires_in %p', async (life) => {
      /* Arrange */
      const script = scripted([], [granted('one', life), granted('two', life)])
      const provider = providerWith(script)
      /* Act */
      await provider.send({ ...base, tokens: 'a' })
      await provider.send({ ...base, tokens: 'a' })
      /* Assert */
      expect(script.exchanges()).toHaveLength(2)
    })

    it('shares one exchange between the requests of two sends', async () => {
      /* Arrange */
      const script = scripted()
      const provider = providerWith(script)
      /* Act */
      await Promise.all([
        provider.send({ ...base, tokens: ['a', 'b'] }),
        provider.send({ ...base, tokens: ['c'] })
      ])
      /* Assert */
      expect(script.exchanges()).toHaveLength(1)
      expect(script.sends()).toHaveLength(3)
    })

    it.each<[Step, string, string | undefined]>([
      [{ status: 400, body: { error: 'invalid_grant' } }, 'credentials', undefined],
      [{ status: 401 }, 'credentials', undefined],
      [{ status: 429 }, 'rate_limited', 'EUNAVAILABLE'],
      [{ status: 500 }, 'provider_unavailable', 'EUNAVAILABLE'],
      [{ status: 200, text: 'not json' }, 'provider_unavailable', 'EUNAVAILABLE'],
      [{ body: { access_token: 'has space' } }, 'provider_unavailable', 'EUNAVAILABLE'],
      [{ body: { access_token: 7 } }, 'provider_unavailable', 'EUNAVAILABLE'],
      [{ throws: timedOut }, 'provider_unavailable', 'EUNAVAILABLE']
    ])('throws when the exchange fails %#, having asked once', async (step, reason, code) => {
      /* Arrange */
      const script = scripted([], [step])
      /* Act */
      const error = await failureOf(
        providerWith(script, { concurrency: 1 }).send({ ...base, tokens: ['a', 'b', 'c'] })
      )
      /* Assert */
      expect(error.name).toBe('FcmPushError')
      expect(error.message).toBe(`FcmPushProvider: the push was not sent (${reason})`)
      expect(error.code).toBe(code)
      expect(script.exchanges()).toHaveLength(1)
      expect(script.sends()).toHaveLength(0)
    })

    it('asks again on the send after a failed exchange', async () => {
      /* Arrange */
      const script = scripted([], [{ status: 500 }])
      const provider = providerWith(script)
      await failureOf(provider.send({ ...base, tokens: 'a' }))
      /* Act */
      const result = await provider.send({ ...base, tokens: 'a' })
      /* Assert */
      expect(result.results[0]?.messageId).toBeDefined()
      expect(script.exchanges()).toHaveLength(2)
    })

    it('replaces a token refused with 401 and sends once more', async () => {
      /* Arrange */
      const script = scripted([fcmError(401)], [granted('old'), granted('new')])
      /* Act */
      const result = await providerWith(script).send({ ...base, tokens: 'a' })
      /* Assert */
      expect(result.results[0]?.messageId).toBeDefined()
      const used = script.calls
        .filter((c) => c.url === SEND_URL)
        .map((c) => (c.init.headers as Record<string, string>).authorization)
      expect(used).toEqual(['Bearer old', 'Bearer new'])
    })

    it('keeps a newer token when a late 401 names the old one', async () => {
      /* Arrange */
      const script = scripted(
        [fcmError(401), fcmError(401)],
        [granted('old'), granted('new'), granted('third')]
      )
      /* Act */
      await providerWith(script).send({ ...base, tokens: ['a', 'b'] })
      /* Assert */
      expect(script.exchanges()).toHaveLength(2)
      expect(script.sends()).toHaveLength(4)
    })

    it('throws credentials after a second 401, having sent twice', async () => {
      /* Arrange */
      const script = scripted([fcmError(401), fcmError(401)])
      /* Act */
      const error = await failureOf(providerWith(script).send({ ...base, tokens: 'a' }))
      /* Assert */
      expect(error.message).toContain('(credentials)')
      expect(error.code).toBeUndefined()
      expect(script.sends()).toHaveLength(2)
    })

    it('does not resend a 401 that is about the APNs key', async () => {
      /* Arrange */
      const script = scripted([fcmError(401, 'THIRD_PARTY_AUTH_ERROR')])
      /* Act */
      const result = await providerWith(script).send({ ...base, tokens: 'a' })
      /* Assert */
      expect(result.results).toEqual([{ token: 'a', reason: 'credentials', retryable: false }])
      expect(script.sends()).toHaveLength(1)
    })
  })

  describe('request', () => {
    beforeEach(() => jest.useFakeTimers({ now: 2_000_000_000, doNotFake: ['nextTick'] }))
    afterEach(() => jest.useRealTimers())

    /** Sends one push to one token and hands back the `message` of the request. */
    async function messageOf(options: Omit<PushSendOptions, 'tokens'>): Promise<unknown> {
      const script = scripted()
      await providerWith(script).send({ ...options, tokens: 'a' })
      return script.sends()[0]?.message
    }

    it('posts to the project with the bearer token and redirects refused', async () => {
      /* Arrange */
      const script = scripted()
      /* Act */
      await providerWith(script).send({ ...base, tokens: 'a' })
      /* Assert */
      const send = script.calls.find((c) => c.url !== GOOGLE_TOKEN_URL)
      expect(send?.url).toBe(SEND_URL)
      expect(send?.init.method).toBe('POST')
      expect(send?.init.redirect).toBe('error')
      expect(send?.init.signal).toBeInstanceOf(AbortSignal)
      expect(send?.init.headers).toEqual({
        authorization: `Bearer ${ACCESS}`,
        'content-type': 'application/json',
        accept: 'application/json'
      })
    })

    it('carries only the token and the notification of a plain push', async () => {
      /* Act / Assert */
      expect(await messageOf(base)).toStrictEqual({
        token: 'a',
        notification: { title: 't', body: 'b' }
      })
    })

    it('maps every field', async () => {
      /* Act */
      const message = await messageOf({
        ...base,
        data: { k: 'v' },
        imageUrl: 'https://example.com/i.png',
        sound: 'default',
        badge: 3,
        ttlSeconds: 60,
        priority: 'high',
        channelId: 'news',
        subtitle: 's',
        categoryId: 'c',
        collapseKey: 'k1',
        threadId: 'th',
        mutableContent: true,
        contentAvailable: false
      })
      /* Assert */
      expect(message).toStrictEqual({
        token: 'a',
        notification: { title: 't', body: 'b', image: 'https://example.com/i.png' },
        data: { k: 'v' },
        android: {
          priority: 'HIGH',
          ttl: '60s',
          collapse_key: 'k1',
          notification: { channel_id: 'news', sound: 'default' }
        },
        apns: {
          headers: { 'apns-priority': '10', 'apns-expiration': '2000060' },
          payload: {
            aps: {
              alert: { title: 't', subtitle: 's', body: 'b' },
              sound: 'default',
              badge: 3,
              category: 'c',
              'thread-id': 'th',
              'mutable-content': 1
            }
          }
        }
      })
    })

    it('maps normal priority and a ttl of zero', async () => {
      /* Act / Assert */
      expect(await messageOf({ ...base, priority: 'normal', ttlSeconds: 0 })).toMatchObject({
        android: { priority: 'NORMAL', ttl: '0s' },
        apns: { headers: { 'apns-priority': '5', 'apns-expiration': '0' } }
      })
    })

    it('leaves the empty title and body out of a data message', async () => {
      /* Act / Assert */
      expect(
        await messageOf({ title: '', body: '', data: { k: 'v' }, mutableContent: false })
      ).toStrictEqual({ token: 'a', data: { k: 'v' } })
    })

    it('leaves an empty title out of an alert with a subtitle', async () => {
      /* Act */
      const message = await messageOf({ title: '', body: 'b', subtitle: 's' })
      /* Assert */
      expect(message).toStrictEqual({
        token: 'a',
        notification: { body: 'b' },
        apns: { payload: { aps: { alert: { subtitle: 's', body: 'b' } } } }
      })
    })

    it('sends contentAvailable as a background push of priority 5', async () => {
      /* Act */
      const message = await messageOf({
        title: '',
        body: '',
        data: { k: 'v' },
        priority: 'high',
        contentAvailable: true,
        mutableContent: false
      })
      /* Assert */
      expect(message).toStrictEqual({
        token: 'a',
        data: { k: 'v' },
        android: { priority: 'HIGH' },
        apns: {
          headers: { 'apns-push-type': 'background', 'apns-priority': '5' },
          payload: { aps: { 'content-available': 1 } }
        }
      })
    })

    it.each<[Partial<PushSendOptions>]>([
      [{ title: 't' }],
      [{ body: 'b' }],
      [{ subtitle: '' }],
      [{ imageUrl: 'u' }],
      [{ sound: 'default' }],
      [{ badge: 0 }],
      [{ channelId: 'c' }],
      [{ categoryId: 'c' }],
      [{ threadId: 't' }],
      [{ mutableContent: true }]
    ])('refuses contentAvailable with %p, before any call', async (extra) => {
      /* Arrange */
      const script = scripted()
      /* Act */
      const error = await failureOf(
        providerWith(script).send({
          tokens: 'a',
          title: '',
          body: '',
          contentAvailable: true,
          ...extra
        })
      )
      /* Assert */
      expect(error).toMatchObject({ code: 'notification.invalid_scope_identifier' })
      expect(JSON.stringify(responseOf(error))).toContain('is a background push')
      expect(script.calls).toHaveLength(0)
    })

    it('answers message_too_big for every token of a payload over 4096 bytes', async () => {
      /* Arrange */
      const script = scripted()
      const provider = providerWith(script)
      const overhead = Buffer.byteLength(JSON.stringify({ data: { k: '' } }))
      /* Act */
      const fits = await provider.send({
        title: '',
        body: '',
        data: { k: 'x'.repeat(4096 - overhead) },
        tokens: 'a'
      })
      const over = await provider.send({
        title: '',
        body: '',
        data: { k: 'x'.repeat(4097 - overhead) },
        tokens: ['a', 'b', '']
      })
      /* Assert */
      expect(fits.results[0]?.messageId).toBeDefined()
      expect(over.results).toEqual([
        { token: 'a', reason: 'message_too_big', retryable: false },
        { token: 'b', reason: 'message_too_big', retryable: false },
        { token: '', reason: 'token_invalid', retryable: false }
      ])
      expect(script.sends()).toHaveLength(1)
    })
  })

  describe('results', () => {
    it('answers each place a token appears, sending it once', async () => {
      /* Arrange */
      const script = scripted([accepted, fcmError(404, 'UNREGISTERED')])
      /* Act */
      const result = await providerWith(script, { concurrency: 1 }).send({
        ...base,
        tokens: ['a', 'b', 'a', 'bad\n']
      })
      /* Assert */
      expect(result.results).toEqual([
        { token: 'a', messageId: 'projects/demo-project/messages/1' },
        { token: 'b', reason: 'token_unregistered', retryable: false },
        { token: 'a', messageId: 'projects/demo-project/messages/1' },
        { token: 'bad\n', reason: 'token_invalid', retryable: false }
      ])
      expect(script.sends().map((s) => s.message.token)).toEqual(['a', 'b'])
    })

    it('makes no call when no token is usable', async () => {
      /* Arrange */
      const script = scripted()
      /* Act */
      const result = await providerWith(script).send({ ...base, tokens: '' })
      /* Assert */
      expect(result.results).toEqual([{ token: '', reason: 'token_invalid', retryable: false }])
      expect(script.calls).toHaveLength(0)
    })

    it.each([
      [1, 1],
      [3, 3],
      [20, 7]
    ])('keeps at most %d requests in flight', async (concurrency, peak) => {
      /* Arrange */
      let live = 0
      let most = 0
      const script = scripted()
      const fetch: FcmFetch = async (url, init) => {
        if (url !== GOOGLE_TOKEN_URL) {
          live += 1
          most = Math.max(most, live)
          await new Promise((resolve) => setImmediate(resolve))
          live -= 1
        }
        return script.fetch(url, init)
      }
      const tokens = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
      /* Act */
      const result = await new FcmPushProvider({ ...credentials, fetch, concurrency }).send({
        ...base,
        tokens
      })
      /* Assert */
      expect(most).toBe(peak)
      expect(result.results.map((r) => r.token)).toEqual(tokens)
      expect(script.sends()).toHaveLength(7)
    })

    it.each<[Step, string, boolean]>([
      [fcmError(404, 'UNREGISTERED'), 'token_unregistered', false],
      [fcmError(404), 'unknown', false],
      [fcmError(400, 'UNREGISTERED'), 'unknown', false],
      [fcmError(403, 'SENDER_ID_MISMATCH'), 'token_invalid', false],
      [fcmError(400, 'INVALID_ARGUMENT', { violation: 'message.token' }), 'token_invalid', false],
      [fcmError(400, 'INVALID_ARGUMENT', { violation: 'message.data' }), 'unknown', false],
      [fcmError(400, 'INVALID_ARGUMENT'), 'unknown', false],
      [fcmError(429, 'QUOTA_EXCEEDED'), 'rate_limited', true],
      [{ status: 429 }, 'rate_limited', true],
      [fcmError(503, 'UNAVAILABLE'), 'provider_unavailable', true],
      [fcmError(500, 'INTERNAL'), 'provider_unavailable', true],
      [fcmError(503, undefined, { grpc: 'UNAVAILABLE' }), 'provider_unavailable', true],
      [fcmError(500, undefined, { grpc: 'INTERNAL' }), 'provider_unavailable', true],
      [fcmError(502), 'provider_unavailable', false],
      [{ status: 503, text: '<html>' }, 'provider_unavailable', false],
      [{ status: 500 }, 'provider_unavailable', false],
      [fcmError(400, 'SOMETHING_NEW'), 'unknown', false],
      [{ status: 400, body: { error: { details: 'x' } } }, 'unknown', false],
      [{ status: 400, body: { error: { details: [{ errorCode: 5 }] } } }, 'unknown', false],
      [
        { status: 400, body: { error: { details: [{ fieldViolations: 'message.token' }] } } },
        'unknown',
        false
      ],
      [{ status: 200, body: {} }, 'provider_unavailable', false],
      [{ status: 200, body: { name: '' } }, 'provider_unavailable', false],
      [{ status: 200, text: 'x' }, 'provider_unavailable', false],
      [{ throws: timedOut }, 'provider_unavailable', false]
    ])('classifies answer %#, without throwing', async (step, reason, retryable) => {
      /* Arrange */
      const script = scripted([step])
      /* Act */
      const result = await providerWith(script).send({ ...base, tokens: 'a' })
      /* Assert */
      expect(result.results).toStrictEqual([{ token: 'a', reason, retryable }])
      expect(JSON.stringify(result)).not.toContain('SECRET')
      expect(script.sends()).toHaveLength(1)
    })

    it.each<[Step, string, string | undefined]>([
      [{ throws: refusedConnection }, 'provider_unavailable', 'EUNAVAILABLE'],
      [fcmError(403), 'credentials', undefined],
      [{ status: 403 }, 'credentials', undefined]
    ])('throws when no request was judged %#', async (step, reason, code) => {
      /* Arrange */
      const script = scripted([step, step])
      /* Act */
      const error = await failureOf(providerWith(script).send({ ...base, tokens: ['a', 'b'] }))
      /* Assert */
      expect(error.message).toBe(`FcmPushProvider: the push was not sent (${reason})`)
      expect(error.code).toBe(code)
    })

    it.each<[Step[]]>([
      [[accepted, { throws: refusedConnection }]],
      [[{ throws: refusedConnection }, accepted]]
    ])('answers per token when another request was judged %#', async (steps) => {
      /* Arrange */
      const script = scripted(steps)
      /* Act */
      const result = await providerWith(script, { concurrency: 1 }).send({
        ...base,
        tokens: ['a', 'b']
      })
      /* Assert */
      expect(result.results.filter((r) => r.messageId !== undefined)).toHaveLength(1)
      expect(result.results.filter((r) => r.retryable === true)).toHaveLength(1)
    })

    it('answers the rest when the token cannot be renewed mid-batch', async () => {
      /* Arrange */
      const script = scripted([accepted, fcmError(401)], [granted(), { status: 400 }])
      /* Act */
      const result = await providerWith(script, { concurrency: 1 }).send({
        ...base,
        tokens: ['a', 'b', 'c']
      })
      /* Assert */
      expect(result.results.map((r) => r.reason)).toEqual([undefined, 'credentials', 'credentials'])
      expect(script.exchanges()).toHaveLength(2)
      expect(script.sends()).toHaveLength(2)
    })
  })
})
