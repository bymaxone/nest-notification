import type { OtpEntry } from '../interfaces/otp-storage.interface'

import { InMemoryOtpStorage } from './in-memory-otp.storage'

const T = 'tenant_a'
const R = 'jane@acme.com'
const P = 'email_verification'

const makeEntry = (overrides: Partial<OtpEntry> = {}): OtpEntry => ({
  code: '123456',
  expiresAt: Date.now() + 60_000,
  attempts: 0,
  maxAttempts: 5,
  ...overrides
})

describe('InMemoryOtpStorage', () => {
  let storage: InMemoryOtpStorage

  beforeEach(() => {
    storage = new InMemoryOtpStorage()
  })

  // Identity + readiness are fixed for the in-memory backend.
  it('should report name "memory" and always be configured', () => {
    expect(storage.name).toBe('memory')
    expect(storage.isConfigured()).toBe(true)
  })

  // A round-trip set/get must return the very entry that was stored.
  it('should set and get an entry unchanged', async () => {
    const entry = makeEntry()
    await storage.set(T, R, P, entry)

    expect(await storage.get(T, R, P)).toBe(entry)
  })

  // A missing key reads as null without touching state.
  it('should return null from get for a missing entry', async () => {
    expect(await storage.get(T, R, P)).toBeNull()
  })

  // An expired entry is self-evicted on read (no manual GC).
  it('should self-evict an expired entry on get', async () => {
    await storage.set(T, R, P, makeEntry({ expiresAt: Date.now() - 1 }))

    expect(await storage.get(T, R, P)).toBeNull()
    expect(storage.size().otps).toBe(0)
  })

  // consumeAttempt on a missing entry reports not_found.
  it('should return not_found from consumeAttempt for a missing entry', async () => {
    expect(await storage.consumeAttempt(T, R, P)).toEqual({ status: 'not_found' })
  })

  // consumeAttempt on an expired entry reports not_found and deletes it.
  it('should return not_found and delete an expired entry on consumeAttempt', async () => {
    await storage.set(T, R, P, makeEntry({ expiresAt: Date.now() - 1 }))

    expect(await storage.consumeAttempt(T, R, P)).toEqual({ status: 'not_found' })
    expect(storage.size().otps).toBe(0)
  })

  // The attempt counter increments by exactly one on a consumed attempt.
  it('should increment attempts by one and return ok', async () => {
    await storage.set(T, R, P, makeEntry({ attempts: 0 }))

    const result = await storage.consumeAttempt(T, R, P)

    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.entry.attempts).toBe(1)
  })

  // At the ceiling the entry is deleted and reported as max_attempts.
  it('should return max_attempts and delete the entry at the limit', async () => {
    await storage.set(T, R, P, makeEntry({ attempts: 5, maxAttempts: 5 }))

    expect(await storage.consumeAttempt(T, R, P)).toEqual({ status: 'max_attempts' })
    expect(storage.size().otps).toBe(0)
  })

  // update replaces an existing entry while preserving the key.
  it('should replace an existing entry on update', async () => {
    await storage.set(T, R, P, makeEntry())
    const replacement = makeEntry({ validated: true })

    await storage.update(T, R, P, replacement)

    expect(await storage.get(T, R, P)).toBe(replacement)
  })

  // update on a missing key is a no-op — it must not resurrect an evicted entry.
  it('should be a no-op when updating a missing key', async () => {
    await storage.update(T, R, P, makeEntry())

    expect(await storage.get(T, R, P)).toBeNull()
    expect(storage.size().otps).toBe(0)
  })

  // delete never throws, even for a key that does not exist.
  it('should treat delete as idempotent', async () => {
    await expect(storage.delete(T, R, P)).resolves.toBeUndefined()
    await storage.set(T, R, P, makeEntry())
    await storage.delete(T, R, P)

    expect(await storage.get(T, R, P)).toBeNull()
  })

  // The cooldown lock is acquired once and refused while active.
  it('should acquire the cooldown first then refuse while active', async () => {
    expect(await storage.tryAcquireCooldown(T, R, P, 60)).toBe(true)
    expect(await storage.tryAcquireCooldown(T, R, P, 60)).toBe(false)
    expect(await storage.getCooldown(T, R, P)).toBeGreaterThan(0)
  })

  // getCooldown is 0 when no cooldown was ever set.
  it('should return 0 cooldown when none is active', async () => {
    expect(await storage.getCooldown(T, R, P)).toBe(0)
  })

  // A lapsed cooldown reads as 0 and is evicted; a fresh acquire then succeeds.
  it('should evict a lapsed cooldown and allow re-acquire', async () => {
    await storage.tryAcquireCooldown(T, R, P, 0) // expires immediately

    expect(await storage.getCooldown(T, R, P)).toBe(0)
    expect(storage.size().cooldowns).toBe(0)
    expect(await storage.tryAcquireCooldown(T, R, P, 0)).toBe(true)
  })

  // clearCooldown removes an active cooldown so the next acquire wins.
  it('should clear an active cooldown', async () => {
    await storage.tryAcquireCooldown(T, R, P, 60)

    await storage.clearCooldown(T, R, P)

    expect(await storage.tryAcquireCooldown(T, R, P, 60)).toBe(true)
  })

  // The composite key must isolate distinct tenants, recipients, and purposes.
  it('should keep distinct tuples from colliding', async () => {
    await storage.set(T, R, P, makeEntry({ code: 'AAAAAA' }))
    await storage.set('tenant_b', R, P, makeEntry({ code: 'BBBBBB' }))
    await storage.set(T, 'john@acme.com', P, makeEntry({ code: 'CCCCCC' }))
    await storage.set(T, R, 'password_reset', makeEntry({ code: 'DDDDDD' }))

    expect((await storage.get(T, R, P))?.code).toBe('AAAAAA')
    expect((await storage.get('tenant_b', R, P))?.code).toBe('BBBBBB')
    expect((await storage.get(T, 'john@acme.com', P))?.code).toBe('CCCCCC')
    expect((await storage.get(T, R, 'password_reset'))?.code).toBe('DDDDDD')
    expect(storage.size().otps).toBe(4)
  })

  // The clear() helper zeroes both maps.
  it('should wipe all state with the clear helper', async () => {
    await storage.set(T, R, P, makeEntry())
    await storage.tryAcquireCooldown(T, R, P, 60)

    storage.clear()

    expect(storage.size()).toEqual({ otps: 0, cooldowns: 0 })
  })
})

