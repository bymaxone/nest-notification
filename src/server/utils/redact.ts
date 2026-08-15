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
  return scrubNode(error, values, new WeakMap<Error, unknown>())
}

/**
 * Builds the redacted plain-Error copy representing a node that resists
 * mutation — native Error shape (nothing enumerable), name writable so a
 * later scrub can still redact it.
 */
function buildRedactedCopy(name: string, message: string, stack: string | undefined): Error {
  const copy = new Error(message)
  Object.defineProperty(copy, 'name', { value: name, writable: true })
  if (stack !== undefined) {
    copy.stack = stack
  }
  return copy
}

/**
 * Recursive worker for {@link scrubValuesFromErrorChain} — one node per call.
 * Each original maps to its scrubbed REPRESENTATIVE (itself when it accepted
 * writes, a redacted copy when it did not), registered BEFORE the child is
 * walked so a cyclic back-edge resolves to the representative — never to an
 * unredacted original.
 */
function scrubNode(
  node: unknown,
  values: readonly string[],
  seen: WeakMap<Error, unknown>
): unknown {
  if (!(node instanceof Error)) {
    if (node === undefined || node === null) {
      return node
    }
    return redactValues(String(node), values)
  }
  const known = seen.get(node)
  if (known !== undefined) {
    return known
  }
  const name = redactValues(node.name, values)
  const message = redactValues(node.message, values)
  const stack = node.stack === undefined ? undefined : redactValues(node.stack, values)
  const hasCause = 'cause' in node
  // `Reflect.set` reports failure instead of throwing. The final clause is a
  // writability PROBE (a same-value write): it proves upfront that the later
  // child-representative write cannot fail, so the in-place decision never has
  // to be revisited after the children are walked.
  const inPlace =
    Reflect.set(node, 'name', name) &&
    Reflect.set(node, 'message', message) &&
    (stack === undefined || Reflect.set(node, 'stack', stack)) &&
    (!hasCause || Reflect.set(node, 'cause', node.cause))
  const representative = inPlace ? node : buildRedactedCopy(name, message, stack)
  seen.set(node, representative)
  if (hasCause) {
    const childRepresentative = scrubNode(node.cause, values, seen)
    if (inPlace) {
      Reflect.set(node, 'cause', childRepresentative)
    } else {
      Object.defineProperty(representative, 'cause', {
        value: childRepresentative,
        writable: true
      })
    }
  }
  return representative
}
