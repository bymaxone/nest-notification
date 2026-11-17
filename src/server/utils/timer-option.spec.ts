/**
 * @fileoverview Holds the timer-option guard to the range a timer can hold: past 2^31 - 1
 * milliseconds Node clamps the duration to 1 ms, and a bound that is zero, negative, fractional or
 * not a number either fires at once or is ignored, so each is refused when the provider is built.
 * @layer utils
 */

import { MAX_TIMER_MS, assertTimerMs } from './timer-option'

describe('assertTimerMs', () => {
  it('should hold the longest bound a timer holds', () => {
    expect(MAX_TIMER_MS).toBe(2_147_483_647)
  })

  it.each([1, 10_000, 60_000, 2_147_483_647, undefined])('should accept %p', (value) => {
    expect(() => assertTimerMs('Owner', 'option', value)).not.toThrow()
  })

  // Each of these made a real Nodemailer 10.1.4 send fail in a few milliseconds against a healthy
  // relay (past the ceiling, negative, fractional, a string) or run with no bound (NaN, zero).
  it.each([
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    2_147_483_648,
    3_000_000_000,
    '10s',
    '5000',
    null,
    true,
    {},
    []
  ])('should refuse %p', (value) => {
    expect(() => assertTimerMs('Owner', 'option', value)).toThrow(
      'Owner: option must be a positive integer of at most 2147483647'
    )
  })
})
