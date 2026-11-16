/**
 * @fileoverview Escapes the strings of an audit entry so that none leaves the writer with a character
 * that can start a second log record or reorder how a line is displayed.
 * @layer utils
 *
 * An audit entry carries values the caller chose: a recipient, a user id, an error text, a template
 * name. Written to a log or a store as they are, a line feed in one of them starts a second record
 * that nobody wrote, and a bidirectional control makes a line read as another one. The entry is
 * escaped once, where every writer's entry passes, and not field by field, so a field added later
 * is covered without anyone remembering to.
 *
 * What is escaped, in every string of the entry, in the keys and values of its metadata at any
 * depth: the C0 and C1 controls (this includes line feed, carriage return, tab, NUL, DEL and NEL),
 * the Unicode line and paragraph separators and the bidirectional controls. Each becomes a visible
 * sequence, `\n`, `\r`, `\t` or `\uXXXX`, so the entry still shows that a character was there and
 * which. A backslash is not escaped: the aim is that a value cannot start a record or reorder a
 * line, not that the escape can be undone, and a backslash is legitimate text. As a consequence
 * escaping twice changes nothing.
 *
 * The metadata is walked to a fixed depth. What lies deeper, a value that is not a plain object, an
 * array or a primitive, and a cycle become a fixed marker, never the value as it was: the
 * invariant is that no string leaves the writer with a raw control character.
 */

import type { NotificationLogEntry } from '../interfaces/notification-log-repository.interface'

/** The deepest level of nested objects and arrays that is walked; the entry itself is level 0. */
export const MAX_METADATA_DEPTH = 4

/** Put where a subtree lies deeper than {@link MAX_METADATA_DEPTH}. */
export const DEPTH_LIMIT_MARKER = '[depth limit]'

/** Put where an object contains itself. */
export const CIRCULAR_MARKER = '[circular]'

/** Put where a value is neither a string, a number, a boolean, nor a plain object or array. */
export const NON_PLAIN_MARKER = '[non-plain value]'

/** Controls (C0, DEL, C1), the line and paragraph separators and the bidirectional controls. */
const ESCAPED = /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu

const NAMED: ReadonlyMap<string, string> = new Map([
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t']
])

/** The visible sequence for one escaped character. */
function sequenceOf(character: string): string {
  return NAMED.get(character) ?? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
}

/**
 * Escapes one string.
 *
 * @param value - The string.
 * @returns The string with every escaped character written as a visible sequence.
 */
export function escapeAuditString(value: string): string {
  return value.replace(ESCAPED, sequenceOf)
}

/** Whether `value` is an object literal or an object without a prototype. */
function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * The escaped copy of the entries of `record`, keys included. Escaping leaves a backslash as it
 * is, so two keys can escape to the same text; the later one takes a `#n` suffix rather than
 * replacing the value of the earlier.
 */
function escapeRecord(
  record: Record<string, unknown>,
  level: number,
  ancestors: WeakSet<object>
): Record<string, unknown> {
  const escaped = new Map<string, unknown>()
  for (const [key, value] of Object.entries(record)) {
    const base = escapeAuditString(key)
    let name = base
    for (let attempt = 2; escaped.has(name); attempt++) {
      name = `${base}#${attempt}`
    }
    escaped.set(name, escapeValue(value, level + 1, ancestors))
  }
  return Object.fromEntries(escaped)
}

/** The escaped copy of one value found at nesting `level`. */
function escapeValue(value: unknown, level: number, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return escapeAuditString(value)
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return NON_PLAIN_MARKER
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  if (level > MAX_METADATA_DEPTH) {
    return DEPTH_LIMIT_MARKER
  }
  if (ancestors.has(value)) {
    return CIRCULAR_MARKER
  }
  const isArray = Array.isArray(value)
  if (!isArray && !isPlainObject(value)) {
    return NON_PLAIN_MARKER
  }
  ancestors.add(value)
  try {
    return isArray
      ? value.map((item: unknown) => escapeValue(item, level + 1, ancestors))
      : escapeRecord(value as Record<string, unknown>, level, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Returns a copy of an audit entry in which no string carries a character that can start a record
 * or reorder a line. The entry it is given is not changed.
 *
 * @param entry - The entry a writer built.
 * @returns The escaped copy.
 */
export function escapeAuditEntry(entry: NotificationLogEntry): NotificationLogEntry {
  return escapeRecord(
    entry as unknown as Record<string, unknown>,
    0,
    new WeakSet()
  ) as unknown as NotificationLogEntry
}
