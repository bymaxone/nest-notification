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
  if (!(error instanceof Error)) {
    if (error === undefined || error === null) {
      return error
    }
    return redactValues(String(error), values)
  }
  const seen = new WeakMap<Error, Error>()
  const chain: ChainLink[] = []
  let headRepresentative: Error = error
  let cursor: Error = error
  // Pass 1 — register a representative for every link. The walk is iterative,
  // so an adversarially deep chain is bounded by heap, never by the call
  // stack (a RangeError here would REPLACE the failure being scrubbed). It
  // ends on a non-Error tail or a back-edge to an already-registered node.
  while (!seen.has(cursor)) {
    const link = registerLink(cursor, values, seen)
    chain.push(link)
    if (cursor === error) {
      headRepresentative = link.representative
    }
    const next: unknown = cursor.cause
    if (!link.hasCause || !(next instanceof Error)) {
      break
    }
    cursor = next
  }
  // Pass 2 — wire each link's cause to its child's representative (or the
  // flattened form of a non-Error tail). Every representative is registered
  // already, so a cyclic back-edge resolves without recursion.
  for (const link of chain) {
    if (!link.hasCause) {
      continue
    }
    const raw: unknown = link.node.cause
    let childRepresentative: unknown
    if (raw instanceof Error) {
      childRepresentative = seen.get(raw)
    } else if (raw === undefined || raw === null) {
      childRepresentative = raw
    } else {
      childRepresentative = redactValues(String(raw), values)
    }
    if (link.inPlace) {
      Reflect.set(link.node, 'cause', childRepresentative)
    } else {
      Object.defineProperty(link.representative, 'cause', {
        value: childRepresentative,
        writable: true
      })
    }
  }
  return headRepresentative
}

/** One walked link — the original node paired with its scrubbed representative. */
interface ChainLink {
  node: Error
  representative: Error
  inPlace: boolean
  hasCause: boolean
}

/**
 * Scrubs one link's own fields and registers its representative in `seen` —
 * the node itself when it accepted every write, a redacted copy otherwise.
 */
function registerLink(
  node: Error,
  values: readonly string[],
  seen: WeakMap<Error, Error>
): ChainLink {
  const name = redactValues(node.name, values)
  const message = redactValues(node.message, values)
  const stack = node.stack === undefined ? undefined : redactValues(node.stack, values)
  const hasCause = 'cause' in node
  // `Reflect.set` reports failure instead of throwing. The final clause is a
  // writability PROBE (a same-value write): it proves upfront that the later
  // child-representative write cannot fail. The `name` write is skipped when
  // the value is unchanged, so a default-named error does not gain an own
  // enumerable `name` the strip just removed.
  const inPlace =
    stripExtraProperties(node, values) &&
    (node.name === name || Reflect.set(node, 'name', name)) &&
    Reflect.set(node, 'message', message) &&
    (stack === undefined || Reflect.set(node, 'stack', stack)) &&
    (!hasCause || Reflect.set(node, 'cause', node.cause))
  const representative = inPlace ? node : buildRedactedCopy(name, message, stack)
  seen.set(node, representative)
  return { node, representative, inPlace, hasCause }
}

/**
 * Builds a redacted CLONE of a plain data tree — fresh objects and arrays all
 * the way down, so a frozen or read-only original can never defeat the
 * redaction (cloning only READS the source). Keys are redacted like values —
 * a secret can ride a property NAME — and defined via `defineProperty`, so a
 * `__proto__` key becomes a harmless own property instead of a prototype
 * write. Strings are redacted; a numeric or bigint value whose string form
 * carries a secret becomes the redaction marker; other primitives pass
 * through. Cycles clone into cycles via the `seen` map, and the traversal is
 * iterative (an explicit work list), so depth is bounded by heap, not by the
 * call stack.
 */
function cloneRedacted(root: unknown, values: readonly string[]): unknown {
  const seen = new WeakMap<object, object>()
  const pending: Array<{ source: object; target: object }> = []
  const cloneValue = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return redactValues(value, values)
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
      return redactValues(String(value), values) === String(value) ? value : REDACTED_VALUE
    }
    if (typeof value !== 'object' || value === null) {
      return value
    }
    const existing = seen.get(value)
    if (existing !== undefined) {
      return existing
    }
    const target: object = Array.isArray(value) ? [] : {}
    seen.set(value, target)
    pending.push({ source: value, target })
    return target
  }
  const result = cloneValue(root)
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    for (const [key, value] of Object.entries(entry.source)) {
      Object.defineProperty(entry.target, redactValues(key, values), {
        value: cloneValue(value),
        enumerable: true
      })
    }
  }
  return result
}

/**
 * Deletes payload-bearing own enumerable properties from an arbitrary error —
 * a storage may reject with `Object.assign(new Error(...), { entry })`, and
 * `entry` carries the code. `cause` is kept (it is the chain being walked);
 * `name`/`message`/`stack` are rewritten right after, so deleting an
 * enumerable variant of them is harmless. A `NotificationException` keeps its
 * contract properties (code, response, status — the HTTP shape consumers and
 * the Nest exception filter rely on), but its response is REPLACED by a
 * redacted clone instead of trusted: a CONSUMER-constructed instance may
 * carry the secret in caller-supplied `details`, and cloning fails closed
 * even when those details are frozen.
 *
 * @returns `false` when a property resists deletion or the response slot
 * resists replacement — the caller must fall back to a copy.
 */
function stripExtraProperties(node: Error, values: readonly string[]): boolean {
  if (node instanceof NotificationException) {
    return Reflect.set(node, 'response', cloneRedacted(node.getResponse(), values))
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
