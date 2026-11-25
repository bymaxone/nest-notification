/**
 * @fileoverview Pins the exact boundaries of the Expo adapter: which error of an answer is read, the
 * bound handed to the timer, what an unparseable or empty 2xx means, the token shape and the access
 * token's characters.
 * @layer infrastructure
 */

import { callExpo, EXPO_SEND_URL } from './expo-push.client'
import type { ExpoFetch } from './expo-push.client'
import {
  OUTCOME_UNKNOWN,
  UNREACHABLE,
  classifyRequestFailure,
  isExpoPushToken
} from './expo-push.codes'
import { ExpoPushProvider } from './expo-push.provider'

const answering =
  (status: number, text: string): ExpoFetch =>
  () =>
    Promise.resolve(new Response(text, { status }))

const call = (fetch: ExpoFetch, timeoutMs = 1234) =>
  callExpo(EXPO_SEND_URL, [], { fetch, accessToken: undefined, timeoutMs, owner: 'T' })

describe('callExpo', () => {
  it('should read the first error of a refusal, not the last', async () => {
    const body = { errors: [{ code: 'TOO_MANY_REQUESTS' }, { code: 'UNAUTHORIZED' }] }

    const result = await call(answering(400, JSON.stringify(body)))

    expect(result).toMatchObject({ kind: 'failed', failure: { reason: 'rate_limited' } })
  })

  it('should bound the call by the timeout it was given', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout')

    await call(answering(200, '{}'), 4321)

    expect(spy).toHaveBeenCalledWith(4321)
    spy.mockRestore()
  })

  it('should read a 2xx that does not parse as an unknown outcome', async () => {
    expect(await call(answering(200, 'not json'))).toStrictEqual({
      kind: 'failed',
      failure: OUTCOME_UNKNOWN
    })
  })

  it('should read a 2xx whose body is JSON null as an answer', async () => {
    expect(await call(answering(200, 'null'))).toMatchObject({ kind: 'ok' })
  })
})

describe('classifyRequestFailure', () => {
  it.each([42, null, undefined, {}])(
    'should read a bare 503 with code %j as an unknown outcome',
    (code) => {
      expect(classifyRequestFailure(503, code)).toBe(OUTCOME_UNKNOWN)
    }
  )

  it('should read a 503 with a string code as unreachable', () => {
    expect(classifyRequestFailure(503, 'SERVICE_DOWN')).toBe(UNREACHABLE)
  })
})

describe('isExpoPushToken', () => {
  const token = (inner: string, prefix = 'ExponentPushToken'): string => `${prefix}[${inner}]`

  it('should accept an inner token of 1 and of 128 characters', () => {
    expect(isExpoPushToken(token('a'))).toBe(true)
    expect(isExpoPushToken(token('a'.repeat(128)))).toBe(true)
    expect(isExpoPushToken(token('a', 'ExpoPushToken'))).toBe(true)
  })

  it.each([
    ['129 characters', token('a'.repeat(129))],
    ['empty', token('')],
    ['a trailing character', `${token('a')}x`],
    ['a leading character', `x${token('a')}`],
    ['a trailing newline', `${token('a')}\n`],
    ['whitespace inside', token('a b')],
    ['a bracket inside', token('a[b')],
    ['a control character inside', token('a\0b')]
  ])('should refuse %s', (_label, value) => {
    expect(isExpoPushToken(value)).toBe(false)
  })
})

describe('ExpoPushProvider options', () => {
  it('should use the timeout it was given for each call', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout')
    const provider = new ExpoPushProvider({ timeoutMs: 777, fetch: answering(200, '{"data":[]}') })

    await provider.send({ tokens: ['ExponentPushToken[a]'], title: 't', body: 'b' })

    expect(spy).toHaveBeenCalledWith(777)
    spy.mockRestore()
  })

  it('should default the timeout to 10 seconds', async () => {
    const spy = jest.spyOn(AbortSignal, 'timeout')
    const provider = new ExpoPushProvider({ fetch: answering(200, '{"data":[]}') })

    await provider.send({ tokens: ['ExponentPushToken[a]'], title: 't', body: 'b' })

    expect(spy).toHaveBeenCalledWith(10_000)
    spy.mockRestore()
  })

  it.each([
    ['a latin1 tail', 'abcÿ'],
    ['a space inside', 'abc def'],
    ['one character', 'a']
  ])('should accept an access token with %s', (_label, accessToken) => {
    expect(() => new ExpoPushProvider({ accessToken })).not.toThrow()
  })

  it.each([
    ['a leading space', ' abc'],
    ['a leading no-break space', '\u00a0abc'],
    ['empty', ''],
    ['a trailing newline', 'abc\n'],
    ['a character above latin1', 'abcĀ'],
    ['a control character', 'a\u0000b']
  ])('should refuse an access token with %s', (_label, accessToken) => {
    expect(() => new ExpoPushProvider({ accessToken })).toThrow(/accessToken/u)
  })
})
