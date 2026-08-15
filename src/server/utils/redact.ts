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
 * Removes the secret values from an error chain and returns its (possibly
 * replaced) head — `name`, `message`, and `stack` at every link. A node is
 * scrubbed in place when it accepts writes, preserving its identity and class
 * (a `NotificationException` stays one); a node that resists mutation (frozen
 * or read-only) is REPLACED by a redacted plain-Error copy, so the returned
 * chain is guaranteed code-free either way. A non-Error `cause` link (a
 * primitive or a bare object) cannot be walked, so it is flattened to a
 * redacted string — a string tail could carry the secret verbatim and an
 * object tail could carry it in a property; `undefined`/`null` links stay as
 * they are. Traversal is identity-based (a `WeakSet` of visited nodes), so a
 * cyclic chain terminates.
 *
 * @param error - The head of the chain; a non-Error head is flattened too.
 * @param values - The secret values to remove.
 * @returns The scrubbed head — the same object when it accepted writes, a
 * redacted copy when it did not.
 */
export function scrubValuesFromErrorChain(error: unknown, values: readonly string[]): unknown {
  return scrubNode(error, values, new WeakSet<Error>())
}

/** Recursive worker for {@link scrubValuesFromErrorChain} — one node per call. */
function scrubNode(node: unknown, values: readonly string[], visited: WeakSet<Error>): unknown {
  if (!(node instanceof Error)) {
    if (node === undefined || node === null) {
      return node
    }
    return redactValues(String(node), values)
  }
  if (visited.has(node)) {
    return node
  }
  visited.add(node)
  const name = redactValues(node.name, values)
  const message = redactValues(node.message, values)
  const stack = node.stack === undefined ? undefined : redactValues(node.stack, values)
  const hasCause = 'cause' in node
  const cause = hasCause ? scrubNode(node.cause, values, visited) : undefined
  // `Reflect.set` reports failure instead of throwing; the identity check on
  // `cause` skips a redundant write when the child was scrubbed in place.
  const applied =
    Reflect.set(node, 'name', name) &&
    Reflect.set(node, 'message', message) &&
    (stack === undefined || Reflect.set(node, 'stack', stack)) &&
    (!hasCause || cause === node.cause || Reflect.set(node, 'cause', cause))
  if (applied) {
    return node
  }
  // The node resists mutation: return a redacted copy with the native Error
  // shape (nothing enumerable; writable so a later scrub can still redact).
  const copy = new Error(message)
  Object.defineProperty(copy, 'name', { value: name, writable: true })
  if (stack !== undefined) {
    copy.stack = stack
  }
  if (hasCause) {
    Object.defineProperty(copy, 'cause', { value: cause, writable: true })
  }
  return copy
}
