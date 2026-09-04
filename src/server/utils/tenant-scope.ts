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
 */

/**
 * Asserts that a value can identify a tenant or a recipient.
 *
 * @param owner - Component quoted in the message, to name the failing contract.
 * @param label - Parameter name to quote in the message.
 * @param value - The candidate value.
 * @throws Error When the value is not a string, or is empty or whitespace-only.
 */
export function assertIdentifies(owner: string, label: string, value: string): void {
  if (typeof value !== 'string') {
    throw new Error(
      `[${owner}] ${label} must be a string; received ${typeof value}. ` +
        'The declared type is a contract, not a guarantee, at this boundary.'
    )
  }
  if (value.trim() === '') {
    throw new Error(
      `[${owner}] ${label} must not be empty or whitespace-only; ` +
        'a value that names nobody cannot scope anything.'
    )
  }
}
