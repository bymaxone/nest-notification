/**
 * @fileoverview Holds a push a provider accepted to being answered with its results: a realm found
 * changed once a request has gone out never turns the send into a refusal, since a caller told the
 * send failed repeats it. A realm changed before any request still refuses.
 * @layer integration
 */

import { generateKeyPairSync } from 'node:crypto'

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BYMAX_NOTIFICATION_OBSERVER } from '../bymax-notification.constants'
import { BymaxNotificationModule } from '../bymax-notification.module'
import type { IPushProvider } from '../interfaces/push-provider.interface'
import { ApnsPushProvider } from '../providers/apns-push.provider'
import {
  OTHER,
  TOKEN,
  answer,
  cleanup,
  fake,
  providerOn
} from '../providers/__tests__/apns-server.fixture'
import { ExpoPushProvider } from '../providers/expo-push.provider'
import { GOOGLE_TOKEN_URL } from '../providers/fcm-push.client'
import { FcmPushProvider } from '../providers/fcm-push.provider'

import { NotificationService } from './notification.service'
import { PushService } from './push.service'

const ROOT = Object.prototype as unknown as Record<string, unknown>
const calledThen = jest.fn()
const REFUSED = { code: 'notification.invalid_scope_identifier' }
const UNSENT = { reason: 'provider_unavailable', retryable: true }
const message = { title: 't', body: 'b' }

let planted: string | undefined

/** Plants the key, as something else in the process could while a request is out. */
function plant(key: string): void {
  ROOT[key] = key === 'then' ? calledThen : 'x'
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

/** An answer of a fake `fetch` that resolves and reads without touching the realm root. */
function reply(body: unknown): Response {
  const text = JSON.stringify(body)
  return Object.assign(Object.create(null) as object, {
    then: undefined,
    status: 200,
    ok: true,
    text: () => Promise.resolve(text)
  }) as unknown as Response
}

const RSA = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' }
})

/** An FCM adapter whose `fetch` plants the key while the send numbered `at` is out. */
function fcm(key: string, at: number): { provider: FcmPushProvider; sends: () => number } {
  let sends = 0
  const provider = new FcmPushProvider({
    projectId: 'demo-project',
    clientEmail: 'push@demo-project.iam.gserviceaccount.com',
    privateKey: RSA.privateKey,
    concurrency: 1,
    fetch: (url) => {
      if (url === GOOGLE_TOKEN_URL) {
        return Promise.resolve(reply({ access_token: 'a', expires_in: 3600 }))
      }
      sends += 1
      const mine = sends
      return new Promise((resolve) => {
        setImmediate(() => {
          if (mine === at) {
            plant(key)
          }
          resolve(reply({ name: `projects/demo-project/messages/${String(mine)}` }))
        })
      })
    }
  })
  return { provider, sends: () => sends }
}

/** An Expo adapter whose `fetch` plants the key while the chunk numbered `at` is out. */
function expo(key: string, at: number): { provider: ExpoPushProvider; sends: () => number } {
  let sends = 0
  const provider = new ExpoPushProvider({
    fetch: (_url, init) => {
      sends += 1
      const mine = sends
      const count = (JSON.parse(String(init.body)) as unknown[]).length
      const data = Array.from({ length: count }, (_, index) => ({
        status: 'ok',
        id: `r${String(mine)}-${String(index)}`
      }))
      return new Promise((resolve) => {
        setImmediate(() => {
          if (mine === at) {
            plant(key)
          }
          resolve(reply({ data }))
        })
      })
    }
  })
  return { provider, sends: () => sends }
}

const EXPO_TOKENS = Array.from(
  { length: 101 },
  (_, index) => `ExponentPushToken[${String(index).padStart(22, '0')}]`
)

/** An observer where the module can inject it, so the send runs through its observed path. */
class ObserverModule {}
const observerImport = {
  module: ObserverModule,
  global: true,
  providers: [{ provide: BYMAX_NOTIFICATION_OBSERVER, useValue: { onSend: () => undefined } }],
  exports: [BYMAX_NOTIFICATION_OBSERVER]
}

