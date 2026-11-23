/**
 * @fileoverview Constant-time string comparison for OTP verification.
 * @layer infrastructure
 *
 * Comparing OTP codes with `===` is unsafe: JavaScript string equality
 * short-circuits on the first differing character, leaking the match position via
 * timing. `safeCompare` length-guards first (so a wrong-length guess fails closed
 * instead of throwing the `RangeError` that `timingSafeEqual` raises on
 * unequal-length buffers) and then compares in constant time.
 */

import { timingSafeEqual } from 'node:crypto'

// Read once, when the module loads: a replaced `crypto.timingSafeEqual` that says `true`, or a
// `Buffer.from` that answers the same bytes for any text, must not accept a code.
const constantTimeEqual = timingSafeEqual
const bytesOf = Buffer.from

/**
 * Compares two strings in constant time (after a length guard).
 *
 * @param expected - The reference value.
 * @param actual - The value to check.
 * @returns `true` when the strings are byte-equal; `false` otherwise, including
 * on a length mismatch (which leaks only the already-public expected length).
 */
export function safeCompare(expected: string, actual: string): boolean {
  const expectedBytes = bytesOf(expected, 'utf8')
  const actualBytes = bytesOf(actual, 'utf8')
  if (expectedBytes.length !== actualBytes.length) {
    return false
  }
  return constantTimeEqual(expectedBytes, actualBytes)
}
