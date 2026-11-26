/**
 * @fileoverview The requests the APNs adapter builds, background pushes and how every answer is classified.
 * @layer infrastructure
 */

import { NotificationException } from '../errors/notification-exception'
import type { PushSendOptions } from '../interfaces/push-provider.interface'
import { ApnsPushProvider } from './apns-push.provider'
import {
  OTHER,
  THIRD,
  TOKEN,
  base,
  cleanup,
  credentials,
  failureOf,
  fake,
  providerOn,
  sendOne
} from './__tests__/apns-server.fixture'

describe('ApnsPushProvider messages', () => {
  afterEach(cleanup)

  describe('request', () => {
    it('posts the alert to the device path with the topic and push type, and nothing unset', async () => {
      /* Arrange */
      const server = await fake()
      /* Act */
      const request = await sendOne(server)
      /* Assert */
      expect(request.headers[':method']).toBe('POST')
      expect(request.headers[':path']).toBe(`/3/device/${TOKEN}`)
      expect(request.headers['apns-topic']).toBe('com.example.app')
      expect(request.headers['apns-push-type']).toBe('alert')
      expect(request.headers['apns-priority']).toBeUndefined()
      expect(request.headers['apns-expiration']).toBeUndefined()
      expect(request.headers['apns-collapse-id']).toBeUndefined()
      expect(JSON.parse(request.body)).toEqual({ aps: { alert: { title: 't', body: 'b' } } })
    })

    it('puts every field where APNs reads it, with data beside aps', async () => {
      /* Arrange */
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000)
      const server = await fake()
      /* Act */
      const request = await sendOne(server, {
        subtitle: 's',
        sound: 'default',
        badge: 0,
        categoryId: 'c',
        threadId: 'th',
        mutableContent: true,
        collapseKey: 'k',
        priority: 'high',
        ttlSeconds: 60,
        data: { route: 'plan' },
        channelId: 'ignored',
        imageUrl: 'https://example.com/i.png'
      })
      /* Assert */
      expect(JSON.parse(request.body)).toEqual({
        route: 'plan',
        aps: {
          alert: { title: 't', subtitle: 's', body: 'b' },
          sound: 'default',
          badge: 0,
          category: 'c',
          'thread-id': 'th',
          'mutable-content': 1
        }
      })
      expect(request.headers['apns-collapse-id']).toBe('k')
      expect(request.headers['apns-priority']).toBe('10')
      expect(request.headers['apns-expiration']).toBe('1060')
    })

    it.each<[Partial<PushSendOptions>, string, string]>([
      [{ priority: 'normal', ttlSeconds: 0 }, '5', '0']
    ])('sends normal priority and a one-try expiry', async (options, priority, expiration) => {
      /* Arrange */
      const server = await fake()
      /* Act */
      const request = await sendOne(server, options)
      /* Assert */
      expect(request.headers['apns-priority']).toBe(priority)
      expect(request.headers['apns-expiration']).toBe(expiration)
    })

    it('leaves out an empty title or body, and the alert when both are empty', async () => {
      /* Arrange */
      const server = await fake()
      /* Act */
      const bodyOnly = await sendOne(server, { title: '' })
      const badgeOnly = await sendOne(server, {
        title: '',
        body: '',
        badge: 3,
        mutableContent: false
      })
      /* Assert */
      expect(JSON.parse(bodyOnly.body)).toEqual({ aps: { alert: { body: 'b' } } })
      expect(JSON.parse(badgeOnly.body)).toEqual({ aps: { badge: 3 } })
    })

    it('sends a background push as content-available at priority 5', async () => {
      /* Arrange */
      const server = await fake()
      /* Act */
      const request = await sendOne(server, {
        title: '',
        body: '',
        contentAvailable: true,
        priority: 'high',
        data: { sync: '1' }
      })
      /* Assert */
      expect(JSON.parse(request.body)).toEqual({ sync: '1', aps: { 'content-available': 1 } })
      expect(request.headers['apns-push-type']).toBe('background')
      expect(request.headers['apns-priority']).toBe('5')
    })

    it.each<[Partial<PushSendOptions>, string]>([
      [{ contentAvailable: true }, 'contentAvailable'],
      [{ contentAvailable: true, title: '', body: '', badge: 1 }, 'contentAvailable'],
      [{ collapseKey: 'k'.repeat(65) }, 'collapseKey'],
      [{ collapseKey: 'a\r\nb' }, 'collapseKey'],
      [{ collapseKey: 'é' }, 'collapseKey'],
      [{ collapseKey: '' }, 'collapseKey'],
      [{ data: { aps: 'x' } }, 'data'],
      [{ data: { aps: 'x' } }, "may not use the key 'aps', which APNs reserves"],
      [{ collapseKey: '' }, 'must be 1 to 64 printable ASCII characters']
    ])('refuses %# before any connection', async (options, told) => {
      /* Arrange */
      const server = await fake()
      /* Act */
      const error = await failureOf(providerOn(server).send({ ...base, tokens: TOKEN, ...options }))
      /* Assert */
      expect(error).toBeInstanceOf(NotificationException)
      const answered = JSON.stringify((error as unknown as NotificationException).getResponse())
      expect(answered).toContain('notification.invalid_scope_identifier')
      expect(answered).toContain(told)
      expect(server.authorities).toHaveLength(0)
    })

    it('takes a collapse key of 64 bytes', async () => {
      /* Arrange */
      const server = await fake()
      /* Act */
      const request = await sendOne(server, { collapseKey: 'k'.repeat(64) })
      /* Assert */
      expect(request.headers['apns-collapse-id']).toBe('k'.repeat(64))
    })

    it('sends a payload of 4096 bytes and answers one byte more without a call', async () => {
      /* Arrange */
      const server = await fake()
      const provider = providerOn(server)
      const padding = (body: string): PushSendOptions => ({
        tokens: TOKEN,
        title: '',
        body,
        data: { x: '' }
      })
      const framed = Buffer.byteLength(JSON.stringify({ x: '', aps: { alert: { body: 'é' } } }))
      const exact = `é${'a'.repeat(4096 - framed)}`
      /* Act */
      const sent = await provider.send(padding(exact))
      const refused = await provider.send(padding(`${exact}a`))
      /* Assert */
      expect(Buffer.byteLength(server.requests[0]?.body ?? '')).toBe(4096)
      expect(sent.results[0]?.messageId).toBe('id-ab')
      expect(refused.results).toEqual([
        { token: TOKEN, reason: 'message_too_big', retryable: false }
      ])
      expect(server.requests).toHaveLength(1)
    })

    it('answers a token that is not hex without putting it in a path, and sends a repeat once', async () => {
      /* Arrange */
      const server = await fake()
      const bad = ['', 'xyz', '../../x', `${TOKEN}?a`, 'a'.repeat(257)]
      /* Act */
      const result = await providerOn(server).send({
        ...base,
        tokens: [...bad, TOKEN, TOKEN, 'A'.repeat(256)]
      })
      /* Assert */
      expect(result.results.slice(0, 5)).toEqual(
        bad.map((token) => ({ token, reason: 'token_invalid', retryable: false }))
      )
      expect(result.results[5]).toEqual(result.results[6])
      expect(server.requests.map((r) => r.headers[':path'])).toEqual([
        `/3/device/${TOKEN}`,
        `/3/device/${'A'.repeat(256)}`
      ])
    })

    it('makes no connection when every token is refused locally', async () => {
      /* Arrange */
      const server = await fake()
      /* Act */
      const result = await providerOn(server).send({ ...base, tokens: 'zz' })
      /* Assert */
      expect(result.results[0]?.reason).toBe('token_invalid')
      expect(server.authorities).toHaveLength(0)
    })
  })

  describe('answers', () => {
    it.each<[number, string | undefined, string, boolean]>([
      [410, 'Unregistered', 'token_unregistered', false],
      [410, 'ExpiredToken', 'token_unregistered', false],
      [410, 'Other', 'unknown', false],
      [410, undefined, 'unknown', false],
      [400, 'Unregistered', 'unknown', false],
      [400, 'BadDeviceToken', 'token_invalid', false],
      [400, 'DeviceTokenNotForTopic', 'token_invalid', false],
      [400, 'BadTopic', 'unknown', false],
      [413, 'PayloadTooLarge', 'message_too_big', false],
      [413, undefined, 'message_too_big', false],
      [429, 'TooManyRequests', 'rate_limited', true],
      [500, 'InternalServerError', 'provider_unavailable', true],
      [503, 'ServiceUnavailable', 'provider_unavailable', true],
      [503, 'Shutdown', 'provider_unavailable', true],
      [500, undefined, 'provider_unavailable', false],
      [503, undefined, 'provider_unavailable', false],
      [502, 'Whatever', 'provider_unavailable', false],
      [404, 'BadPath', 'unknown', false]
    ])('reads %d %s', async (status, reason, expected, retryable) => {
      /* Arrange */
      const server = await fake()
      server.steps.push({ status, ...(reason === undefined ? {} : { reason }) })
      /* Act */
      const result = await providerOn(server).send({ ...base, tokens: TOKEN })
      /* Assert */
      expect(result.results).toEqual([{ token: TOKEN, reason: expected, retryable }])
    })

    it.each<[number, string, string, string | undefined]>([
      [403, 'InvalidProviderToken', 'credentials', undefined],
      [403, 'Forbidden', 'credentials', undefined],
      [400, 'TopicDisallowed', 'credentials', undefined],
      [429, 'TooManyProviderTokenUpdates', 'rate_limited', 'EUNAVAILABLE']
    ])('throws when %d %s refuses the account for all', async (status, reason, expected, code) => {
      /* Arrange */
      const server = await fake()
      server.steps.push({ status, reason })
      /* Act */
      const error = await failureOf(
        providerOn(server).send({ ...base, tokens: [TOKEN, OTHER, THIRD] })
      )
      /* Assert */
      expect(error.message).toBe(`ApnsPushProvider: the push was not sent (${expected})`)
      expect(error.name).toBe('ApnsPushError')
      expect(error.code).toBe(code)
      expect(server.requests).toHaveLength(1)
    })

    it('answers per token when the account is refused only after a token was judged', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push({ status: 200 }, { status: 403, reason: 'InvalidProviderToken' })
      /* Act */
      const result = await providerOn(server, { concurrency: 1 }).send({
        ...base,
        tokens: [TOKEN, OTHER, THIRD]
      })
      /* Assert */
      const credentialsRefused = { reason: 'credentials', retryable: false }
      expect(result.results).toEqual([
        { token: TOKEN, messageId: 'id-ab' },
        { token: OTHER, ...credentialsRefused },
        { token: THIRD, ...credentialsRefused }
      ])
      expect(server.requests).toHaveLength(2)
    })

    it.each([
      'not json',
      'x'.repeat(70_000),
      `{"reason":"Unregistered","pad":"${'x'.repeat(70_000)}"}`
    ])('reads the status alone when the body does not parse or is too long (%#)', async (text) => {
      /* Arrange */
      const server = await fake()
      server.steps.push({ status: 410, text })
      /* Act */
      const result = await providerOn(server).send({ ...base, tokens: TOKEN })
      /* Assert */
      expect(result.results).toEqual([{ token: TOKEN, reason: 'unknown', retryable: false }])
    })

    it.each(['{"reason":5}', '"Unregistered"', 'null'])(
      'reads no reason from the body %s',
      async (text) => {
        /* Arrange */
        const server = await fake()
        server.steps.push({ status: 410, text })
        /* Act */
        const result = await providerOn(server).send({ ...base, tokens: TOKEN })
        /* Assert */
        expect(result.results).toEqual([{ token: TOKEN, reason: 'unknown', retryable: false }])
      }
    )

    it('counts a 200 as accepted, with or without an apns-id', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push({ status: 200, apnsId: null })
      /* Act */
      const result = await providerOn(server).send({ ...base, tokens: TOKEN })
      /* Assert */
      expect(result.results).toEqual([{ token: TOKEN }])
    })

    it('keeps the token, the credentials and the words of APNs out of results and errors', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push({ status: 403, reason: 'SECRET words' })
      /* Act */
      const error = await failureOf(providerOn(server).send({ ...base, tokens: TOKEN }))
      /* Assert */
      const seen = `${error.message} ${JSON.stringify(error)}`
      expect(seen).not.toContain('SECRET')
      expect(seen).not.toContain(TOKEN)
    })
  })
})
