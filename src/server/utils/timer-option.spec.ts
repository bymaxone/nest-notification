/**
 * @fileoverview Holds the timer-option guard to the range a timer can hold: a bound past 2^31 - 1
 * milliseconds, a negative or a fraction can fire the timer at once, and NaN or zero can bound
 * nothing, so each is refused when the provider is built, with every value that is not a number.
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

  // A bound is an integer a timer can hold. Anything else is refused when the provider is built,
  // a numeric string and a value past the ceiling included.
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