// Time-sensitive boundaries and arithmetic, exercised under a frozen clock so the
// exact-equality and *-vs-/ mutants on expiry/cooldown math are observable.
describe('InMemoryOtpStorage — time boundaries', () => {
  let storage: InMemoryOtpStorage

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(1_000_000)
    storage = new InMemoryOtpStorage()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // An entry whose expiry is EXACTLY now is still live — `expiresAt < now` keeps it,
  // pinning the `< now` -> `<= now` mutant (which would evict it) for get().
  it('should keep an entry whose expiry equals now on get', async () => {
    await storage.set(T, R, P, makeEntry({ expiresAt: Date.now() }))

    expect(await storage.get(T, R, P)).not.toBeNull()
  })

  // Same boundary for consumeAttempt: an entry expiring exactly now is consumable.
  it('should consume an entry whose expiry equals now', async () => {
    await storage.set(T, R, P, makeEntry({ expiresAt: Date.now(), attempts: 0, maxAttempts: 5 }))

    expect(await storage.consumeAttempt(T, R, P)).toMatchObject({ status: 'ok' })
  })

  // A cooldown whose expiry equals now is NOT active — `existing > now` lets the next
  // acquire succeed, pinning the `> now` -> `>= now` mutant on tryAcquireCooldown.
  it('should allow re-acquire when an existing cooldown expires exactly now', async () => {
    await storage.tryAcquireCooldown(T, R, P, 10)
    jest.setSystemTime(1_000_000 + 10_000) // advance to the exact expiry instant

    expect(await storage.tryAcquireCooldown(T, R, P, 10)).toBe(true)
  })

  // getCooldown returns the remaining whole seconds — pins the `ttl * 1000` (acquire)
  // and `(expiry - now) / 1000` (read) arithmetic so a swapped operator (which would
  // yield a near-zero or huge number) is caught by the exact value.
  it('should report the remaining cooldown in whole seconds', async () => {
    await storage.tryAcquireCooldown(T, R, P, 45)

    expect(await storage.getCooldown(T, R, P)).toBe(45)
  })
})
