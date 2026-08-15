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
 * Coerces an unknown value to a redacted string, failing closed — coercion
 * runs consumer code (`toString`/`Symbol.toPrimitive`), and a hostile
 * implementation that throws a secret-bearing error yields the marker
 * instead of escaping.
 *
 * @param value - The value to coerce.
 * @param values - The secret values to remove.
 * @returns The redacted string form, or the marker when coercion threw.
 */
export function coerceRedacted(value: unknown, values: readonly string[]): string {
  try {
    return redactValues(String(value), values)
  } catch {
    return REDACTED_VALUE
  }
}

/**
 * Reads an error's message for an audit entry, failing closed — the `message`
 * getter (or a non-Error's coercion) runs consumer code that may throw.
 *
 * @param error - The failure whose message is being recorded.
 * @param values - The secret values to remove; omitted means no redaction.
 * @returns The (optionally redacted) message, or the marker when reading threw.
 */
export function readRedactedMessage(error: unknown, values?: readonly string[]): string {
  try {
    const message = error instanceof Error ? error.message : String(error)
    return values ? redactValues(message, values) : message
  } catch {
    return REDACTED_VALUE
  }
}

/**
 * Classifies a value as an `Error`, failing closed — `instanceof` invokes the
 * `getPrototypeOf` trap on proxies, and a hostile or revoked proxy throws
 * right there, before any other guard can run.
 *
 * @param value - The value to classify.
 * @returns `true` only when the check ran AND matched.
 */
export function isSafeError(value: unknown): value is Error {
  try {
    return value instanceof Error
  } catch {
    return false
  }
}

/**
 * Best-effort: attaches `cause` to an error when the slot is genuinely free.
 * Every step runs consumer code (`instanceof`, the `in` check, the write), so
 * the whole operation is guarded — a hostile trap must never throw past the
 * caller, who keeps the target as its failure either way.
 *
 * @param target - The error to receive the cause.
 * @param cause - The value to attach.
 * @returns `true` when the attachment verifiably happened.
 */
export function attachCauseIfAbsent(target: unknown, cause: unknown): boolean {
  try {
    if (target instanceof Error && !('cause' in target)) {
      return Reflect.set(target, 'cause', cause) && target.cause === cause
    }
    return false
  } catch {
    return false
  }
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
  if (!isSafeError(error)) {
    if (error === undefined || error === null) {
      return error
    }
    return coerceRedacted(error, values)
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
    if (!link.hasCause || !isSafeError(link.rawCause)) {
      break
    }
    cursor = link.rawCause
  }
  wireCauses(chain, values, seen)
  return headRepresentative
}

/**
 * Pass 2 of the scrub — wires each link's cause to its child's representative
 * (or the flattened form of a non-Error tail). Every representative is
 * registered already, so a cyclic back-edge resolves without recursion. An
 * in-place node is rewired through `Reflect.set` (a setter-backed slot works);
 * a copy gets its `cause` defined writable.
 */
function wireCauses(
  chain: readonly ChainLink[],
  values: readonly string[],
  seen: WeakMap<Error, Error>
): void {
  for (const link of chain) {
    if (!link.hasCause) {
      continue
    }
    const raw: unknown = link.rawCause
    let childRepresentative: unknown
    if (isSafeError(raw)) {
      childRepresentative = seen.get(raw)
    } else if (raw === undefined || raw === null) {
      childRepresentative = raw
    } else {
      childRepresentative = coerceRedacted(raw, values)
    }
    if (link.representative === link.node) {
      Reflect.set(link.node, 'cause', childRepresentative)
    } else {
      Object.defineProperty(link.representative, 'cause', {
        value: childRepresentative,
        writable: true
      })
    }
  }
}

/** One walked link — the original node paired with its scrubbed representative. */
interface ChainLink {
  node: Error
  representative: Error
  hasCause: boolean
  /** The cause value captured ONCE in pass 1 — pass 2 never re-reads the node. */
  rawCause: unknown
}

/**
 * Scrubs one link's own fields and registers its representative in `seen` —
 * the node itself when it accepted every write, a redacted copy otherwise.
 * Every read and write on the node sits inside the guard: a hostile getter or
 * proxy trap that throws yields a MINIMAL redacted copy instead of letting a
 * secret-bearing error escape the scrub.
 */
