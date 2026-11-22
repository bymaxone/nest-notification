/**
 * @fileoverview Refuses to connect or send while this realm's `Object.prototype` holds a string key
 * outside the runtime's standard set, or a standard key that is no longer what it was at load.
 * @layer infrastructure
 *
 * A key planted on the root answers for every name a transport or an SDK reads from an object the
 * library does not build (an instance of its own, an option Node validates, an object copied into an
 * ordinary one). Naming the keys that are read is a list that grows with every release of a
 * dependency; the standard set is fixed, so the check is an allowlist: any other string key is
 * refused, before any I/O. A standard name can also be overwritten (`hasOwnProperty = 1`, or a JSON
 * payload that sets `constructor`), which no allowlist by name sees, so each standard key's
 * descriptor is kept at load and a descriptor that differs counts like a planted key. The refusal
 * reports a count and never a key or a value, because a key can carry a secret and a value can be
 * the text an attacker wants logged.
 */

import { refuseInput } from './bounded-list'

// Captured when the module loads, so a host that replaces these later cannot change the answer.
const ROOT = Object.prototype
const namesOf = Object.getOwnPropertyNames
const descriptorOf = Object.getOwnPropertyDescriptor
const same = Object.is

/**
 * The string keys `Object.prototype` has in every runtime this library supports. A spec compares
 * it with the runtime it runs on, so a runtime that adds a key fails the build and not a send.
 */
export const STANDARD_ROOT_KEYS: ReadonlySet<string> = new Set(
  '__defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ __proto__ constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf'.split(
    ' '
  )
)

/** Each standard key as it was when the module loaded. */
const LOADED = new Map(
  [...STANDARD_ROOT_KEYS].map((name) => [name, descriptorOf(ROOT, name)] as const)
)

/**
 * Whether a standard key is what it was at load: present with the same value or accessors and the
 * same flags, or absent as it was.
 *
 * @param name - A standard key.
 * @returns `true` when its descriptor differs from the one kept at load.
 */
function changed(name: string): boolean {
  const before = LOADED.get(name)
  const now = descriptorOf(ROOT, name)
  if (before === undefined || now === undefined) {
    return before !== now
  }
  return (
    !same(before.value, now.value) ||
    before.get !== now.get ||
    before.set !== now.set ||
    before.writable !== now.writable ||
    before.enumerable !== now.enumerable ||
    before.configurable !== now.configurable
  )
}

/**
 * Refuses while the realm root holds a string key that is not standard, or a standard key that
 * was overwritten, redefined or removed.
 *
 * @param owner - The component that is about to connect or send, for the refusal.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER`, naming the count and nothing else.
 */
export function assertStandardRealmRoot(owner: string): void {
  const extra = namesOf(ROOT).filter((name) => !STANDARD_ROOT_KEYS.has(name)).length
  const altered = [...STANDARD_ROOT_KEYS].filter(changed).length
  const count = extra + altered
  if (count > 0) {
    throw refuseInput(
      owner,
      'Object.prototype',
      `holds ${String(count)} key(s) outside the runtime's standard set, so nothing is sent`
    )
  }
}
