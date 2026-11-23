/**
 * @fileoverview The recipient's failure count of an OTP store that keeps one.
 * @layer domain
 */

import type { IOtpStorage } from '../interfaces/otp-storage.interface'

/** A storage that implements all three optional failure methods, which only work together. */
type FailureCarryingStorage = IOtpStorage &
  Required<Pick<IOtpStorage, 'getFailures' | 'recordFailure' | 'clearFailures'>>

/**
 * Whether the storage carries failed attempts across a re-issue. Counting without the means to
 * read and clear the count would lock a recipient out for good, so a storage with only some of
 * the methods is treated as having none.
 */
export function carriesFailures(storage: IOtpStorage): storage is FailureCarryingStorage {
  return (
    storage.getFailures !== undefined &&
    storage.recordFailure !== undefined &&
    storage.clearFailures !== undefined
  )
}

/**
 * Counts one verification attempt against the recipient. Returns `undefined` when the storage
 * does not carry failures, and `null` when no code is live: a verification with no code guesses
 * at nothing, so it spends no budget, and the caller must answer `not_found` instead of going on
 * to consume an attempt from a code issued in the meantime, which would then go uncounted.
 *
 * @param storage - The store of the OTP channel.
 * @param scope - The tenant, recipient and purpose.
 * @param ttlSeconds - How long the count lives.
 * @returns The count, `undefined` or `null` as above.
 */
export async function countAttempt(
  storage: IOtpStorage,
  scope: { tenantId: string; recipient: string; purpose: string },
  ttlSeconds: number
): Promise<number | null | undefined> {
  if (!carriesFailures(storage)) {
    return undefined
  }
  const live = await storage.get(scope.tenantId, scope.recipient, scope.purpose)
  if (live === null) {
    return null
  }
  return storage.recordFailure(scope.tenantId, scope.recipient, scope.purpose, ttlSeconds)
}
