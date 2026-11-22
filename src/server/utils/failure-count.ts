/**
 * @fileoverview Holds the number a store answers `recordFailure` with to being a count.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'

/**
 * Returns the count `recordFailure` answered with, or refuses an answer that is not one.
 *
 * The count is compared with the attempt ceiling, and every comparison with `undefined`, `NaN`,
 * an object or a string is false, so a store that answers with anything but a whole number of one
 * or more would leave the failure budget unenforced. The answer is refused instead, and nothing
 * of it is kept in the error.
 *
 * @param count - What the store's `recordFailure` resolved with.
 * @param providerName - The store's name, as the wrapper read it.
 * @returns The same `count` when it is a finite integer of at least one.
 * @throws NotificationException `OTP_STORAGE_FAILED` for any other answer.
 */
export function assertFailureCount(count: unknown, providerName: string): number {
  if (
    typeof count === 'number' &&
    Number.isFinite(count) &&
    Number.isInteger(count) &&
    count >= 1
  ) {
    return count
  }
  throw new NotificationException('OTP_STORAGE_FAILED', { providerName })
}
