/**
 * @fileoverview In-memory `IOtpStorage` for development and unit tests.
 * @layer infrastructure
 *
 * Backed by two native `Map`s. It is atomic by construction: `consumeAttempt`
 * performs its read → checks → increment → write with NO `await` in between, so
 * Node's single-threaded event loop cannot interleave two calls and overshoot
 * `maxAttempts`.
 *
 * DO NOT USE IN MULTI-INSTANCE PRODUCTION — entries live in the process memory
 * and are not shared across instances; use `RedisOtpStorage` there.
 */

import { Injectable } from '@nestjs/common'

import type {
  ConsumeAttemptResult,
  IOtpStorage,
  OtpEntry
} from '../interfaces/otp-storage.interface'

/** Number of milliseconds in one second. */
const MS_PER_SECOND = 1000

/** Aggregate sizes of the two internal maps — exposed by the {@link InMemoryOtpStorage.size} helper. */
export interface InMemoryStorageSize {
  otps: number
  cooldowns: number
}

/** Process-local `IOtpStorage` for dev/test. */
@Injectable()
export class InMemoryOtpStorage implements IOtpStorage {
  readonly name = 'memory'
  /** OTP entries keyed by `${tenantId}::${recipient}::${purpose}`. */
  private readonly store = new Map<string, OtpEntry>()
  /** Cooldown expiries (epoch ms) keyed by the same composite key. */
  private readonly cooldowns = new Map<string, number>()

  /** Always ready — there is nothing to configure.
   *
   * @returns `true`.
   */
  isConfigured(): boolean {
    return true
  }

  /**
   * Creates or replaces an OTP entry.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @param entry - The entry to persist.
   */
  async set(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void> {
    this.store.set(this.key(tenantId, recipient, purpose), entry)
  }

  /**
   * Reads an entry, self-evicting it when its TTL has lapsed.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @returns The entry, or `null` when absent or expired.
   */
  async get(tenantId: string, recipient: string, purpose: string): Promise<OtpEntry | null> {
    const key = this.key(tenantId, recipient, purpose)
    const entry = this.store.get(key)
    if (!entry) {
      return null
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return null
    }
    return entry
  }

  /**
   * Atomic verification primitive — read → expiry/max checks → increment → write,
   * with no `await` between read and write.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @returns `not_found` (missing/expired), `max_attempts` (ceiling reached, entry
   * deleted), or `ok` with the entry whose `attempts` was incremented by one.
   */
  async consumeAttempt(
    tenantId: string,
    recipient: string,
    purpose: string
  ): Promise<ConsumeAttemptResult> {
    const key = this.key(tenantId, recipient, purpose)
    const entry = this.store.get(key)
    if (!entry) {
      return { status: 'not_found' }
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key)
      return { status: 'not_found' }
    }
    if (entry.attempts >= entry.maxAttempts) {
      this.store.delete(key)
      return { status: 'max_attempts' }
    }
    entry.attempts += 1
    this.store.set(key, entry)
    return { status: 'ok', entry }
  }

  /**
   * Updates an existing entry; a no-op when the key is absent (no resurrection).
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
    const key = this.key(tenantId, recipient, purpose)
    if (this.store.has(key)) {
      this.store.set(key, entry)
    }
  }

  /**
   * Removes the OTP entry. Idempotent.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   */
  async delete(tenantId: string, recipient: string, purpose: string): Promise<void> {
    this.store.delete(this.key(tenantId, recipient, purpose))
  }

  /**
   * Acquires the cooldown lock only when one is not already active.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @param ttlSeconds - Cooldown duration in seconds.
   * @returns `true` when acquired, `false` when a cooldown is already active.
   */
  async tryAcquireCooldown(
    tenantId: string,
    recipient: string,
    purpose: string,
    ttlSeconds: number
  ): Promise<boolean> {
    const key = this.key(tenantId, recipient, purpose)
    const existing = this.cooldowns.get(key)
    if (existing && existing > Date.now()) {
      return false
    }
    this.cooldowns.set(key, Date.now() + ttlSeconds * MS_PER_SECOND)
    return true
  }

  /**
   * Remaining cooldown in seconds, self-evicting a lapsed cooldown.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   * @returns Remaining seconds, or `0` when there is no active cooldown.
   */
  async getCooldown(tenantId: string, recipient: string, purpose: string): Promise<number> {
    const key = this.key(tenantId, recipient, purpose)
    const expiry = this.cooldowns.get(key)
    if (!expiry) {
      return 0
    }
    const remaining = Math.ceil((expiry - Date.now()) / MS_PER_SECOND)
    if (remaining <= 0) {
      this.cooldowns.delete(key)
      return 0
    }
    return remaining
  }

  /**
   * Clears the cooldown. Idempotent.
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier.
   * @param purpose - OTP purpose.
   */
  async clearCooldown(tenantId: string, recipient: string, purpose: string): Promise<void> {
    this.cooldowns.delete(this.key(tenantId, recipient, purpose))
  }

  /**
   * Test helper — wipes all entries and cooldowns. Not part of `IOtpStorage`.
   */
  clear(): void {
    this.store.clear()
    this.cooldowns.clear()
  }

  /**
   * Test helper — current map sizes. Not part of `IOtpStorage`.
   *
   * @returns The number of stored OTP entries and active cooldowns.
   */
  size(): InMemoryStorageSize {
    return { otps: this.store.size, cooldowns: this.cooldowns.size }
  }

  /** Collapses the `(tenantId, recipient, purpose)` tuple into one map key. */
  private key(tenantId: string, recipient: string, purpose: string): string {
    return `${tenantId}::${recipient}::${purpose}`
  }
}
