/**
 * @fileoverview Redaction helpers shared by the services that must keep secret
 * values (OTP codes) out of audit entries and outgoing error chains.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'

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
 * Redacts every string reachable inside a plain data object, in place —
 * nested objects and arrays included. A numeric value whose string form
 * carries a secret is replaced by the redaction marker outright. Cycles are
 * tolerated via the `visited` set; writes go through `Reflect.set`, so a
 * read-only slot degrades to best-effort.
 */
function redactStringsDeep(
  target: unknown,
  values: readonly string[],
  visited: WeakSet<object>
): void {
  if (typeof target !== 'object' || target === null || visited.has(target)) {
    return
  }
  visited.add(target)
  for (const [key, value] of Object.entries(target)) {
    if (typeof value === 'string') {
      Reflect.set(target, key, redactValues(value, values))
    } else if (typeof value === 'number' || typeof value === 'bigint') {
      if (redactValues(String(value), values) !== String(value)) {
        Reflect.set(target, key, REDACTED_VALUE)
      }
    } else {
      redactStringsDeep(value, values, visited)
    }
  }
}

/**
 * Deletes payload-bearing own enumerable properties from an arbitrary error —
 * a storage may reject with `Object.assign(new Error(...), { entry })`, and
 * `entry` carries the code. `cause` is kept (it is the chain being walked);
 * `name`/`message`/`stack` are rewritten right after, so deleting an
 * enumerable variant of them is harmless. A `NotificationException` keeps its
 * contract properties (code, response, status — the HTTP shape consumers and
 * the Nest exception filter rely on), but its response body is deep-redacted
 * instead of trusted: a CONSUMER-constructed instance may carry the secret in
 * caller-supplied `details`.
 *
 * @returns `false` when a property resists deletion — the caller must fall
 * back to a copy, which drops extras inherently.
 */
function stripExtraProperties(node: Error, values: readonly string[]): boolean {
  if (node instanceof NotificationException) {
    redactStringsDeep(node.getResponse(), values, new WeakSet<object>())
    return true
  }
  return Object.keys(node).every((key) => key === 'cause' || Reflect.deleteProperty(node, key))
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
  // The `name` write is skipped when the value is unchanged, so a default-named
  // error does not gain an own enumerable `name` the strip just removed.
  const inPlace =
    stripExtraProperties(node, values) &&
    (node.name === name || Reflect.set(node, 'name', name)) &&
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
