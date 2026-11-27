/**
 * @fileoverview Pure helpers for resend-cooldown presentation.
 * @layer application
 *
 * Used by `OtpService` to enrich the `OTP_COOLDOWN_ACTIVE` exception and exposed
 * to consumers building an HTTP `Retry-After` header or a countdown UI from the
 * remaining-seconds value returned by `IOtpStorage.getCooldown()` — without
 * pulling in a date library (date-fns / dayjs).
 */

/** Milliseconds in one second. */
const MS_PER_SECOND = 1000
/** Seconds in one minute. */
const SECONDS_PER_MINUTE = 60
/** Seconds in one hour. */
const SECONDS_PER_HOUR = 3600

/** The most seconds that are presented: more would not always print as digits or give a date. */
const MAX_REMAINING_SECONDS = 2_147_483_647

/** The remaining seconds to present: from `0` to the bound, and `0` when not a finite number. */
export function clampRemaining(remainingSeconds: number): number {
  const clamped = Math.max(remainingSeconds, 0)
  return Number.isFinite(clamped) ? Math.min(clamped, MAX_REMAINING_SECONDS) : 0
}

/**
 * Computes the HTTP `Retry-After` header value (in whole seconds).
 *
 * Rounds up (a partial second still requires waiting) and clamps to a
 * non-negative integer, so an already-expired cooldown yields `'0'`, as does a value that is not a
 * finite number. A finite value above 2147483647 is presented as 2147483647.
 *
 * @param remainingSeconds - Remaining cooldown, as returned by `storage.getCooldown()`.
 * @returns A string suitable for `res.setHeader('Retry-After', value)`.
 * @example
 * ```ts
 * toRetryAfterHeader(47.3) // '48'
 * toRetryAfterHeader(-5)   // '0'
 * ```
 */
export function toRetryAfterHeader(remainingSeconds: number): string {
  return String(Math.ceil(clampRemaining(remainingSeconds)))
}

/**
 * Computes the epoch-ms timestamp at which the cooldown will expire.
 *
 * @param remainingSeconds - Current remaining cooldown in seconds.
 * @returns Epoch ms when the cooldown expires; `Date.now()` when already expired, or when the
 *   value is not a finite number. A finite value above 2147483647 counts as 2147483647.
 * @example
 * ```ts
 * cooldownExpiresAt(60) // ~Date.now() + 60_000
 * cooldownExpiresAt(0)  // ~Date.now()
 * ```
 */
export function cooldownExpiresAt(remainingSeconds: number): number {
  return Date.now() + clampRemaining(remainingSeconds) * MS_PER_SECOND
}

/**
 * Formats a remaining cooldown as a compact human-readable string for a UI.
 *
 * Zero-valued units are omitted; an expired or zero cooldown, or a value that is not a finite
 * number, gives `'0s'`. A finite value above 2147483647 is formatted as 2147483647.
 *
 * @param remainingSeconds - Remaining cooldown in seconds.
 * @returns A string such as `'0s'`, `'47s'`, `'2m'`, `'2m 5s'`, `'1h'`, or `'1h 2m 5s'`.
 * @example
 * ```ts
 * formatCooldown(125)  // '2m 5s'
 * formatCooldown(3725) // '1h 2m 5s'
 * ```
 */
export function formatCooldown(remainingSeconds: number): string {
  const totalSeconds = Math.ceil(clampRemaining(remainingSeconds))
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR)
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  const parts: string[] = []
  if (hours > 0) {
    parts.push(`${hours}h`)
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`)
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`)
  }
  return parts.join(' ')
}
