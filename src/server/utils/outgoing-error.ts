/**
 * @fileoverview Turns what a storage call threw into what the caller of an OTP operation sees.
 * @layer utils
 */

import type { NotificationException } from '../errors/notification-exception'
import { isLibraryError } from './is-library-error'
import { coerceRedacted, isSafeError, scrubValuesFromErrorChain } from './redact'

/**
 * Cleans a failure of any kind of the secret values before it leaves the library.
 *
 * An `Error` has the values scrubbed out of its chain, in place or through redacted copies. Any
 * other rejection is flattened to a redacted string, since a raw object could carry a value in a
 * property and a primitive cannot be mutated. The class check cannot throw, so a hostile object
 * is flattened too.
 *
 * A value the caller chose, a guess at a code, can be any text, so it can be a stretch of the
 * library's own error code (`otp` is in `notification.otp_storage_failed`), and scrubbing it would
 * rewrite the code a client matches on. With `keepLibraryErrors` a value that is a stretch of the
 * error's own code or message is not scrubbed from that error: the text is the library's, public,
 * and the value is nothing a reader learns from it.
 *
 * @param failure - What was thrown or rejected with.
 * @param values - The secret values to remove.
 * @param keepLibraryErrors - Whether a value found in a library error's own code or message stays.
 * @returns The failure the caller should throw.
 */
export function outgoingError(
  failure: unknown,
  values: readonly string[],
  keepLibraryErrors = false
): unknown {
  const kept = keepLibraryErrors && isLibraryError(failure) ? ownText(failure) : ''
  const scrubbed = values.filter((value) => !kept.includes(value))
  return isSafeError(failure)
    ? scrubValuesFromErrorChain(failure, scrubbed)
    : coerceRedacted(failure, scrubbed)
}

/** The code, the message and the response body of a library error, read under a guard; empty when they cannot be read. */
function ownText(error: NotificationException): string {
  try {
    return `${error.code} ${error.message} ${JSON.stringify(error.getResponse())}`
  } catch {
    return ''
  }
}