describe('a push a provider accepted before the realm was found changed', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    calledThen.mockReset()
  })

  afterEach(async () => {
    restore()
    await cleanup()
  })

  // The service's own checks come after the provider answered, so none of them may refuse.
  it.each([
    ['zzz', false],
    ['then', false],
    ['zzz', true]
  ])('should answer PushService.send with the results (%s, sink fails: %s)', async (key, fails) => {
    const rows: string[] = []
    const provider: IPushProvider = {
      name: 'accepting',
      isConfigured: () => true,
      send: async () => {
        await new Promise((resolve) => setImmediate(resolve))
        plant(key)
        const results = [{ token: 'a', messageId: 'm1' }]
        return Object.assign(Object.create(null) as object, { then: undefined, results })
      }
    }
    const module = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRoot({
          push: { provider },
          audit: {
            swallowErrors: false,
            repository: {
              name: 'r',
              create: async (entry) => {
                rows.push(entry.verb)
                if (fails) {
                  throw new Error('sink down')
                }
              }
            }
          }
        })
      ]
    }).compile()
    const push = module.get(PushService)
    const result = await settle(() => push.send({ ...message, tenantId: 't1', tokens: ['a'] }))
    expect(result).toEqual({ results: [{ token: 'a', messageId: 'm1' }] })
    expect(rows).toEqual(['sent'])
    expect(calledThen).not.toHaveBeenCalled()
  })

  // The facade has its own answer around the results: it must not refuse them either.
  it.each([
    ['zzz', false],
    ['then', false],
    ['zzz', true]
  ])('should answer a push dispatch with the results (%s, observer: %s)', async (key, observed) => {
    const provider: IPushProvider = {
      name: 'accepting',
      isConfigured: () => true,
      send: async () => {
        await new Promise((resolve) => setImmediate(resolve))
        plant(key)
        const results = [{ token: 'a', messageId: 'm1' }]
        return Object.assign(Object.create(null) as object, { then: undefined, results })
      }
    }
    const module = await Test.createTestingModule({
      imports: [
        ...(observed ? [observerImport] : []),
        BymaxNotificationModule.forRoot({ push: { provider } })
      ]
    }).compile()
    const notifications = module.get(NotificationService)
    const result = await settle(() =>
      notifications.dispatch({
        channel: 'push',
        tenantId: 't1',
        payload: { ...message, tokens: ['a'] }
      })
    )
    expect(result).toEqual({
      channel: 'push',
      result: { results: [{ token: 'a', messageId: 'm1' }] }
    })
    expect(calledThen).not.toHaveBeenCalled()
  })

  describe.each(['zzz', 'then'])('with %s planted', (key) => {
    // The first token is delivered; the second is not started and is safe to send again.
    it('should keep the FCM deliveries made and leave the rest unsent', async () => {
      const { provider, sends } = fcm(key, 1)
      const result = await settle(() => provider.send({ ...message, tokens: ['a', 'b'] }))
      expect(result.results).toEqual([
        { token: 'a', messageId: 'projects/demo-project/messages/1' },
        { token: 'b', ...UNSENT }
      ])
      expect(sends()).toBe(1)
      expect(calledThen).not.toHaveBeenCalled()
    })

    // Planted while the last request is out: every token has its answer.
    it('should answer an FCM send planted during its last request', async () => {
      const { provider } = fcm(key, 2)
      const result = await settle(() => provider.send({ ...message, tokens: ['a', 'b'] }))
      expect(result.results.map((one) => 'messageId' in one)).toEqual([true, true])
      expect(calledThen).not.toHaveBeenCalled()
    })

    // The second chunk is never sent; the first keeps its tickets.
    it('should keep the Expo tickets issued and leave the next chunk unsent', async () => {
      const { provider, sends } = expo(key, 1)
      const result = await settle(() => provider.send({ ...message, tokens: EXPO_TOKENS }))
      expect(result.results[0]).toEqual({ token: EXPO_TOKENS[0], messageId: 'r1-0' })
      expect(result.results[100]).toEqual({ token: EXPO_TOKENS[100], ...UNSENT })
      expect(sends()).toBe(1)
      expect(calledThen).not.toHaveBeenCalled()
    })
  })

  // APNs sends the first token of a connection alone, so a plant during it leaves the second unsent.
  it('should keep the APNs delivery made and leave the rest unsent', async () => {
    const server = await fake()
    server.steps.push((seen) => {
      plant('zzz')
      answer(seen, { status: 200 })
    })
    const provider = providerOn(server, { concurrency: 1 })
    const result = await settle(() => provider.send({ ...message, tokens: [TOKEN, OTHER] }))
    expect(result.results).toEqual([
      { token: TOKEN, messageId: 'id-ab' },
      { token: OTHER, ...UNSENT }
    ])
    expect(server.requests).toHaveLength(1)
  })

  // Nothing has gone out, so refusing costs the caller nothing and stays the answer.
  describe('with the realm changed before any request', () => {
    it.each([
      ['FCM', () => fcm('zzz', 0).provider, ['a']],
      ['Expo', () => expo('zzz', 0).provider, [EXPO_TOKENS[0] as string]],
      ['APNs', () => new ApnsPushProvider({ ...apnsOptions() }), [TOKEN]]
    ] as const)('should refuse a %s send', async (_name, build, tokens) => {
      const provider: IPushProvider = build()
      await expect(
        settle(() => {
          plant('zzz')
          return provider.send({ ...message, tokens: [...tokens] })
        })
      ).rejects.toMatchObject(REFUSED)
    })
  })
})

/** Options of an APNs adapter that is never expected to connect. */
function apnsOptions(): ConstructorParameters<typeof ApnsPushProvider>[0] {
  const ec = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  })
  return {
    teamId: 'TEAMSECRET',
    keyId: 'KEYSECRET1',
    privateKey: ec.privateKey,
    topic: 'com.example.app',
    environment: 'production'
  }
}
