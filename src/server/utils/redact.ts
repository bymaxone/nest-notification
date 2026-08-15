/**
 * @fileoverview Redaction helpers shared by the services that must keep secret
 * values (OTP codes) out of audit entries and outgoing error chains.
 * @layer domain
 */

/** Marker substituted for a secret value wherever it is redacted. */
export const REDACTED_VALUE = '[redacted]'

/**
 * Replaces every occurrence of each value with {@link REDACTED_VALUE}.
 * Empty values are skipped — splitting on `''` would explode the text.
 *
 * @param text - The text to clean.
 * @param values - The secret values to remove.
 * @returns The cleaned text.
 */
export function redactValues(text: string, values: readonly string[]): string {
  return values.reduce(
    (cleaned, value) => (value === '' ? cleaned : cleaned.split(value).join(REDACTED_VALUE)),
    text
  )
}

/**
 * Removes the secret values from an error chain in place — `message` and
 * `stack` at every link. Traversal is identity-based (a `WeakSet` of visited
 * nodes), so a cyclic chain terminates with every node scrubbed exactly once
 * and no depth limit leaves an unscrubbed tail. Writes go through
 * `Reflect.set`, which reports failure instead of throwing, so a frozen or
 * read-only foreign error degrades to best-effort rather than replacing the
 * original failure with a `TypeError`.
 *
 * @param error - The head of the chain; non-Error values are left untouched.
 * @param values - The secret values to remove.
 */
export function scrubValuesFromErrorChain(error: unknown, values: readonly string[]): void {
  const visited = new WeakSet<Error>()
  let cursor: unknown = error
  while (cursor instanceof Error && !visited.has(cursor)) {
    visited.add(cursor)
    Reflect.set(cursor, 'message', redactValues(cursor.message, values))
    if (cursor.stack !== undefined) {
      Reflect.set(cursor, 'stack', redactValues(cursor.stack, values))
    }
    cursor = 'cause' in cursor ? cursor.cause : undefined
  }
}
