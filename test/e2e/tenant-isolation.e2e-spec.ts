/**
 * @fileoverview End-to-end regression suite proving multi-tenant isolation.
 * @layer test
 *
 * Two tenants sharing the same recipient must never collide: OTP codes are
 * independent, cooldowns are independent, and one tenant can never verify the
 * other's code. The Redis backend additionally proves that storage keys carry
 * only the `sha256(tenantId:recipient)` digest — never the plaintext recipient
 * or tenant id — so an operator with `KEYS` access cannot enumerate recipients
 * and a cross-tenant key collision is computationally infeasible.
 */

import { Test } from '@nestjs/testing'

import {
  BymaxNotificationModule,
  InMemoryOtpStorage,
  NoOpEmailProvider,
  OtpService,
  RedisOtpStorage
} from '@bymax-one/nest-notification'
import type { RedisLike } from '@bymax-one/nest-notification'

const RECIPIENT = 'maria@x.com'
const PURPOSE = 'email_verification'

/**
 * Minimal Redis double that records every written key so the suite can assert
 * the key shape. Only `setex` is exercised by `RedisOtpStorage.set`; the
 * remaining `RedisLike` members are present to satisfy the structural contract.
 */
class CapturingRedis implements RedisLike {
  private readonly entries = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.entries.set(key, value)
    return 'OK'
  }

  async setex(key: string, _ttlSeconds: number, value: string): Promise<'OK'> {
    this.entries.set(key, value)
    return 'OK'
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0
    for (const key of keys) {
      if (this.entries.delete(key)) {
        removed += 1
      }
    }
    return removed
  }

  async ttl(): Promise<number> {
    return -2
  }

  async pttl(): Promise<number> {
    return -2
  }

  async eval(): Promise<unknown> {
    return null
  }

  /** Returns every recorded key — a test-only enumerator (not part of `RedisLike`). */
  recordedKeys(): string[] {
    return [...this.entries.keys()]
  }
}

describe('Tenant isolation (E2E)', () => {
  describe('InMemoryOtpStorage', () => {
    let otpService: OtpService
    let storage: InMemoryOtpStorage

    beforeEach(async () => {
      storage = new InMemoryOtpStorage()
      const moduleRef = await Test.createTestingModule({
        imports: [
          BymaxNotificationModule.forRoot({
            email: { provider: new NoOpEmailProvider(), defaultFrom: 'noreply@acme.com' },
            otp: { storage }
          })
        ]
      }).compile()
      otpService = moduleRef.get(OtpService)
    })

    // Same recipient under two tenants yields two independent, different codes.
    it('issues independent codes per tenant for the same recipient', async () => {
      const a = await otpService.generate({
        tenantId: 'tenant_a',
        recipient: RECIPIENT,
        purpose: PURPOSE,
        deliverVia: 'manual'
      })
      const b = await otpService.generate({
        tenantId: 'tenant_b',
        recipient: RECIPIENT,
        purpose: PURPOSE,
        deliverVia: 'manual'
      })

      expect(a.expiresAt).toBeGreaterThan(0)
      expect(b.expiresAt).toBeGreaterThan(0)

      const entryA = await storage.get('tenant_a', RECIPIENT, PURPOSE)
      const entryB = await storage.get('tenant_b', RECIPIENT, PURPOSE)
      expect(entryA?.code).not.toBe(entryB?.code)
    })

    // tenant_b's cooldown lock must not block tenant_a generating for the same recipient.
    it('does not collide cooldowns across tenants', async () => {
      await otpService.generate({
        tenantId: 'tenant_a',
        recipient: RECIPIENT,
        purpose: PURPOSE,
        deliverVia: 'manual'
      })

      // tenant_b is unaffected by tenant_a's freshly acquired cooldown lock.
      await expect(
        otpService.generate({
          tenantId: 'tenant_b',
          recipient: RECIPIENT,
          purpose: PURPOSE,
          deliverVia: 'manual'
        })
      ).resolves.toMatchObject({ expiresAt: expect.any(Number) })
    })

    // A code minted for tenant_a must read as not_found when tenant_b presents it.
    it('does not leak verification across tenants', async () => {
      await otpService.generate({
        tenantId: 'tenant_a',
        recipient: RECIPIENT,
        purpose: PURPOSE,
        deliverVia: 'manual'
      })
      const entryA = await storage.get('tenant_a', RECIPIENT, PURPOSE)

      const result = await otpService.verify({
        tenantId: 'tenant_b',
        recipient: RECIPIENT,
        purpose: PURPOSE,
        code: entryA?.code ?? ''
      })

      expect(result).toEqual({ valid: false, reason: 'not_found' })
    })
  })

  describe('RedisOtpStorage key hashing', () => {
    // Persisted keys must expose neither the recipient nor the tenant id in plaintext.
    it('stores only hex-encoded sha256 keys (no PII)', async () => {
      const redis = new CapturingRedis()
      const storage = new RedisOtpStorage({ redisClient: redis })

      await storage.set('tenant_a', RECIPIENT, PURPOSE, {
        code: '123456',
        expiresAt: Date.now() + 60_000,
        attempts: 0,
        maxAttempts: 5
      })

      const keys = redis.recordedKeys()
      expect(keys).not.toHaveLength(0)
      for (const key of keys) {
        expect(key).not.toContain(RECIPIENT)
        expect(key).not.toContain('tenant_a')
        // The digest segment is 64 lowercase hex characters.
        expect(key).toMatch(/:[0-9a-f]{64}$/)
      }
    })
  })
})
