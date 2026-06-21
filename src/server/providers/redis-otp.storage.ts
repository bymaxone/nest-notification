/**
 * @fileoverview Production `IOtpStorage` backed by Redis.
 * @layer infrastructure
 *
 * The default OTP backend for multi-instance SaaS. Two security-critical
 * guarantees live here:
 *
 * 1. **Atomic attempt counting** — `consumeAttempt` runs its whole
 *    read → expiry/max check → increment → write sequence inside ONE Lua script
 *    (`EVAL`), so concurrent verifications cannot interleave and overshoot
 *    `maxAttempts`.
 * 2. **PII-free keys** — every key carries `sha256(tenantId:recipient)`, never the
 *    plaintext email/phone, so an operator with `KEYS` access cannot enumerate
 *    recipients, and a cross-tenant key collision is computationally infeasible.
 *
 * `ioredis` is an OPTIONAL peer dependency: this class forward-declares the slim
 * {@link RedisLike} surface it needs (including `eval`/`pttl`) instead of importing
 * `ioredis` types, so a consumer on a different backend never pays for it.
 */

import { Injectable } from '@nestjs/common'

import type {
  ConsumeAttemptResult,
  IOtpStorage,
  OtpEntry
} from '../interfaces/otp-storage.interface'
import { hashTenantRecipient } from '../utils/hash'

/** The slim Redis surface {@link RedisOtpStorage} relies on (ioredis is structurally compatible). */
export interface RedisLike {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ...args: Array<string | number>): Promise<'OK' | null>
  setex(key: string, ttlSeconds: number, value: string): Promise<'OK'>
  del(...keys: string[]): Promise<number>
  ttl(key: string): Promise<number>
  /** Millisecond TTL — read inside the Lua script to preserve the original expiry on rewrite. */
  pttl(key: string): Promise<number>
  /** Evaluates a Lua script atomically — used for the `consumeAttempt` primitive. */
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>
}

/** Construction options for {@link RedisOtpStorage}. */
export interface RedisOtpStorageOptions {
  /** ioredis (or structurally compatible) client supplied by the consumer. */
  redisClient: RedisLike
  /** Key namespace prefix. Default: `'notification'`. */
  namespace?: string
}

/** Default millisecond-to-second divisor for TTL math. */
const MS_PER_SECOND = 1000

/** Redis-backed `IOtpStorage` with atomic Lua attempt counting and NX cooldown locking. */
@Injectable()
export class RedisOtpStorage implements IOtpStorage {
  readonly name = 'redis'
  private readonly redis: RedisLike
  private readonly namespace: string

  /**
   * @param options - The Redis client and optional namespace.
   */
  constructor(options: RedisOtpStorageOptions) {
    this.redis = options.redisClient
    this.namespace = options.namespace ?? 'notification'
  }

  /**
   * Atomic verify primitive. The entire read → expiry/max check → increment → write
   * runs in this single script, so concurrent calls cannot overshoot `maxAttempts`.
   * `PTTL` is read inside the script to preserve the original expiry on rewrite.
   */
  // Stryker disable next-line StringLiteral: the Lua body executes only on a real Redis server; unit tests drive a JS fake whose `eval` ignores the script text, so an emptied-string mutant is unkillable without a live Redis integration run.
  private static readonly CONSUME_ATTEMPT_LUA = `
    local raw = redis.call('GET', KEYS[1])
    if not raw then return cjson.encode({ status = 'not_found' }) end
    local entry = cjson.decode(raw)
    if entry.expiresAt and tonumber(entry.expiresAt) < tonumber(ARGV[1]) then
      redis.call('DEL', KEYS[1])
      return cjson.encode({ status = 'not_found' })
    end
    if entry.attempts >= entry.maxAttempts then
      redis.call('DEL', KEYS[1])
      return cjson.encode({ status = 'max_attempts' })
    end
    entry.attempts = entry.attempts + 1
    local ttl = redis.call('PTTL', KEYS[1])
    if ttl and ttl > 0 then
      redis.call('SET', KEYS[1], cjson.encode(entry), 'PX', ttl)
    else
      redis.call('SET', KEYS[1], cjson.encode(entry))
    end
    return cjson.encode({ status = 'ok', entry = entry })
  `

  /** Whether a Redis client was supplied.
   *
   * @returns `true` when a client is present.
   */
  isConfigured(): boolean {
    return Boolean(this.redis)
  }

