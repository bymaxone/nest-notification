import { hashTenantRecipient } from '../utils/hash'
import type { OtpEntry } from '../interfaces/otp-storage.interface'

import { RedisOtpStorage } from './redis-otp.storage'
import type { RedisLike } from './redis-otp.storage'

const MS = 1000

/**
 * Faithful in-memory Redis double implementing exactly the commands
 * `RedisOtpStorage` uses, including an atomic `eval` that replicates the
 * `consumeAttempt` Lua. `eval` runs entirely synchronously (no internal await),
 * mirroring Redis's single-threaded atomicity so the interleaving regression is real.
 */
class FakeRedis implements RedisLike {
  private readonly data = new Map<string, string>()
  private readonly expiries = new Map<string, number>()

  async get(key: string): Promise<string | null> {
    this.evict(key)
    return this.data.get(key) ?? null
  }

  async set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null> {
    let nx = false
    let xx = false
    let keepttl = false
    let expiryMs: number | undefined
    for (let i = 0; i < args.length; i++) {
      const flag = String(args[i]).toUpperCase()
      if (flag === 'NX') nx = true
      else if (flag === 'XX') xx = true
      else if (flag === 'KEEPTTL') keepttl = true
      else if (flag === 'EX') expiryMs = Date.now() + Number(args[++i]) * MS
      else if (flag === 'PX') expiryMs = Date.now() + Number(args[++i])
    }
    this.evict(key)
    const exists = this.data.has(key)
    if ((nx && exists) || (xx && !exists)) {
      return null
    }
    this.data.set(key, value)
    if (!keepttl) {
      if (expiryMs !== undefined) this.expiries.set(key, expiryMs)
      else this.expiries.delete(key)
    }
    return 'OK'
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<'OK'> {
    this.data.set(key, value)
    this.expiries.set(key, Date.now() + ttlSeconds * MS)
    return 'OK'
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0
    for (const key of keys) {
      if (this.data.delete(key)) removed += 1
      this.expiries.delete(key)
    }
    return removed
  }

  async ttl(key: string): Promise<number> {
    this.evict(key)
    if (!this.data.has(key)) return -2
    const expiry = this.expiries.get(key)
    if (expiry === undefined) return -1
    return Math.ceil((expiry - Date.now()) / MS)
  }

  async pttl(key: string): Promise<number> {
    this.evict(key)
    if (!this.data.has(key)) return -2
    const expiry = this.expiries.get(key)
    if (expiry === undefined) return -1
    return expiry - Date.now()
  }

  // Synchronous body → atomic, exactly like a real Redis EVAL.
  async eval(_script: string, _numKeys: number, ...args: Array<string | number>): Promise<unknown> {
    const key = String(args[0])
    const now = Number(args[1])
    this.evict(key)
    const raw = this.data.get(key)
    if (raw === undefined) return JSON.stringify({ status: 'not_found' })
    const entry = JSON.parse(raw) as OtpEntry
    if (entry.expiresAt && entry.expiresAt < now) {
      this.data.delete(key)
      this.expiries.delete(key)
      return JSON.stringify({ status: 'not_found' })
    }
    if (entry.attempts >= entry.maxAttempts) {
      this.data.delete(key)
      this.expiries.delete(key)
      return JSON.stringify({ status: 'max_attempts' })
    }
    entry.attempts += 1
    const expiry = this.expiries.get(key)
    this.data.set(key, JSON.stringify(entry))
    if (expiry !== undefined && expiry - now > 0) this.expiries.set(key, expiry)
    else this.expiries.delete(key)
    return JSON.stringify({ status: 'ok', entry })
  }

  /** Test helper — current keys. */
  dump(): string[] {
    return [...this.data.keys()]
  }

  /** Test helper — inject a raw (possibly corrupted) value. */
  seedRaw(key: string, value: string): void {
    this.data.set(key, value)
  }

  private evict(key: string): void {
    const expiry = this.expiries.get(key)
    if (expiry !== undefined && expiry <= Date.now()) {
      this.data.delete(key)
      this.expiries.delete(key)
    }
  }
}

const T = 'tenant_a'
const R = 'jane@acme.com'
const P = 'email_verification'

const makeEntry = (overrides: Partial<OtpEntry> = {}): OtpEntry => ({
  code: '123456',
  expiresAt: Date.now() + 600 * MS,
  attempts: 0,
  maxAttempts: 5,
  ...overrides
})

describe('RedisOtpStorage', () => {
  let redis: FakeRedis
  let storage: RedisOtpStorage

  beforeEach(() => {
    redis = new FakeRedis()
    storage = new RedisOtpStorage({ redisClient: redis })
  })

  // Identity + readiness reflect the injected client.
  it('should report name "redis" and be configured with a client', () => {
    expect(storage.name).toBe('redis')
    expect(storage.isConfigured()).toBe(true)
  })

  // Keys must be namespaced, purpose-scoped, and end in a 64-hex sha256 digest.
  it('should build hashed, PII-free keys', async () => {
    await storage.set(T, R, P, makeEntry())
    const [key] = redis.dump()

    expect(key).toMatch(/^notification:otp:email_verification:[0-9a-f]{64}$/)
    expect(key).not.toContain(R)
    expect(key).not.toContain(T)
  })

  // The namespace prefix is configurable.
  it('should honour a custom namespace', async () => {
    const ns = new RedisOtpStorage({ redisClient: redis, namespace: 'myns' })

    await ns.set(T, R, P, makeEntry())

    expect(redis.dump()[0]).toMatch(/^myns:otp:/)
  })

  // The same recipient under different tenants must map to different keys.
  it('should isolate keys across tenants', async () => {
    await storage.set('tenant_a', R, P, makeEntry())
    await storage.set('tenant_b', R, P, makeEntry())
    const keys = redis.dump()

    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  // set persists via SETEX with a TTL derived from expiresAt.
  it('should set via SETEX with a TTL derived from expiresAt', async () => {
    const setexSpy = jest.spyOn(redis, 'setex')

    await storage.set(T, R, P, makeEntry({ expiresAt: Date.now() + 600 * MS }))

    expect(setexSpy).toHaveBeenCalledWith(expect.stringContaining(':otp:'), 600, expect.any(String))
  })

  // A non-positive remaining TTL is clamped to the 1-second floor.
  it('should clamp the SETEX TTL to a 1-second minimum', async () => {
    const setexSpy = jest.spyOn(redis, 'setex')

    await storage.set(T, R, P, makeEntry({ expiresAt: Date.now() - 5 * MS }))

    expect(setexSpy).toHaveBeenCalledWith(expect.any(String), 1, expect.any(String))
  })

  // consumeAttempt increments the counter by one and preserves the TTL.
  it('should increment attempts and preserve TTL on consumeAttempt', async () => {
    await storage.set(T, R, P, makeEntry({ attempts: 0 }))

    const result = await storage.consumeAttempt(T, R, P)

    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.entry.attempts).toBe(1)
    expect(await redis.pttl(redis.dump()[0] as string)).toBeGreaterThan(0)
  })

  // At the ceiling consumeAttempt deletes the entry and reports max_attempts.
  it('should return max_attempts and delete at the limit', async () => {
    await storage.set(T, R, P, makeEntry({ attempts: 5, maxAttempts: 5 }))

    expect(await storage.consumeAttempt(T, R, P)).toEqual({ status: 'max_attempts' })
    expect(redis.dump()).toHaveLength(0)
  })

  // A missing entry reports not_found.
  it('should return not_found for a missing entry', async () => {
    expect(await storage.consumeAttempt(T, R, P)).toEqual({ status: 'not_found' })
  })

  // An entry whose expiresAt has lapsed reports not_found and is deleted.
  it('should return not_found and delete an expired entry', async () => {
    await storage.set(T, R, P, makeEntry({ expiresAt: Date.now() - 5 * MS }))

    expect(await storage.consumeAttempt(T, R, P)).toEqual({ status: 'not_found' })
    expect(redis.dump()).toHaveLength(0)
  })

  // The maxAttempts limit must hold under concurrent verification.
  it('should never exceed maxAttempts under interleaved consumeAttempt', async () => {
    await storage.set(T, R, P, makeEntry({ attempts: 0, maxAttempts: 3 }))

    const results = await Promise.all(
      Array.from({ length: 6 }, () => storage.consumeAttempt(T, R, P))
    )
    const okCount = results.filter((r) => r.status === 'ok').length

    expect(okCount).toBe(3)
  })

  // update must use SET … KEEPTTL XX so the TTL survives and the key is not resurrected.
  it('should update via SET KEEPTTL XX and preserve TTL', async () => {
    await storage.set(T, R, P, makeEntry())
    const key = redis.dump()[0] as string
    const ttlBefore = await redis.pttl(key)
    const setSpy = jest.spyOn(redis, 'set')

    await storage.update(T, R, P, makeEntry({ validated: true }))

    expect(setSpy).toHaveBeenCalledWith(key, expect.any(String), 'KEEPTTL', 'XX')
    expect(await redis.pttl(key)).toBeGreaterThan(0)
    expect(await redis.pttl(key)).toBeLessThanOrEqual(ttlBefore)
  })

  // update on an evicted key must not recreate it (the XX flag).
  it('should not resurrect an evicted entry on update', async () => {
    await storage.set(T, R, P, makeEntry())
    await storage.delete(T, R, P)

    await storage.update(T, R, P, makeEntry({ validated: true }))

    expect(await storage.get(T, R, P)).toBeNull()
  })

  // get returns null for a missing key.
  it('should return null from get for a missing key', async () => {
    expect(await storage.get(T, R, P)).toBeNull()
  })

  // get returns the parsed entry for a stored key.
  it('should return the parsed entry from get', async () => {
    await storage.set(T, R, P, makeEntry({ code: 'ZZZZZZ' }))

    expect((await storage.get(T, R, P))?.code).toBe('ZZZZZZ')
  })

  // Corrupted JSON is self-healed: the key is deleted and null is returned.
  it('should delete corrupted JSON and return null', async () => {
    await storage.set(T, R, P, makeEntry())
    redis.seedRaw(redis.dump()[0] as string, 'not-json{')

    expect(await storage.get(T, R, P)).toBeNull()
    expect(redis.dump()).toHaveLength(0)
  })

  // tryAcquireCooldown must use SET … NX EX and win only once while active.
  it('should acquire the cooldown via SET NX EX then refuse', async () => {
    const setSpy = jest.spyOn(redis, 'set')

    const first = await storage.tryAcquireCooldown(T, R, P, 60)
    const second = await storage.tryAcquireCooldown(T, R, P, 60)

    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(setSpy).toHaveBeenCalledWith(expect.stringContaining(':otp_cd:'), '1', 'EX', 60, 'NX')
  })

  // getCooldown is 0 when the key is absent and the remaining seconds otherwise.
  it('should report cooldown seconds and 0 when absent', async () => {
    expect(await storage.getCooldown(T, R, P)).toBe(0)

    await storage.tryAcquireCooldown(T, R, P, 60)

    expect(await storage.getCooldown(T, R, P)).toBeGreaterThan(0)
  })

  // clearCooldown deletes the cooldown key so the next acquire wins.
  it('should clear the cooldown key', async () => {
    await storage.tryAcquireCooldown(T, R, P, 60)

    await storage.clearCooldown(T, R, P)

    expect(await storage.getCooldown(T, R, P)).toBe(0)
    expect(await storage.tryAcquireCooldown(T, R, P, 60)).toBe(true)
  })

  // delete never throws for a missing key.
  it('should treat delete as idempotent', async () => {
    await expect(storage.delete(T, R, P)).resolves.toBeUndefined()
  })
})