function registerLink(
  node: Error,
  values: readonly string[],
  seen: WeakMap<Error, Error>
): ChainLink {
  try {
    const name = redactValues(node.name, values)
    const message = redactValues(node.message, values)
    const stack = node.stack === undefined ? undefined : redactValues(node.stack, values)
    const hasCause = 'cause' in node
    const rawCause: unknown = hasCause ? node.cause : undefined
    // `Reflect.set` reports failure instead of throwing on ordinary objects.
    // The final clause both PROBES the `cause` slot and CLEARS it: after a
    // successful write of `undefined`, the pass-2 rewire lands on an ordinary
    // writable property, and if pass 2 could not run the node ends truncated
    // rather than pointing at an unredacted original. The `name` write is
    // skipped when the value is unchanged, so a default-named error does not
    // gain an own enumerable `name` the strip just removed.
    const applied =
      stripExtraProperties(node, values) &&
      (node.name === name || Reflect.set(node, 'name', name)) &&
      Reflect.set(node, 'message', message) &&
      (stack === undefined || Reflect.set(node, 'stack', stack)) &&
      (!hasCause || Reflect.set(node, 'cause', undefined))
    // A truthy `Reflect.set` does not prove the value changed — an accessor
    // with a no-op setter reports success while keeping the plaintext. Only a
    // node whose fields READ BACK as the redacted values stays in place.
    const inPlace =
      applied &&
      node.name === name &&
      node.message === message &&
      // When `stack` is undefined the node had none and none was written, so
      // the single read-back comparison covers both shapes.
      node.stack === stack &&
      (!hasCause || node.cause === undefined)
    const representative = inPlace ? node : buildRedactedCopy(name, message, stack)
    seen.set(node, representative)
    return { node, representative, hasCause, rawCause }
  } catch {
    // Introspection or mutation threw: nothing readable, nothing leaked.
    const representative = buildRedactedCopy('Error', REDACTED_VALUE, undefined)
    seen.set(node, representative)
    return { node, representative, hasCause: false, rawCause: undefined }
  }
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
    for (const [key, descriptor] of collectOwnEntries(entry.source)) {
      // `configurable` lets a redacted-key COLLISION overwrite (last wins):
      // source keys `otp_<code>` and `otp_[redacted]` map to the same target
      // key, and redefining a non-configurable property would throw. An
      // accessor-backed value is never INVOKED — it is withheld outright, so a
      // hostile getter cannot throw a secret-bearing error from mid-clone.
      Object.defineProperty(entry.target, redactValues(key, values), {
        value: 'value' in descriptor ? cloneValue(descriptor.value) : REDACTED_VALUE,
        enumerable: true,
        configurable: true
      })
    }
  }
  return result
}

/**
 * Lists a source's own enumerable properties as DESCRIPTORS, never invoking
 * accessors — a hostile getter could throw an error that carries the secret,
 * escaping mid-clone and replacing the very failure being scrubbed. When
 * property discovery itself throws (a Proxy trap), the list fails closed to
 * empty: an empty clone leaks nothing.
 */
function collectOwnEntries(source: object): Array<[string, PropertyDescriptor]> {
  try {
    return Object.entries(Object.getOwnPropertyDescriptors(source)).filter(
      ([, descriptor]) => descriptor.enumerable === true
    )
  } catch {
    return []
  }
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
/**
 * Own properties a `NotificationException` needs to keep working — the HTTP
 * body, the status, the Nest options bag, and the stable code. `name`,
 * `message`, and `cause` need no entry: the register step rewrites them right
 * after the strip. Anything else on the instance is consumer-added and gets
 * deleted like on any other error.
 */
const EXCEPTION_CONTRACT_KEYS = new Set(['response', 'status', 'options', 'code'])

function stripExtraProperties(node: Error, values: readonly string[]): boolean {
  try {
    if (node instanceof NotificationException) {
      // The contract fields stay; the response is swapped for a redacted
      // clone; consumer-added extras (`Object.assign(exception, { entry })`)
      // are deleted — they can carry the secret like on any raw error.
      const redactedResponse = cloneRedacted(node.getResponse(), values)
      // The Nest options bag is rebuilt EMPTY: a consumer can stuff payloads
      // into it, serializers spread it, and `initCause` already consumed it at
      // construction time. Both replacements are VERIFIED by reading back —
      // a no-op setter reports success while `getResponse()` still exposes
      // the original secret-bearing object.
      const rebuiltOptions = {}
      return (
        Reflect.set(node, 'response', redactedResponse) &&
        node.getResponse() === redactedResponse &&
        Reflect.set(node, 'options', rebuiltOptions) &&
        Reflect.get(node, 'options') === rebuiltOptions &&
        Object.keys(node).every(
          (key) => EXCEPTION_CONTRACT_KEYS.has(key) || Reflect.deleteProperty(node, key)
        )
      )
    }
    // Deleting `cause` too is fine: it was captured before the strip, the
    // probe recreates the slot, and pass 2 rewires it.
    return Object.keys(node).every((key) => Reflect.deleteProperty(node, key))
  } catch {
    // Property discovery or a trap threw: fail closed to the copy path.
    return false
  }
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
