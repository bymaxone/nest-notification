/**
 * @fileoverview Turns what a storage call threw into what the caller of an OTP operation sees.
 * @layer utils
 */

import {
  NOTIFICATION_ERROR_DEFINITIONS,
  type NotificationErrorDefinition
} from '../errors/notification-error-codes'
import type { NotificationException } from '../errors/notification-exception'
import { isLibraryError } from './is-library-error'
import {
  coerceRedacted,
  collectErrorChainText,
  isSafeError,
  scrubValuesFromErrorChain
} from './redact'

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
 * error's code or of the catalog's message for that code is not scrubbed: that text is the
 * library's, public, and the value is nothing a reader learns from it. When text a store put in the
 * error (a message of its own, details, a cause) holds the value too, it is scrubbed everywhere.
 *
 * @param failure - What was thrown or rejected with.
 * @param values - The secret values to remove.
 * @param keepLibraryErrors - Whether a value found in a library error's code or catalog message stays.
 * @returns The failure the caller should throw.
 */
export function outgoingError(
  failure: unknown,
  values: readonly string[],
  keepLibraryErrors = false
): unknown {
  const { catalog, authored } =
    keepLibraryErrors && isLibraryError(failure) ? libraryText(failure) : NO_TEXT
  // A value that is a stretch of the catalog text stays, unless a store's own text echoes it too:
  // then it is scrubbed everywhere, the code included, because a guess left in a log is worse.
  const scrubbed = values.filter((value) => !catalog.includes(value) || authored.includes(value))
  return isSafeError(failure)
    ? scrubValuesFromErrorChain(failure, scrubbed)
    : coerceRedacted(failure, scrubbed)
}

const NO_TEXT = { catalog: '', authored: '' }

/**
 * What of a library error is the library's and what a store wrote into it. The library's is its code
 * and the catalog's message for that code. What a store wrote is a message of its own, the details
 * and the cause chain. Both are empty when the error cannot be read, so nothing is kept.
 */
function libraryText(error: NotificationException): { catalog: string; authored: string } {
  try {
    const { code } = error
    // A code that is not in the catalog is no library error: the destructuring throws and nothing is kept.
    const { message: own } = Object.values(NOTIFICATION_ERROR_DEFINITIONS).find(
      (entry) => entry.code === code
    ) as NotificationErrorDefinition
    const body = (error.getResponse() as { error: { message: string; details?: unknown } }).error
    return {
      catalog: `${code} ${own}`,
      authored: `${body.message === own ? '' : body.message} ${JSON.stringify(body.details ?? '')} ${collectErrorChainText(error.cause)}`
    }
  } catch {
    return NO_TEXT
  }
}
