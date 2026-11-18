/**
 * @fileoverview The copy of an error that is safe to hand to a logger's `err` field: its message,
 * name and code written with every control character visible, so a reply that carries a line break
 * cannot forge a second log line in a logger that prints the object as text.
 * @layer utils
 */

import { escapeAuditString } from './audit-escape'

/** What a failure to read an error's properties is reported as. */
const UNREADABLE = 'Error (unreadable)'

/**
 * Copies an error for the log. The original is never touched: it is the one the caller receives.
 * Reading is guarded, since the error can come from consumer code and a property can throw.
 *
 * @param error - The error behind a log line.
 * @returns A new `Error` with an escaped message, name and string code, and no cause or stack of the
 *   original.
 */
export function loggableError(error: Error): Error {
  try {
    const copy = new Error(escapeAuditString(error.message))
    copy.name = escapeAuditString(error.name)
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') {
      Object.assign(copy, { code: escapeAuditString(code) })
    }
    return copy
  } catch {
    return new Error(UNREADABLE)
  }
}