  /**
   * Creates or replaces an OTP entry with a TTL derived from `expiresAt`.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @param entry - The entry to persist.
   */
  async set(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void> {
    const ttlSeconds = Math.max(1, Math.ceil((entry.expiresAt - Date.now()) / MS_PER_SECOND))
    await this.redis.setex(
      this.otpKey(tenantId, recipient, purpose),
      ttlSeconds,
      JSON.stringify(entry)
    )
  }

  /**
   * Reads an entry, deleting and returning `null` for corrupted JSON.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @returns The parsed entry, or `null` when absent/corrupted.
   */
  async get(tenantId: string, recipient: string, purpose: string): Promise<OtpEntry | null> {
    const raw = await this.redis.get(this.otpKey(tenantId, recipient, purpose))
    if (!raw) {
      return null
    }
    try {
      return JSON.parse(raw) as OtpEntry
    } catch {
      await this.delete(tenantId, recipient, purpose)
      return null
    }
  }

  /**
   * Atomic verification primitive (single `EVAL`).
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @returns `not_found`, `max_attempts`, or `ok` with the incremented entry.
   */
  async consumeAttempt(
    tenantId: string,
    recipient: string,
    purpose: string
  ): Promise<ConsumeAttemptResult> {
    const raw = (await this.redis.eval(
      RedisOtpStorage.CONSUME_ATTEMPT_LUA,
      1,
      this.otpKey(tenantId, recipient, purpose),
      Date.now().toString()
    )) as string
    return JSON.parse(raw) as ConsumeAttemptResult
  }

  /**
   * Updates an entry with `SET … KEEPTTL XX` — preserves the TTL and never
   * resurrects an already-expired key.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @param entry - The replacement entry.
   */
  async update(
    tenantId: string,
    recipient: string,
    purpose: string,
    entry: OtpEntry
  ): Promise<void> {
    await this.redis.set(
      this.otpKey(tenantId, recipient, purpose),
      JSON.stringify(entry),
      'KEEPTTL',
      'XX'
    )
  }

  /**
   * Removes the OTP entry. Idempotent.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   */
  async delete(tenantId: string, recipient: string, purpose: string): Promise<void> {
    await this.redis.del(this.otpKey(tenantId, recipient, purpose))
  }

  /**
   * Atomic cooldown acquire with `SET … NX EX` — only the first concurrent caller wins.
   *
   * A non-positive `ttlSeconds` means "no resend cooldown is configured". Redis rejects
   * `SET … EX 0` with `ERR invalid expire time`, so this short-circuits: it never issues
   * the `SET`, clears any stale cooldown key, and reports success (there is nothing to
   * lock, so the caller is always free to proceed).
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @param ttlSeconds - Cooldown duration in seconds; `<= 0` means no cooldown.
   * @returns `true` when acquired (or when no cooldown applies), `false` when a cooldown is already active.
   */
  async tryAcquireCooldown(
    tenantId: string,
    recipient: string,
    purpose: string,
    ttlSeconds: number
  ): Promise<boolean> {
    const key = this.cooldownKey(tenantId, recipient, purpose)
    if (ttlSeconds <= 0) {
      await this.redis.del(key)
      return true
    }
    const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX')
    return result === 'OK'
  }

  /**
   * Remaining cooldown in seconds.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @returns Remaining seconds, or `0` when there is no active cooldown.
   */
  async getCooldown(tenantId: string, recipient: string, purpose: string): Promise<number> {
    const ttl = await this.redis.ttl(this.cooldownKey(tenantId, recipient, purpose))
    // Stryker disable next-line EqualityOperator: Redis TTL returns a positive integer (whole seconds remaining), 0 (a key expiring in under a second), -1 (key with no expiry), or -2 (no such key). The `ttl >= 0` mutant is equivalent: it diverges from `ttl > 0` only at ttl === 0, where the then-branch returns `ttl` (which is 0) and the else-branch returns the literal 0 — the same observable value. Every positive value takes the then-branch (returns `ttl`); -1 and -2 take the else-branch (return 0). So the result is identical for every value in {positive, 0, -1, -2}.
    return ttl > 0 ? ttl : 0
  }

  /**
   * Clears the cooldown key. Idempotent.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   */
  async clearCooldown(tenantId: string, recipient: string, purpose: string): Promise<void> {
    await this.redis.del(this.cooldownKey(tenantId, recipient, purpose))
  }

  /** Builds the OTP entry key: `{namespace}:otp:{purpose}:{sha256(tenantId:recipient)}`. */
  private otpKey(tenantId: string, recipient: string, purpose: string): string {
    return `${this.namespace}:otp:${purpose}:${hashTenantRecipient(tenantId, recipient)}`
  }

  /** Builds the cooldown key: `{namespace}:otp_cd:{purpose}:{sha256(tenantId:recipient)}`. */
  private cooldownKey(tenantId: string, recipient: string, purpose: string): string {
    return `${this.namespace}:otp_cd:${purpose}:${hashTenantRecipient(tenantId, recipient)}`
  }
}
