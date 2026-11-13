/**
 * @fileoverview End-to-end proof of `RedisOtpStorage` against a real Redis.
 * @layer test
 *
 * The unit suite drives the storage through an in-process Redis double, which cannot show that
 * the Lua scripts, the key expiry and the atomicity guarantees hold on the real server. This
 * suite starts the production major of Redis in a container and runs the executable
 * `IOtpStorage` contract, the concurrent failure counter and the OTP service flow against it.
 */

import { Redis } from 'ioredis'
import { GenericContainer } from 'testcontainers'
import type { StartedTestContainer } from 'testcontainers'

import { OtpService, RedisOtpStorage } from '@bymax-one/nest-notification'
import { otpStorageContract } from '@bymax-one/nest-notification/testing'

import {
  makeAudit,
  makeOptions,
  ref
} from '../../src/server/services/__tests__/otp-service.fixtures'

const REDIS_IMAGE = 'redis:8-alpine'
const REDIS_PORT = 6379
const RACERS = 200
// Letters never occur in the numeric codes the service generates, so this guess is always wrong.
const WRONG = 'ABCDEF'

describe('RedisOtpStorage against a real Redis', () => {
  let container: StartedTestContainer
  let redis: Redis
  let namespace: string

  const storage = (): RedisOtpStorage => new RedisOtpStorage({ redisClient: redis, namespace })

  beforeAll(async () => {
    container = await new GenericContainer(REDIS_IMAGE).withExposedPorts(REDIS_PORT).start()
    redis = new Redis(container.getMappedPort(REDIS_PORT), container.getHost())
  })

  afterAll(async () => {
    await redis?.quit()
    await container?.stop()
  })

  beforeEach(() => {
    namespace = `e2e_${Math.random().toString(36).slice(2)}`
  })

  // Redis expires keys in whole seconds, so the TTL cases wait past a second.
  describe('the IOtpStorage contract', () => {
    for (const { name, run } of otpStorageContract(storage, { expiryWaitMs: 2200 })) {
      it(name, run)
    }
  })

  it('should count concurrent failures exactly once each', async () => {
    const counts = await Promise.all(
      Array.from({ length: RACERS }, () =>
        storage().recordFailure('acme', ref.recipient, ref.purpose, 30)
      )
    )

    expect(new Set(counts).size).toBe(RACERS)
    expect(Math.max(...counts)).toBe(RACERS)
  })

  it('should keep the failure counter under a hashed key with a lifetime', async () => {
    await storage().recordFailure('acme', ref.recipient, ref.purpose, 30)

    const keys = await redis.keys(`${namespace}:otp_fail:*`)

    expect(keys).toHaveLength(1)
    expect(keys[0]).not.toContain(ref.recipient)
    expect(await redis.ttl(keys[0] as string)).toBeGreaterThan(0)
  })

  describe('through OtpService', () => {
    const base = { ...ref, tenantId: 'acme', deliverVia: 'manual' as const }
    let service: OtpService

    beforeEach(() => {
      service = new OtpService(
        makeOptions({ defaultMaxAttempts: 3, resendCooldownSeconds: 0 }),
        storage(),
        makeAudit()
      )
    })

    it('should keep a recipient locked out across a re-issue', async () => {
      await service.generate(base)
      for (let i = 0; i < 3; i += 1) await service.verify({ ...base, code: WRONG })

      await service.generate(base)

      expect(await service.verify({ ...base, code: WRONG })).toEqual({
        valid: false,
        reason: 'max_attempts'
      })
    })

    it('should compare only the guesses within the ceiling when they arrive together', async () => {
      await service.generate(base)

      const results = await Promise.all(
        Array.from({ length: 20 }, () => service.verify({ ...base, code: WRONG }))
      )

      expect(results.filter((r) => !r.valid && r.reason === 'invalid_code')).toHaveLength(3)
      expect(results.filter((r) => !r.valid && r.reason === 'max_attempts')).toHaveLength(17)
    })

    it('should clear the failures on a successful verification', async () => {
      await service.generate(base)
      await service.verify({ ...base, code: WRONG })
      const stored = await storage().get('acme', ref.recipient, ref.purpose)

      expect(await service.verify({ ...base, code: stored?.code ?? '' })).toEqual({ valid: true })
      expect(await redis.keys(`${namespace}:otp_fail:*`)).toHaveLength(0)
    })
  })

  // The one-time property on a real server: the compare-and-delete script is the only thing that
  // decides the winner, so this is what a read-then-delete would lose.
  describe('consumeOnVerify through OtpService', () => {
    const base = { ...ref, tenantId: 'acme', deliverVia: 'manual' as const }

    it('should accept a code exactly once when five verifications run together', async () => {
      const service = new OtpService(
        makeOptions({ consumeOnVerify: true, resendCooldownSeconds: 0 }),
        storage(),
        makeAudit()
      )
      await service.generate(base)
      const stored = await storage().get('acme', ref.recipient, ref.purpose)

      const results = await Promise.all(
        Array.from({ length: 5 }, () => service.verify({ ...base, code: stored?.code ?? '' }))
      )

      expect(results.filter((result) => result.valid)).toHaveLength(1)
      expect(results.filter((result) => !result.valid)).toEqual(
        Array.from({ length: 4 }, () => ({ valid: false, reason: 'not_found' }))
      )
    })

    it('should leave a regenerated code alone', async () => {
      const first = storage()
      await first.set('acme', ref.recipient, ref.purpose, {
        code: '111111',
        expiresAt: Date.now() + 60_000,
        attempts: 0,
        maxAttempts: 5
      })
      await first.set('acme', ref.recipient, ref.purpose, {
        code: '222222',
        expiresAt: Date.now() + 60_000,
        attempts: 0,
        maxAttempts: 5
      })

      expect(await first.deleteIfCode('acme', ref.recipient, ref.purpose, '111111')).toBe(false)
      expect((await first.get('acme', ref.recipient, ref.purpose))?.code).toBe('222222')
    })
  })
})
