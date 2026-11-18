/**
 * @fileoverview The copy of an error that is safe to hand to a logger's `err` field: its message,
 * name and code written with every control character visible, so a reply that carries a line break
 * cannot forge a second log line in a logger that prints the object as text.
 * @layer utils
 */

import { escapeAuditString } from './audit-escape'
import { describeError, UNPRINTABLE_ERROR } from './describe-error'

/**
 * Copies whatever stands behind a log line into an `Error` that is safe to hand to a logger. The
 * original is never touched: it is the one the caller receives, or the host's own. The value can come
 * from consumer code and need not be an `Error`, so no type test is made on it (one throws for a
 * revoked proxy); the message, the name and a string code are read through a guard, and a value that
 * cannot be read becomes a fixed error.
 *
 * @param error - The value behind a log line.
 * @returns A new `Error` with an escaped message, name and string code, and no cause or stack of the
 *   original.
 */
export function loggableError(error: unknown): Error {
  try {
    const source = error as { message?: unknown; name?: unknown; code?: unknown } | null | undefined
    const copy = new Error(escapeAuditString(describeError(error)))
    if (typeof source?.name === 'string') {
      copy.name = escapeAuditString(source.name)
    }
    if (typeof source?.code === 'string') {
      Object.assign(copy, { code: escapeAuditString(source.code) })
    }
    return copy
  } catch {
    return new Error(UNPRINTABLE_ERROR)
  }
}
