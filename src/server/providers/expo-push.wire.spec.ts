/**
 * @fileoverview Pins what the Expo adapter puts on the wire and what it says about a failure, as literals.
 * @layer infrastructure
 */

import { ExpoPushProvider } from './expo-push.provider'
import type { ExpoFetch } from './expo-push.client'

const TOKEN = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]'

interface Call {
  url: string
  init: RequestInit
}

/** A fetch that answers every call with one status and body, and records what it was asked. */
function answering(status: number, body: unknown): { fetch: ExpoFetch; calls: Call[] } {
  const calls: Call[] = []
  const fetch: ExpoFetch = (url, init) => {
    calls.push({ url, init })
    return Promise.resolve(new Response(JSON.stringify(body), { status }))
  }
  return { fetch, calls }
}

describe('the Expo adapter on the wire', () => {
  it('should post the exact body to the send endpoint with the fixed headers', async () => {
    const { fetch, calls } = answering(200, { data: [{ status: 'ok', id: 'T1' }] })

    await new ExpoPushProvider({ fetch }).send({ tokens: [TOKEN], title: 't', body: 'b' })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://exp.host/--/api/v2/push/send')
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.headers).toStrictEqual({
      'content-type': 'application/json',
      accept: 'application/json'
    })
    expect(calls[0]?.init.body).toBe(JSON.stringify([{ to: TOKEN, title: 't', body: 'b' }]))
  })

  it('should send every set field under its Expo name and none that was left out', async () => {
    const { fetch, calls } = answering(200, { data: [{ status: 'ok', id: 'T1' }] })

    await new ExpoPushProvider({ fetch }).send({
      tokens: [TOKEN],
      title: 't',
      body: 'b',
      data: { k: 'v' },
      sound: 's',
      badge: 0,
      ttlSeconds: 0,
      priority: 'high',
      channelId: 'c',
      subtitle: 'u',
      categoryId: 'k',
      mutableContent: false,
      contentAvailable: false,
      imageUrl: 'https://x.test/i.png'
    })

    expect(JSON.parse(String(calls[0]?.init.body))).toStrictEqual([
      {
        to: TOKEN,
        title: 't',
        body: 'b',
        data: { k: 'v' },
        sound: 's',
        badge: 0,
        ttl: 0,
        priority: 'high',
        channelId: 'c',
        subtitle: 'u',
        categoryId: 'k',
        mutableContent: false,
        _contentAvailable: false,
        richContent: { image: 'https://x.test/i.png' }
      }
    ])
  })

  it('should carry the access token as a bearer header and nowhere else', async () => {
    const { fetch, calls } = answering(200, { data: [{ status: 'ok', id: 'T1' }] })

    await new ExpoPushProvider({ fetch, accessToken: 'SECRET' }).send({
      tokens: [TOKEN],
      title: 't',
      body: 'b'
    })

    expect(calls[0]?.init.headers).toStrictEqual({
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: 'Bearer SECRET'
    })
    expect(String(calls[0]?.init.body)).not.toContain('SECRET')
  })

  it('should post a receipts call to the receipts endpoint', async () => {
    const { fetch, calls } = answering(200, { data: { R1: { status: 'ok' } } })

    await new ExpoPushProvider({ fetch }).fetchReceipts(['R1'])

    expect(calls[0]?.url).toBe('https://exp.host/--/api/v2/push/getReceipts')
    expect(calls[0]?.init.method).toBe('POST')
    expect(calls[0]?.init.body).toBe(JSON.stringify({ ids: ['R1'] }))
  })

  it.each([401, 403])('should read a %i as rejected credentials, not retryable', async (status) => {
    const { fetch } = answering(status, {})
    const provider = new ExpoPushProvider({ fetch })

    await expect(provider.send({ tokens: [TOKEN], title: 't', body: 'b' })).rejects.toMatchObject({
      name: 'ExpoPushError',
      message: 'ExpoPushProvider: the push was not sent (credentials)'
    })
  })

  it.each([
    ['an id that is empty', { status: 'ok', id: '' }],
    ['an id that is not text', { status: 'ok', id: 7 }],
    ['a status that is neither', { status: 'pending', id: 'T1' }]
  ])('should not call a ticket with %s accepted', async (_label, ticket) => {
    const { fetch } = answering(200, { data: [ticket] })

    const result = await new ExpoPushProvider({ fetch }).send({
      tokens: [TOKEN],
      title: 't',
      body: 'b'
    })

    expect(result.results).toStrictEqual([
      { token: TOKEN, reason: 'provider_unavailable', retryable: false }
    ])
  })

  it('should answer a malformed token as invalid and not retryable, without a call', async () => {
    const { fetch, calls } = answering(200, { data: [] })

    const result = await new ExpoPushProvider({ fetch }).send({
      tokens: ['nope'],
      title: 't',
      body: 'b'
    })

    expect(calls).toHaveLength(0)
    expect(result.results).toStrictEqual([
      { token: 'nope', reason: 'token_invalid', retryable: false }
    ])
  })

  it('should not regroup a refusal whose code is not the mixed-projects one', async () => {
    const { fetch, calls } = answering(400, {
      errors: [{ code: 'OTHER', message: 'x', details: { '@a/one': [TOKEN] } }]
    })

    await expect(
      new ExpoPushProvider({ fetch }).send({ tokens: [TOKEN], title: 't', body: 'b' })
    ).rejects.toMatchObject({ name: 'ExpoPushError' })
    expect(calls).toHaveLength(1)
  })

  it('should answer a token the project grouping does not place as invalid and not retryable', async () => {
    const other = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]'
    let step = 0
    const fetch: ExpoFetch = () => {
      step += 1
      const body =
        step === 1
          ? {
              errors: [
                {
                  code: 'PUSH_TOO_MANY_EXPERIENCE_IDS',
                  message: 'x',
                  details: { '@a/one': [TOKEN] }
                }
              ]
            }
          : { data: [{ status: 'ok', id: 'T1' }] }
      return Promise.resolve(new Response(JSON.stringify(body), { status: step === 1 ? 400 : 200 }))
    }

    const result = await new ExpoPushProvider({ fetch }).send({
      tokens: [TOKEN, other],
      title: 't',
      body: 'b'
    })

    expect(result.results).toStrictEqual([
      { token: TOKEN, messageId: 'T1' },
      { token: other, reason: 'token_invalid', retryable: false }
    ])
  })

  it('should name the provider when it refuses ticket ids', async () => {
    const { fetch } = answering(200, {})
    let thrown: unknown
    try {
      await new ExpoPushProvider({ fetch }).fetchReceipts([])
    } catch (error) {
      thrown = error
    }

    expect(
      (thrown as { getResponse(): { error: { details: unknown } } }).getResponse().error.details
    ).toEqual({
      boundary: 'ExpoPushProvider',
      parameter: 'ticketIds',
      reason: 'needs at least one entry'
    })
  })
})
