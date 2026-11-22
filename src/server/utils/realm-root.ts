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
 * descriptor is kept at load and a descriptor that differs counts like a planted key. A standard key
 * that was not what it must be at load (the realm was polluted before the library loaded) counts on
 * every use; loading itself never throws. The refusal
 * reports a count and never a key or a value, because a key can carry a secret and a value can be
 * the text an attacker wants logged.
 */

import { types } from 'node:util'

import { refuseInput } from './bounded-list'

// Captured when the module loads, so a host that replaces these later cannot change the answer.
const ROOT = Object.prototype
const namesOf = Object.getOwnPropertyNames
const descriptorOf = Object.getOwnPropertyDescriptor
const same = Object.is
const hasOwn = Object.hasOwn
const isProxy = types.isProxy
const sourceOf = Function.prototype.call.bind(Function.prototype.toString) as (
  fn: unknown
) => string

/**
 * The string keys `Object.prototype` has in every runtime this library supports. A spec compares
 * it with the runtime it runs on, so a runtime that adds a key fails the build and not a send.
 */
export const STANDARD_ROOT_KEYS: ReadonlySet<string> = new Set(
  '__defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__ __proto__ constructor hasOwnProperty isPrototypeOf propertyIsEnumerable toLocaleString toString valueOf'.split(
    ' '
  )
)

/** The fields of a property descriptor, in the order they are kept. */
const DESCRIPTOR_FIELDS = ['value', 'get', 'set', 'writable', 'enumerable', 'configurable'] as const

/** A descriptor's fields, each `undefined` when absent; `undefined` for a key that is not there. */
type Fields = readonly unknown[] | undefined

/**
 * A key's descriptor as a list of its fields. A descriptor is an ordinary object, so a name read
 * from it that it does not own reaches `Object.prototype`: a planted accessor called `get` would run
 * during the comparison. Each field is read only when the descriptor owns it.
 *
 * @param name - A standard key.
 * @returns The fields in the order of {@link DESCRIPTOR_FIELDS}, or `undefined` when the key is absent.
 */
function fieldsOf(name: string): Fields {
  const descriptor = descriptorOf(ROOT, name)
  if (descriptor === undefined) {
    return undefined
  }
  return DESCRIPTOR_FIELDS.map((field) =>
    hasOwn(descriptor, field) ? Reflect.get(descriptor, field) : undefined
  )
}

/** Each standard key as it was when the module loaded. */
const LOADED = new Map([...STANDARD_ROOT_KEYS].map((name) => [name, fieldsOf(name)] as const))

/**
 * What each standard key must be for the snapshot to mean anything: a native function with this name
 * (the `constructor` is `Object`), and `__proto__` an accessor of native functions. A key that is not, at load, means the
 * realm was polluted before the library was loaded, so no later comparison can tell.
 */
const EXPECTED_NAME: ReadonlyMap<string, string> = new Map(
  [...STANDARD_ROOT_KEYS].map((name) => [name, name === 'constructor' ? 'Object' : name] as const)
)

/**
 * Whether a value is a function the engine implements, by its source: a replacement written in
 * JavaScript that carries the same name does not read `[native code]`, and a Proxy, which does,
 * is refused as a Proxy.
 *
 * @param value - What a standard key held.
 * @returns `true` for a native function.
 */
function isNative(value: unknown): boolean {
  return (
    typeof value === 'function' && !isProxy(value) && sourceOf(value).endsWith('{ [native code] }')
  )
}

/**
 * Whether a standard key held the expected kind of value when the module loaded.
 *
 * @param name - A standard key.
 * @returns `true` when it did not.
 */
function wrongAtLoad(name: string): boolean {
  const loaded = LOADED.get(name)
  if (loaded === undefined) {
    return true
  }
  const [value, getter, setter] = loaded
  if (name === '__proto__') {
    return !isNative(getter) || !isNative(setter)
  }
  return !isNative(value) || (value as { name: string }).name !== EXPECTED_NAME.get(name)
}

/** How many standard keys were not what they must be at load; counted on every use, never thrown. */
const POLLUTED_AT_LOAD = [...STANDARD_ROOT_KEYS].filter(wrongAtLoad).length

/**
 * Whether a standard key is what it was at load: present with the same value or accessors and the
 * same flags, or absent as it was.
 *
 * @param name - A standard key.
 * @returns `true` when its descriptor differs from the one kept at load.
 */
function changed(name: string): boolean {
  const before = LOADED.get(name)
  const now = fieldsOf(name)
  if (before === undefined || now === undefined) {
    return before !== now
  }
  return before.some((field, index) => !same(field, now.at(index)))
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
  const count = extra + altered + POLLUTED_AT_LOAD
  if (count > 0) {
    throw refuseInput(
      owner,
      'Object.prototype',
      `holds ${String(count)} key(s) outside the runtime's standard set, so nothing is sent`
    )
  }
}
