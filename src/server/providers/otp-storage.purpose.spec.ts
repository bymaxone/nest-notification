/**
 * @fileoverview Holds both reference `IOtpStorage` classes to refusing a purpose that is not a
 * plain name before they build a key from it. They are public classes a consumer can call
 * directly, so the service in front of them is not the only boundary. The Redis client given to the
 * Redis storage fails every call: a refusal that comes first never reaches it.
 * @layer infrastructure
 */

import { NotificationException } from '../errors/notification-exception'
import type { IOtpStorage, OtpEntry } from '../interfaces/otp-storage.interface'

import { InMemoryOtpStorage } from './in-memory-otp.storage'
import { RedisOtpStorage } from './redis-otp.storage'
import type { RedisLike } from './redis-otp.storage'

const ENTRY: OtpEntry = { code: '1', expiresAt: 1, attempts: 0, maxAttempts: 3 }

const REACHED = 'the store was reached'
const unreachable = new Proxy(
  {},
  {
    get: () => () => {
      throw new Error(REACHED)
    }
  }
) as unknown as RedisLike

const STORAGES: ReadonlyArray<readonly [string, () => IOtpStorage]> = [
  ['InMemoryOtpStorage', () => new InMemoryOtpStorage()],
  ['RedisOtpStorage', () => new RedisOtpStorage({ redisClient: unreachable })]
]

/** Every operation of the contract that takes a purpose, with the purpose put in. */
const OPERATIONS: ReadonlyArray<
  readonly [string, (storage: IOtpStorage, purpose: string) => Promise<unknown>]
> = [
  ['set', (s, p) => s.set('t', 'jane@acme.com', p, ENTRY)],
  ['get', (s, p) => s.get('t', 'jane@acme.com', p)],
  ['consumeAttempt', (s, p) => s.consumeAttempt('t', 'jane@acme.com', p)],
  ['update', (s, p) => s.update('t', 'jane@acme.com', p, ENTRY)],
  ['delete', (s, p) => s.delete('t', 'jane@acme.com', p)],
  [
    'deleteIfCode',
    (s, p) =>
      (s.deleteIfCode as NonNullable<IOtpStorage['deleteIfCode']>)('t', 'jane@acme.com', p, '1')
  ],
  ['tryAcquireCooldown', (s, p) => s.tryAcquireCooldown('t', 'jane@acme.com', p, 60)],
  ['getCooldown', (s, p) => s.getCooldown('t', 'jane@acme.com', p)],
  ['clearCooldown', (s, p) => s.clearCooldown('t', 'jane@acme.com', p)],
  [
    'getFailures',
    (s, p) => (s.getFailures as NonNullable<IOtpStorage['getFailures']>)('t', 'jane@acme.com', p)
  ],
  [
    'recordFailure',
    (s, p) =>
      (s.recordFailure as NonNullable<IOtpStorage['recordFailure']>)('t', 'jane@acme.com', p, 60)
  ],
  [
    'clearFailures',
    (s, p) =>
      (s.clearFailures as NonNullable<IOtpStorage['clearFailures']>)('t', 'jane@acme.com', p)
  ]
]

describe.each(STORAGES)('%s and the purpose', (name, make) => {
  it.each(OPERATIONS)(
    'should refuse a purpose that is not a plain name in %s',
    async (_op, run) => {
      for (const purpose of ['', 'a'.repeat(65), 'a b', 'a/b', 'a\nb', 'a*', 'é']) {
        const caught: unknown = await run(make(), purpose).catch((error: unknown) => error)

        expect(caught).toBeInstanceOf(NotificationException)
        expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
        // The refusal names the storage that made it.
        expect((caught as NotificationException).getResponse()).toMatchObject({
          error: { details: { boundary: name, parameter: 'purpose' } }
        })
      }
    }
  )

  it.each(OPERATIONS)('should not refuse a plain purpose in %s', async (_op, run) => {
    for (const purpose of ['email_verification', ':'.repeat(64), 'a'.repeat(64)]) {
      const caught: unknown = await run(make(), purpose).catch((error: unknown) => error)

      expect(caught).not.toBeInstanceOf(NotificationException)
    }
  })
})
