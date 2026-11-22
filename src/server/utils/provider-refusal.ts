/**
 * @fileoverview Lets a provider's refusal of a message reach the caller as a refusal.
 * @layer utils
 *
 * A reference adapter that cannot send a message as it was given (Resend and an attachment whose
 * `contentDisposition` disagrees with its `cid`) refuses it before anything is sent, with
 * `INVALID_SCOPE_IDENTIFIER`. Converted like any other provider failure it would reach the caller
 * as a 502 and a failed delivery that never happened. A provider can be the host's own and its words
 * are its own, so what passes on is a refusal with the library's words, not the provider's.
 */

import { NOTIFICATION_ERROR_CODES } from '../errors/notification-error-codes'
import { refuseInput } from './bounded-list'
import { isLibraryError } from './is-library-error'

/** The code of a library error; `undefined` for anything else, and for one whose code cannot be read. */
function libraryCode(error: unknown): string | undefined {
  try {
    return isLibraryError(error) ? error.code : undefined
  } catch {
    return undefined
  }
}

/**
 * Throws the library's refusal when `error` is a library error that refuses the input, and returns
 * otherwise.
 *
 * @param error - What the provider raised.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER`, with fixed details.
 */
export function rethrowRefusal(error: unknown): void {
  if (libraryCode(error) === NOTIFICATION_ERROR_CODES.INVALID_SCOPE_IDENTIFIER) {
    throw refuseInput('EmailService', 'message', 'the provider refused the message as given')
  }
}
