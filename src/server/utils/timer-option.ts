/**
 * @fileoverview Refuses a timeout option a timer cannot hold.
 * @layer utils
 *
 * Every bound in milliseconds ends in a timer, and a timer holds at most 2^31 - 1 ms. A longer
 * bound, a negative or a fraction can make a call fail at once instead of waiting, and NaN or zero
 * can leave a phase with no bound. A string is refused with them, a numeric one included, because a
 * bound is a number. All are refused when the provider is built, so a typo cannot reach a send.
 */

/** The longest bound a timer holds, in milliseconds. */
export const MAX_TIMER_MS = 2_147_483_647

/**
 * Throws unless `value` is absent or an integer from `1` to {@link MAX_TIMER_MS}.
 *
 * @param owner - The component named in the message, e.g. `SmtpEmailProvider`.
 * @param name - The option named in the message.
 * @param value - The option as the host gave it.
 * @throws Error When `value` is present and is not a positive integer of at most the ceiling.
 */
export function assertTimerMs(owner: string, name: string, value: unknown): void {
  if (value === undefined) {
    return
  }
  if (!(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_TIMER_MS)) {
    throw new Error(
      `${owner}: ${name} must be a positive integer of at most ${String(MAX_TIMER_MS)}`
    )
  }
}
