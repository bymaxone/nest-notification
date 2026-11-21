/**
 * @fileoverview Reads the cause of an error a store raised, safe to run on an error that is the
 * host's own.
 * @layer utils
 */

import { NOTIFICATION_ERROR_CODES } from '../../shared/constants/error-codes'
import { isLibraryError } from './is-library-error'

/**
 * The cause of an error the store raised. The error can be the host's own, with an accessor that
 * throws, and a throw here would leave the failure path before the scrub and the audit.
 */
export function causeOf(error: unknown): unknown {
  try {
    return (error as { cause?: unknown }).cause
  } catch {
    return undefined
  }
}

/**
 * The store's own failure when `outgoing` is the library's answer to one. The audit entry reads
 * its text, which the scrub has already cleaned, because the answer's own message names no cause.
 * An accessor of the error that throws leaves the audit entry with the error's own text.
 */
export function storageCauseOf(outgoing: unknown): unknown {
  try {
    return isLibraryError(outgoing) &&
      (outgoing.code === NOTIFICATION_ERROR_CODES.OTP_STORAGE_FAILED ||
        outgoing.code === NOTIFICATION_ERROR_CODES.OTP_STORAGE_UNAVAILABLE)
      ? outgoing.cause
      : undefined
  } catch {
    // The error can be the host's own, with an accessor that throws.
    return undefined
  }
}
