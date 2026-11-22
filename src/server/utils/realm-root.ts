/**
 * @fileoverview Refuses to connect or send while this realm's `Object.prototype` holds a string key
 * outside the runtime's standard set.
 * @layer infrastructure
 *
 * A key planted on the root answers for every name a transport or an SDK reads from an object the
 * library does not build (an instance of its own, an option Node validates, an object copied into an
 * ordinary one). Naming the keys that are read is a list that grows with every release of a
 * dependency; the standard set is fixed, so the check is an allowlist: any other string key is
 * refused, before any I/O. The refusal reports a count and never a key or a value, because a key
 * can carry a secret and a value can be the text an attacker wants logged.
 */

import { refuseInput } from './bounded-list'

// Captured when the module loads, so a host that replaces these later cannot change the answer.
const ROOT = Object.prototype
const namesOf = Object.getOwnPropertyNames

/**
 * The string keys `Object.prototype` has in every runtime this library supports. A spec compares
 * it with the runtime it runs on, so a runtime that adds a key fails the build and not a send.
 */
export const STANDARD_ROOT_KEYS: ReadonlySet<string> = new Set(
  '__defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ __proto__ constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf'.split(
    ' '
  )
)

/**
 * Refuses while the realm root holds a string key that is not standard.
 *
 * @param owner - The component that is about to connect or send, for the refusal.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER`, naming the count and nothing else.
 */
export function assertStandardRealmRoot(owner: string): void {
  const extra = namesOf(ROOT).filter((name) => !STANDARD_ROOT_KEYS.has(name)).length
  if (extra > 0) {
    throw refuseInput(
      owner,
      'Object.prototype',
      `holds ${String(extra)} key(s) outside the runtime's standard set, so nothing is sent`
    )
  }
}
