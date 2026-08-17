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
 *
 * Occurrences are located against the original text and overlapping or nested
 * matches are merged into a single marker before anything is replaced. A
 * sequential value-by-value replacement would let a fragment of one secret
 * survive the replacement of another — `['1234', '2345']` over `'12345'`
 * leaves `5` of a live secret — and would let a later value match inside a
 * marker inserted for an earlier one. Neither can happen against the original
 * text. Empty values are skipped — every position would match one.
 *
 * @param text - The text to clean.
 * @param values - The secret values to remove, in any order.
 * @returns The cleaned text.
 */
export function redactValues(text: string, values: readonly string[]): string {
  const spans: Array<{ start: number; end: number }> = []
  for (const value of values) {
    if (value === '') {
      continue
    }
    for (let start = text.indexOf(value); start !== -1; start = text.indexOf(value, start + 1)) {
      spans.push({ start, end: start + value.length })
    }
  }
  spans.sort((a, b) => a.start - b.start)
  let cleaned = ''
  let cursor = 0
  for (const { start, end } of spans) {
    if (start < cursor) {
      // Overlaps or nests inside the span already replaced: widen it instead
      // of writing a second marker over the same characters.
      cursor = Math.max(cursor, end)
      continue
    }
    cleaned += text.slice(cursor, start) + REDACTED_VALUE
    cursor = end
  }
  return cleaned + text.slice(cursor)
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
 * Concatenates the readable text of an error and its whole `cause` chain —
 * message and stack at every link — for echo DISCOVERY. A provider failure can
 * carry a generic outer message while the echoed body content sits only in a
 * nested `cause`'s message or stack, and discovery that reads the top-level
 * message alone would choose the raw-cause path with that plaintext aboard.
 * Every read is guarded — a hostile getter contributes nothing instead of
 * escaping — and traversal is identity-based, so cycles terminate.
 *
 * @param error - The failure whose chain to read.
 * @returns The chain's message and stack text, newline-joined.
 */
export function collectErrorChainText(error: unknown): string {
  return walkChain(error, true)
}

/**
 * The same walk as {@link collectErrorChainText}, but messages only.
 *
 * Stacks are OUR frames, not the provider's answer, and they are dense with
 * three-digit line numbers — feeding them to a reply-code grammar makes almost
 * every text ambiguous and publishes nothing. Use this where the question is
 * "what did the provider SAY", and the full text where the question is "what
 * bytes might this chain be carrying".
 *
 * @param error - The failure whose chain to read.
 * @returns The chain's messages, newline-joined.
 */
export function collectErrorChainMessages(error: unknown): string {
  return walkChain(error, false)
}

/** Shared walker for the two collectors above. */
function walkChain(error: unknown, includeStack: boolean): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current)
    parts.push(readRedactedMessage(current))
    if (!isSafeError(current)) {
      break
    }
    try {
      if (includeStack && typeof current.stack === 'string') {
        parts.push(current.stack)
      }
    } catch {
      // A hostile `stack` getter contributes nothing.
    }
    try {
      current = 'cause' in current ? current.cause : undefined
    } catch {
      // A hostile `cause` getter or proxy trap ends the walk: `current` keeps
      // the value already recorded in `seen`, so the loop guard stops on the
      // next check. Nothing to do here.
    }
  }
  return parts.join('\n')
}

/**
 * Shortest run of characters that counts as an ECHO of reference content.
 * Below this, coincidental overlap between an error message and a message body
 * is likely; at or above it, the error is quoting content.
 */
export const MIN_ECHO_LENGTH = 16

/**
 * Collects the substrings of `text` (each at least {@link MIN_ECHO_LENGTH}
 * characters) that literally appear inside `reference` — the shape of a
 * provider or relay echoing message content back inside an error. Each match
 * is grown to the longest run still present in the reference, so an echo
 * comes back as one excerpt instead of overlapping windows.
 *
 * Matching is raw and literal: a re-encoded or line-wrapped echo is missed,
 * which is why DECLARED redaction values remain the precise control and this
 * detector is defense-in-depth for the undeclared case. A bare secret quoted
 * without surrounding content is shorter than the window and is not caught.
 *
 * @param text - The error text to inspect.
 * @param reference - The content the error may be echoing (e.g. a message body).
 * @returns The echoed excerpts, in order of appearance.
 */
export function collectEchoedExcerpts(text: string, reference: string): string[] {
  const excerpts: string[] = []
  let index = 0
  while (index + MIN_ECHO_LENGTH <= text.length) {
    const window = text.slice(index, index + MIN_ECHO_LENGTH)
    // Each occurrence of the window anchors a direct character-by-character
    // extension — never a substring re-search per added character, whose cost
    // grows quadratically with the echo and lets a relay quoting a large body
    // stall the event loop.
    let longest = 0
    for (let at = reference.indexOf(window); at !== -1; at = reference.indexOf(window, at + 1)) {
      let length = MIN_ECHO_LENGTH
      while (
        text[index + length] !== undefined &&
        text[index + length] === reference[at + length]
      ) {
        length += 1
      }
      longest = Math.max(longest, length)
    }
    if (longest === 0) {
      index += 1
      continue
    }
    excerpts.push(text.slice(index, index + longest))
    index += longest
  }
  return excerpts
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
 * Own keys every scrubbed error keeps: the standard Error fields, all
 * rewritten in place right after the strip — deleting them would only churn
 * their enumerability, and a redacted COPY carries them non-configurable, so
 * deleting would needlessly force a second copy on a re-scrub. Everything
 * else own — enumerable or not, string or symbol — is consumer-added and
 * deleted.
 */
const STANDARD_ERROR_KEYS = new Set<string | symbol>(['name', 'message', 'stack', 'cause'])

/**
 * Own properties a `NotificationException` needs beyond the standard Error
 * keys — the HTTP body, the status, the Nest options bag, and the stable code.
 */
const EXCEPTION_CONTRACT_KEYS = new Set<string | symbol>(['response', 'status', 'options', 'code'])

/**
 * Deletes every consumer-added OWN key from the node — `Reflect.ownKeys` sees
 * non-enumerable and symbol keys too, which serializers that inspect all own
 * properties would otherwise still read.
 *
 * @returns `false` when any extra resists deletion — the caller must fall
 * back to the redacted copy.
 */
function deleteExtraOwnKeys(node: Error, contractKeys: ReadonlySet<string | symbol>): boolean {
  return Reflect.ownKeys(node).every(
    (key) =>
      STANDARD_ERROR_KEYS.has(key) || contractKeys.has(key) || Reflect.deleteProperty(node, key)
  )
}

/** The generic error contract adds nothing beyond the standard keys. */
const NO_CONTRACT_KEYS: ReadonlySet<string | symbol> = new Set()

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
        deleteExtraOwnKeys(node, EXCEPTION_CONTRACT_KEYS)
      )
    }
    return deleteExtraOwnKeys(node, NO_CONTRACT_KEYS)
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
