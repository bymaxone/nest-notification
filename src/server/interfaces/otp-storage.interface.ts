/**
 * @fileoverview OTP storage contract (`IOtpStorage`) — the core security surface.
 * @layer domain
 *
 * Single persistence interface for all OTP state. This interface DISSOLVES the
 * Prisma coupling that a typical consumer's hand-rolled OTP store would otherwise
 * impose: the library never imports the Prisma client (nor any ORM) — every
 * consumer plugs in their own storage (Redis, in-memory, …).
 */

/** A stored OTP entry. */
export interface OtpEntry {
  /** Plaintext OTP code. Never logged. */
  code: string
  /** Expiration as a Unix timestamp in milliseconds. */
  expiresAt: number
  /** Number of verification attempts made so far. */
  attempts: number
  /** Maximum attempts before the entry is invalidated. */
  maxAttempts: number
  /** Whether the OTP has already been successfully verified (not yet deleted). */
  validated?: boolean
  /** Optional caller metadata — ignored by the library. */
  metadata?: Record<string, unknown>
}

/**
 * Result of the atomic {@link IOtpStorage.consumeAttempt} primitive.
 *
 * - `not_found` — no entry, or it expired (the two are indistinguishable once the TTL lapses).
 * - `max_attempts` — the attempt ceiling was already reached; the entry is deleted.
 * - `ok` — an attempt was consumed; `entry` carries the updated entry (incl. the stored `code`).
 */
export type ConsumeAttemptResult =
  { status: 'not_found' } | { status: 'max_attempts' } | { status: 'ok'; entry: OtpEntry }

/**
 * Outcome of a verification, as returned by `OtpService.verify()`.
 *
 * Note: an expired entry is reported as `not_found` — once a code's TTL lapses the
 * entry is gone, so "missing" and "expired" are indistinguishable at the storage
 * layer, and the catalog recommends not leaking the difference to the client.
 */
export type OtpVerifyResult =
  | { valid: true }
  | { valid: false; reason: 'not_found' }
  | { valid: false; reason: 'max_attempts' }
  | { valid: false; reason: 'invalid_code'; remainingAttempts: number }

/**
 * OTP storage.
 *
 * Implementations MUST:
 * - make `consumeAttempt` **atomic** — the lookup + attempt increment is a single
 *   indivisible operation (Redis: a Lua script; in-memory: one synchronous
 *   read-modify-write). A plain `get`+`update` races and lets the `maxAttempts`
 *   brute-force limit be bypassed under concurrency;
 * - make `tryAcquireCooldown` **atomic** — a check-and-set in one step (Redis:
 *   `SET NX EX`), so two concurrent generate/resend calls cannot both pass;
 * - apply TTL — expired entries must not be returned by `get` / `consumeAttempt`;
 * - scope keys by `(tenantId, recipient, purpose)` without cross-tenant collision;
 * - never expose OTP codes in plaintext logs.
 *
 * The library does NOT normalize `recipient`: callers must pass a canonical value
 * (e.g. `email.trim().toLowerCase()`); `'A@x.com'` and `'a@x.com'` map to distinct keys.
 */
export interface IOtpStorage {
  /**
   * Creates or replaces an OTP entry (with its own TTL).
   *
   * @param tenantId - Tenant isolation scope.
   * @param recipient - Pre-normalized recipient identifier (email, phone, userId — caller decides).
   * @param purpose - OTP purpose (e.g. `'email_verification'`).
   * @param entry - The entry to persist.
   */
  set(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void>

  /**
   * Reads an OTP entry. Returns `null` if it does not exist or has expired.
   * Read-only — used by `getStatus()`. Verification MUST go through `consumeAttempt`.
   */
  get(tenantId: string, recipient: string, purpose: string): Promise<OtpEntry | null>

  /**
   * Atomic verification primitive — in one indivisible step: returns `not_found`
   * when absent/expired; deletes the entry and returns `max_attempts` when the
   * ceiling is reached; otherwise increments `attempts` (preserving TTL) and
   * returns `ok` with the updated entry. The caller then constant-time-compares
   * the guessed code against `entry.code`.
   *
   * MUST be atomic.
   */
  consumeAttempt(
    tenantId: string,
    recipient: string,
    purpose: string
  ): Promise<ConsumeAttemptResult>

  /**
   * Updates an existing entry, preserving its remaining TTL. A no-op if the entry
   * is gone (TTL expired). Used to mark `validated` / write `metadata` after a
   * successful verify — never for the attempt counter (that is `consumeAttempt`).
   */
  update(tenantId: string, recipient: string, purpose: string, entry: OtpEntry): Promise<void>

  /** Removes the OTP entry. Idempotent. */
  delete(tenantId: string, recipient: string, purpose: string): Promise<void>

  /**
   * Atomic cooldown acquire for `(tenant, recipient, purpose)`. Sets the cooldown
   * key only if it does not already exist (Redis: `SET NX EX`). Returns `true`
   * when acquired, `false` when a cooldown is already active. Acts as a
   * short-lived lock around generate/resend.
   *
   * MUST be atomic.
   *
   * @param ttlSeconds - Cooldown duration in seconds.
   */
  tryAcquireCooldown(
    tenantId: string,
    recipient: string,
    purpose: string,
    ttlSeconds: number
  ): Promise<boolean>

  /** Remaining cooldown in seconds, or `0` when there is no active cooldown. */
  getCooldown(tenantId: string, recipient: string, purpose: string): Promise<number>

  /**
   * Clears the cooldown for `(tenant, recipient, purpose)`. Idempotent. Called when
   * a delivery fails (so the user is not locked out) and on `consume()` (so a
   * cancelled flow can restart immediately).
   */
  clearCooldown(tenantId: string, recipient: string, purpose: string): Promise<void>

  /**
   * Optional. Failed verifications recorded for `(tenant, recipient, purpose)`, or `0`.
   *
   * Together with {@link IOtpStorage.recordFailure} and {@link IOtpStorage.clearFailures} this
   * makes the failed-attempt count outlive a code: NIST SP 800-63B-4 §3.1.3.2 says generating a
   * new authentication secret "SHALL NOT reset the failed authentication count". `OtpService`
   * refuses a verification once this count reaches the attempt ceiling. A storage that omits all three keeps a fresh
   * budget per code, and a warning at startup names the deviation.
   */
  getFailures?(tenantId: string, recipient: string, purpose: string): Promise<number>

  /**
   * Optional. Atomically adds one failed verification and (re)sets the counter's lifetime to
   * `ttlSeconds`, returning the new count. A counter that is not touched for `ttlSeconds`
   * lapses, which starts the count again from zero.
   *
   * MUST be atomic (Redis: `INCR` and `EXPIRE` in one script).
   */
  recordFailure?(
    tenantId: string,
    recipient: string,
    purpose: string,
    ttlSeconds: number
  ): Promise<number>

  /** Optional. Removes the failure counter. Idempotent. Called on success and on `consume()`. */
  clearFailures?(tenantId: string, recipient: string, purpose: string): Promise<void>

  /** Whether the storage is configured and ready. Used during module initialization. */
  isConfigured(): boolean

  /** Storage name (e.g. `'redis'`, `'memory'`, `'dynamodb'`). */
  readonly name: string
}
