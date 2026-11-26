/**
 * @fileoverview The APNs adapter against a local HTTP/2 server: options, the connection and the provider token.
 * @layer infrastructure
 */

import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { connect, constants } from 'node:http2'
import type { ClientHttp2Session, ServerHttp2Session } from 'node:http2'
import type { AddressInfo } from 'node:net'
import { ApnsPushProvider } from './apns-push.provider'
import {
  KEYS,
  OTHER,
  THIRD,
  TOKEN,
  answer,
  base,
  claimsOf,
  cleanup,
  credentials,
  failureOf,
  fake,
  providerOn
} from './__tests__/apns-server.fixture'
import type { Seen, Step } from './__tests__/apns-server.fixture'

describe('ApnsPushProvider', () => {
  afterEach(cleanup)

  describe('options', () => {
    it('is named apns and configured', () => {
      /* Act */
      const provider = new ApnsPushProvider(credentials)
      /* Assert */
      expect(provider.name).toBe('apns')
      expect(provider.isConfigured()).toBe(true)
    })

    it.each<[object, string]>([
      [{ teamId: undefined }, 'teamId'],
      [{ teamId: 'short' }, 'teamId'],
      [{ teamId: 'TEAMSECRET1' }, 'teamId'],
      [{ teamId: 'teamsecret' }, 'teamId'],
      [{ teamId: { toString: () => 'TEAMSECRET' } }, 'teamId'],
      [{ keyId: undefined }, 'keyId'],
      [{ keyId: 'KEYSECRET' }, 'keyId'],
      [{ keyId: 'KEY SECRET' }, 'keyId'],
      [{ keyId: 1234567890 }, 'keyId'],
      [{ privateKey: undefined }, 'privateKey'],
      [{ privateKey: 5 }, 'privateKey'],
      [{ privateKey: 'not a key SECRET' }, 'privateKey'],
      [{ privateKey: KEYS.publicKey }, 'privateKey'],
      [
        {
          privateKey: generateKeyPairSync('ec', {
            namedCurve: 'P-384',
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' }
          }).privateKey
        },
        'privateKey'
      ],
      [
        {
          privateKey: generateKeyPairSync('rsa', {
            modulusLength: 2048,
            privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
            publicKeyEncoding: { type: 'spki', format: 'pem' }
          }).privateKey
        },
        'privateKey'
      ],
      [{ topic: undefined }, 'topic'],
      [{ topic: '' }, 'topic'],
      [{ topic: 'a b' }, 'topic'],
      [{ topic: 'a\r\nx: y' }, 'topic'],
      [{ topic: 'a'.repeat(256) }, 'topic'],
      [{ environment: undefined }, 'environment'],
      [{ environment: 'prod' }, 'environment'],
      [{ concurrency: 0 }, 'concurrency'],
      [{ concurrency: 501 }, 'concurrency'],
      [{ concurrency: 1.5 }, 'concurrency'],
      [{ timeoutMs: 0 }, 'timeoutMs'],
      [{ connect: 'x' }, 'connect must be a function']
    ])('refuses a bad option %#', (bad, message) => {
      /* Act */
      const build = (): ApnsPushProvider => new ApnsPushProvider({ ...credentials, ...bad })
      /* Assert */
      expect(build).toThrow(`ApnsPushProvider: ${message}`)
      expect(build).not.toThrow('SECRET')
      expect(build).not.toThrow('BEGIN')
    })

    it.each([1, 500])('takes a concurrency of %d', (concurrency) => {
      /* Act / Assert */
      expect(() => new ApnsPushProvider({ ...credentials, concurrency })).not.toThrow()
    })

    it('refuses options that are not an object', () => {
      /* Act / Assert */
      expect(() => new ApnsPushProvider(null as never)).toThrow('options must be an object')
    })
  })

  describe('connection', () => {
    it.each([
      ['production', 'https://api.push.apple.com'],
      ['sandbox', 'https://api.sandbox.push.apple.com']
    ] as const)('connects the %s environment to its fixed host', async (environment, host) => {
      /* Arrange */
      const server = await fake()
      /* Act */
      await providerOn(server, { environment }).send({ ...base, tokens: TOKEN })
      /* Assert */
      expect(server.authorities).toEqual([host])
    })

    it('opens its sessions with http2.connect unless given another way', async () => {
      /* Arrange: the module loads with a connect that records and refuses */
      const asked: string[] = []
      let Isolated = ApnsPushProvider
      jest.isolateModules(() => {
        jest.doMock('node:http2', () => ({
          ...jest.requireActual<object>('node:http2'),
          connect: (authority: string) => {
            asked.push(authority)
            throw new Error('offline')
          }
        }))
        Isolated =
          jest.requireActual<typeof import('./apns-push.provider')>(
            './apns-push.provider'
          ).ApnsPushProvider
      })
      jest.dontMock('node:http2')
      /* Act */
      const error = await failureOf(new Isolated(credentials).send({ ...base, tokens: TOKEN }))
      /* Assert */
      expect(error.message).toContain('provider_unavailable')
      expect(asked).toEqual(['https://api.push.apple.com'])
    })

    it('reuses one session across sends and ends it on close', async () => {
      /* Arrange */
      const server = await fake()
      const provider = providerOn(server)
      /* Act */
      await provider.send({ ...base, tokens: [TOKEN, OTHER] })
      await provider.send({ ...base, tokens: TOKEN })
      const ended = new Promise<void>((done) => server.sessions[0]?.on('close', () => done()))
      provider.onModuleDestroy()
      await ended
      await provider.send({ ...base, tokens: TOKEN })
      /* Assert */
      expect(server.authorities).toHaveLength(2)
      expect(server.requests.map((r) => r.connection)).toEqual([0, 0, 0, 1])
    })

    it('does not hold the process while idle', async () => {
      /* Arrange */
      const server = await fake()
      let unref: jest.SpyInstance | undefined
      const provider = providerOn(server, {
        connect: (authority) => {
          const session = server.connect(authority)
          unref = jest.spyOn(session, 'unref')
          return session
        }
      })
      /* Act */
      await provider.send({ ...base, tokens: TOKEN })
      /* Assert */
      expect(unref).toHaveBeenCalledTimes(1)
    })

    it('opens a new session after the server ends the one in use', async () => {
      /* Arrange */
      const server = await fake()
      const provider = providerOn(server)
      await provider.send({ ...base, tokens: TOKEN })
      const session = server.sessions[0] as ServerHttp2Session
      await new Promise<void>((done) => {
        session.on('close', () => done())
        session.close()
      })
      await new Promise((done) => setTimeout(done, 20))
      /* Act */
      const result = await provider.send({ ...base, tokens: TOKEN })
      /* Assert */
      expect(result.results[0]?.messageId).toBe('id-ab')
      expect(server.authorities).toHaveLength(2)
    })

    it('throws a retryable PUSH error when no connection can be made, and says no more', async () => {
      /* Arrange */
      const server = await fake()
      const dead = server.connect
      await server.close()
      const provider = new ApnsPushProvider({ ...credentials, connect: dead })
      /* Act */
      const error = await failureOf(provider.send({ ...base, tokens: [TOKEN, OTHER, THIRD] }))
      /* Assert */
      expect(error.message).toBe('ApnsPushProvider: the push was not sent (provider_unavailable)')
      expect(error.code).toBe('EUNAVAILABLE')
      expect(server.authorities).toHaveLength(1)
    })

    it('treats a connect that throws as a connection never made', async () => {
      /* Arrange */
      const provider = new ApnsPushProvider({
        ...credentials,
        connect: () => {
          throw new Error('SECRET proxy words')
        }
      })
      /* Act */
      const error = await failureOf(provider.send({ ...base, tokens: TOKEN }))
      /* Assert */
      expect(error.message).toBe('ApnsPushProvider: the push was not sent (provider_unavailable)')
    })

    it('answers a request that times out as unknown, and uses a new session after it', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push({ status: 200 }, () => undefined)
      const provider = providerOn(server, { timeoutMs: 150, concurrency: 1 })
      await provider.send({ ...base, tokens: TOKEN })
      /* Act */
      const lost = await provider.send({ ...base, tokens: OTHER })
      const next = await provider.send({ ...base, tokens: THIRD })
      /* Assert */
      expect(lost.results).toEqual([
        { token: OTHER, reason: 'provider_unavailable', retryable: false }
      ])
      expect(next.results[0]?.messageId).toBe('id-ef')
      expect(server.requests.map((r) => r.connection)).toEqual([0, 0, 1])
    }, 5_000)

    it('gives up on a connection that never answers, as a push not sent', async () => {
      /* Arrange: a socket that accepts and stays silent */
      const { createServer: tcp } = await import('node:net')
      const sockets: import('node:net').Socket[] = []
      const silent = tcp((socket) => sockets.push(socket))
      await new Promise<void>((done) => silent.listen(0, '127.0.0.1', done))
      const port = (silent.address() as AddressInfo).port
      let session: ClientHttp2Session | undefined
      const provider = new ApnsPushProvider({
        ...credentials,
        timeoutMs: 150,
        connect: () => (session = connect(`https://127.0.0.1:${String(port)}`))
      })
      /* Act */
      const error = await failureOf(provider.send({ ...base, tokens: TOKEN }))
      /* Assert */
      expect(error.code).toBe('EUNAVAILABLE')
      expect(session?.destroyed).toBe(true)
      sockets.forEach((socket) => socket.destroy())
      await new Promise<void>((done) => silent.close(() => done()))
    }, 5_000)

    it('answers a stream refused before processing as safe to retry', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push({ status: 200 }, (seen) =>
        seen.stream.close(constants.NGHTTP2_REFUSED_STREAM)
      )
      const provider = providerOn(server, { concurrency: 1 })
      /* Act */
      const result = await provider.send({ ...base, tokens: [TOKEN, OTHER] })
      /* Assert */
      expect(result.results[1]).toEqual({
        token: OTHER,
        reason: 'provider_unavailable',
        retryable: true
      })
    })

    it('answers a stream reset after the request as unknown', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push({ status: 200 }, (seen) =>
        seen.stream.close(constants.NGHTTP2_INTERNAL_ERROR)
      )
      const provider = providerOn(server, { concurrency: 1 })
      /* Act */
      const result = await provider.send({ ...base, tokens: [TOKEN, OTHER] })
      /* Assert */
      expect(result.results[1]).toEqual({
        token: OTHER,
        reason: 'provider_unavailable',
        retryable: false
      })
    })

    it('separates the streams a GOAWAY left unprocessed from the one it had taken', async () => {
      /* Arrange: the probe, then two requests; the server takes only the first of the two */
      const server = await fake()
      const held: Seen[] = []
      const hold = (seen: Seen): void => {
        held.push(seen)
        if (held.length === 2) {
          const first = held.reduce((a, b) => ((a.stream.id ?? 0) < (b.stream.id ?? 0) ? a : b))
          first.stream.session?.goaway(constants.NGHTTP2_INTERNAL_ERROR, first.stream.id)
        }
      }
      server.steps.push({ status: 200 }, hold, hold)
      const provider = providerOn(server, { concurrency: 2, timeoutMs: 2_000 })
      /* Act */
      const result = await provider.send({ ...base, tokens: [TOKEN, OTHER, THIRD] })
      /* Assert */
      expect(result.results[0]?.messageId).toBe('id-ab')
      expect(result.results.slice(1).map((r) => r.retryable)).toEqual([false, true])
    }, 5_000)

    it('sends the first request alone, then the rest together', async () => {
      /* Arrange */
      const server = await fake()
      const open: Seen[] = []
      let most = 0
      const counted = (seen: Seen): void => {
        open.push(seen)
        most = Math.max(most, open.length)
        setTimeout(() => {
          open.splice(open.indexOf(seen), 1)
          answer(seen, { status: 200 })
        }, 30)
      }
      const together: number[] = []
      server.steps.push(
        (seen) => {
          counted(seen)
          setTimeout(() => together.push(server.requests.length), 15)
        },
        counted,
        counted,
        counted,
        counted
      )
      const tokens = ['01', '02', '03', '04', '05'].map((t) => t.repeat(32))
      /* Act */
      const result = await providerOn(server, { concurrency: 2 }).send({ ...base, tokens })
      /* Assert */
      expect(together).toEqual([1])
      expect(most).toBe(2)
      expect(result.results.map((r) => r.token)).toEqual(tokens)
    })
  })

  describe('one request first on a connection', () => {
    const tokens = ['01', '02', '03', '04', '05', '06'].map((t) => t.repeat(32))

    it('holds side-by-side sends until the first is answered', async () => {
      /* Arrange */
      const server = await fake({ maxConcurrentStreams: 1 })
      const provider = providerOn(server)
      /* Act */
      const results = await Promise.all(
        tokens.map((token) => provider.send({ ...base, tokens: token }))
      )
      /* Assert */
      expect(results.map((r) => r.results[0]?.reason)).toEqual(tokens.map(() => undefined))
    }, 5_000)

    it('holds it again on the connection that replaces one mid-send', async () => {
      /* Arrange */
      const server = await fake({ maxConcurrentStreams: 1 })
      server.steps.push((seen) => {
        answer(seen, { status: 200 })
        seen.stream.session?.close()
      })
      /* Act */
      const result = await providerOn(server).send({ ...base, tokens })
      /* Assert */
      expect(result.results.map((r) => r.reason)).toEqual(tokens.map(() => undefined))
    }, 5_000)

    it('returns what waited behind an unanswered first request as not sent', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push(() => undefined)
      const provider = providerOn(server, { timeoutMs: 150 })
      /* Act */
      const first = provider.send({ ...base, tokens: TOKEN })
      const waited = failureOf(provider.send({ ...base, tokens: OTHER }))
      /* Assert */
      expect((await first).results[0]?.retryable).toBe(false)
      expect((await waited).code).toBe('EUNAVAILABLE')
      expect(server.requests).toHaveLength(1)
      const after = await provider.send({ ...base, tokens: THIRD })
      expect(after.results[0]?.messageId).toBe('id-ef')
    }, 5_000)

    it('lets another request lead when the first was reset on a connection that stays', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push((seen) => seen.stream.close(constants.NGHTTP2_INTERNAL_ERROR))
      const provider = providerOn(server)
      await provider.send({ ...base, tokens: TOKEN })
      /* Act */
      const result = await provider.send({ ...base, tokens: OTHER })
      /* Assert */
      expect(result.results[0]?.messageId).toBe('id-cd')
      expect(server.authorities).toHaveLength(1)
    }, 5_000)
  })

  describe('close', () => {
    it('lets a request still waiting for the connection be sent', async () => {
      /* Arrange */
      const server = await fake()
      const provider = providerOn(server)
      /* Act */
      const pending = provider.send({ ...base, tokens: TOKEN })
      provider.close()
      /* Assert */
      expect((await pending).results[0]?.messageId).toBe('id-ab')
    }, 5_000)

    it.each([
      ['one waiting behind the first request', [TOKEN, OTHER]],
      ['the rest of a batch in progress', [[TOKEN, OTHER, THIRD]]]
    ])(
      'leaves no session open for %s, and a later send keeps its own',
      async (_case, sends) => {
        /* Arrange */
        const server = await fake()
        const sessions: ClientHttp2Session[] = []
        const provider = providerOn(server, {
          connect: (authority) => {
            const session = server.connect(authority)
            sessions.push(session)
            return session
          }
        })
        /* Act */
        const pending = sends.map((tokens) => provider.send({ ...base, tokens }))
        provider.close()
        await Promise.all(pending)
        const open = sessions.filter((session) => !session.closed && !session.destroyed)
        await provider.send({ ...base, tokens: TOKEN })
        /* Assert */
        expect(open).toEqual([])
        expect(sessions[sessions.length - 1]?.closed).toBe(false)
      },
      5_000
    )

    it('ends a session that was already connected when the host gave it', async () => {
      /* Arrange */
      const server = await fake()
      const ready = server.connect('https://api.push.apple.com')
      await new Promise<void>((done) => ready.once('connect', () => done()))
      const provider = providerOn(server, { connect: () => ready })
      await provider.send({ ...base, tokens: TOKEN })
      /* Act */
      provider.close()
      /* Assert */
      expect(ready.closed).toBe(true)
    }, 5_000)
  })

  describe('provider token', () => {
    it('signs an ES256 token with the key id and team id, and reuses it', async () => {
      /* Arrange */
      jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_500)
      const server = await fake()
      /* Act */
      await providerOn(server).send({ ...base, tokens: [TOKEN, OTHER] })
      /* Assert */
      const first = claimsOf(server.requests[0] as Seen)
      expect(first.header).toEqual({ alg: 'ES256', kid: 'KEYSECRET1' })
      expect(first.claims).toEqual({ iss: 'TEAMSECRET', iat: 1_700_000_000 })
      expect(claimsOf(server.requests[1] as Seen).token).toBe(first.token)
      const [head, claims, signature] = first.token.split('.')
      expect(
        verify(
          'sha256',
          Buffer.from(`${head}.${claims}`),
          { key: createPublicKey(KEYS.publicKey), dsaEncoding: 'ieee-p1363' },
          Buffer.from(String(signature), 'base64url')
        )
      ).toBe(true)
    })

    it('signs a new one after 50 minutes, not before', async () => {
      /* Arrange */
      const clock = jest.spyOn(Date, 'now').mockReturnValue(0)
      const server = await fake()
      const provider = providerOn(server)
      /* Act */
      for (const at of [0, 50 * 60_000 - 1, 50 * 60_000]) {
        clock.mockReturnValue(at)
        await provider.send({ ...base, tokens: TOKEN })
      }
      /* Assert */
      expect(server.requests.map((r) => claimsOf(r).claims.iat)).toEqual([0, 0, 3000])
    })

    it('signs again and retries once on ExpiredProviderToken, no sooner than 20 minutes', async () => {
      /* Arrange */
      const start = 6_000_000
      const clock = jest.spyOn(Date, 'now').mockReturnValue(start)
      const server = await fake()
      const provider = providerOn(server)
      await provider.send({ ...base, tokens: TOKEN })
      const expired: Step = { status: 403, reason: 'ExpiredProviderToken' }
      /* Act */
      server.steps.push(expired)
      clock.mockReturnValue(start + 20 * 60_000 - 1)
      const early = await failureOf(provider.send({ ...base, tokens: TOKEN }))
      server.steps.push(expired)
      clock.mockReturnValue(start + 20 * 60_000)
      const late = await provider.send({ ...base, tokens: TOKEN })
      server.steps.push(expired, expired)
      clock.mockReturnValue(start + 40 * 60_000)
      const twice = await failureOf(provider.send({ ...base, tokens: TOKEN }))
      /* Assert */
      expect(early.message).toContain('(credentials)')
      expect(late.results[0]?.messageId).toBe('id-ab')
      expect(twice.message).toContain('(credentials)')
      expect(server.requests.map((r) => claimsOf(r).claims.iat)).toEqual([
        6000, 6000, 6000, 7200, 7200, 8400
      ])
    })

    it('retries both of two requests that carried the same expired token', async () => {
      /* Arrange */
      const clock = jest.spyOn(Date, 'now').mockReturnValue(0)
      const server = await fake()
      const provider = providerOn(server)
      await provider.send({ ...base, tokens: TOKEN })
      const held: Seen[] = []
      const together = (seen: Seen): void => {
        held.push(seen)
        if (held.length === 2) {
          held.forEach((one) => answer(one, { status: 403, reason: 'ExpiredProviderToken' }))
        }
      }
      clock.mockReturnValue(30 * 60_000)
      // The idle connection is replaced, and its first request goes alone: this one opens the new one.
      await provider.send({ ...base, tokens: TOKEN })
      server.steps.push(together, together)
      /* Act */
      const result = await provider.send({ ...base, tokens: [OTHER, THIRD] })
      /* Assert */
      expect(result.results.map((r) => r.messageId)).toEqual(['id-cd', 'id-ef'])
      expect(server.requests.map((r) => claimsOf(r).claims.iat)).toEqual([0, 0, 0, 0, 1800, 1800])
    })
  })

  describe('timeouts side by side', () => {
    it('gives up on two requests of one session and sends on a new one', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push(
        { status: 200 },
        () => undefined,
        () => undefined
      )
      const provider = providerOn(server, { timeoutMs: 150, concurrency: 2 })
      /* Act */
      const lost = await provider.send({ ...base, tokens: [TOKEN, OTHER, THIRD] })
      const next = await provider.send({ ...base, tokens: TOKEN })
      /* Assert */
      expect(lost.results.slice(1).map((r) => r.retryable)).toEqual([false, false])
      expect(next.results[0]?.messageId).toBe('id-ab')
      expect(server.authorities).toHaveLength(2)
    }, 5_000)

    it('answers with the status when only the body of a refusal never ends', async () => {
      /* Arrange */
      const server = await fake()
      server.steps.push((seen) => {
        seen.stream.respond({ ':status': 410 })
        seen.stream.write('{"reason":"Unregistered"')
      })
      /* Act */
      const result = await providerOn(server, { timeoutMs: 150 }).send({ ...base, tokens: TOKEN })
      /* Assert */
      expect(result.results).toEqual([{ token: TOKEN, reason: 'unknown', retryable: false }])
    }, 5_000)
  })
})
