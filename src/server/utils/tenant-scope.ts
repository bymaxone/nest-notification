/**
 * @fileoverview Rejects a tenant or recipient value that identifies nobody.
 * @layer domain
 *
 * Two places need this and they are not the same boundary, which is why it lives
 * here rather than inside either of them: the storage key derivation, where a blank
 * component collapses distinct callers into one namespace, and the audit interceptor,
 * where a blank tenant files an event under a scope shared with every other blank.
 *
 * The `typeof` check is not redundant with the declared parameter type. Both call
 * sites sit where a value crosses from consumer code, and there the declared `string`
 * is a contract this library states rather than one the caller is obliged to honour —
 * a `null` claim or a numeric database id type-checks at their call site and arrives
 * here regardless. It would be defensive padding on an internal call, where the
 * compiler carries the type end to end; it is not one here.
 *
 * The refusal is a `NotificationException` rather than a bare `Error`: it reaches a
 * consumer through every `IOtpStorage` method, and this library's contract is that a
 * consumer branches on `code` to localize. A raw throw from a storage utility would
 * surface as an untyped 500 carrying an internal message, where the condition is a
 * bad request the caller can act on.
 */

import { NotificationException } from '../errors/notification-exception'

/**
 * Asserts that a value can identify a tenant or a recipient.
 *
 * `details` names the boundary and what was wrong with the value, never the value
 * itself: it is serialized into the HTTP response, and a tenant id or a recipient is
 * exactly what must not be echoed back there.
 *
 * @param owner - Component quoted in `details`, to name the failing boundary.
 * @param label - Parameter name quoted in `details`.
 * @param value - The candidate value.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` when the value is not a
 *   string, or is empty or whitespace-only.
 */
export function assertIdentifies(owner: string, label: string, value: string): void {
  if (typeof value !== 'string') {
    throw new NotificationException('INVALID_SCOPE_IDENTIFIER', {
      boundary: owner,
      parameter: label,
      reason: `expected a string, received ${typeof value}`
    })
  }
  if (value.trim() === '') {
    throw new NotificationException('INVALID_SCOPE_IDENTIFIER', {
      boundary: owner,
      parameter: label,
      reason: 'empty or whitespace-only'
    })
  }
}
