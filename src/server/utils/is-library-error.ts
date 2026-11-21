/**
 * @fileoverview The class check that tells the library's own errors from everything else, safe to
 * run on a value that came from host code.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'

/**
 * Whether `error` is one of the library's own errors. The check runs on a value the host
 * supplied, and a revoked or trapped proxy throws from `instanceof`, so a check that cannot run
 * counts as no.
 *
 * @param error - Any value.
 * @returns `true` only when `error` is a `NotificationException`.
 */
export function isLibraryError(error: unknown): error is NotificationException {
  try {
    return error instanceof NotificationException
  } catch {
    return false
  }
}
