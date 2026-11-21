/**
 * @fileoverview Turns what a storage call threw into what the caller of an OTP operation sees.
 * @layer utils
 */

import { coerceRedacted, isSafeError, scrubValuesFromErrorChain } from './redact'

/**
 * Cleans a failure of any kind of the secret values before it leaves the library.
 *
 * An `Error` has the values scrubbed out of its chain, in place or through redacted copies. Any
 * other rejection is flattened to a redacted string, since a raw object could carry a value in a
 * property and a primitive cannot be mutated. The class check cannot throw, so a hostile object
 * is flattened too.
 *
 * @param failure - What was thrown or rejected with.
 * @param values - The secret values to remove.
 * @returns The failure the caller should throw.
 */
export function outgoingError(failure: unknown, values: readonly string[]): unknown {
  return isSafeError(failure)
    ? scrubValuesFromErrorChain(failure, values)
    : coerceRedacted(failure, values)
}
