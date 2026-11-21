/**
 * @fileoverview Compares a guessed OTP code with the value a store holds.
 * @layer utils
 */

import { isCodeDigest } from './code-digest'
import { safeCompare } from './timing-safe-compare'

/**
 * Compares a guessed code with the stored value in constant time.
 *
 * A stored digest is recomputed from the guess. A digest that cannot be recomputed (no secret
 * configured, or a different one) never matches, and the digest string itself is not accepted as a
 * code. A stored value that is not a digest is a plaintext code written while no secret was set; it
 * is compared directly and ages out with its TTL.
 *
 * @param stored - What the store holds for the recipient.
 * @param guess - The code the caller gave.
 * @param digestCode - The keyed digest of a code, when `otp.codeSecret` is set.
 * @returns Whether the guess matches.
 */
export function matchesStoredCode(
  stored: string,
  guess: string,
  digestCode: ((code: string) => string) | undefined
): boolean {
  if (!isCodeDigest(stored)) {
    return safeCompare(stored, guess)
  }
  return digestCode !== undefined && safeCompare(stored, digestCode(guess))
}
