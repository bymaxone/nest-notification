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

// Captured when the module loads, so a host that replaces a built-in later cannot change the answer.
// Everything the check calls after the load is in this block: a built-in that is looked up when the
// check runs (`Array.prototype.filter`, `Set.prototype.has`, `Reflect.get`, a `for...of`, a spread)
// can be replaced by code that ran after this module was imported, and a check that asks a
// replacement whether the root is clean is told what the replacement says.
const ROOT = Object.prototype
const namesOf = Object.getOwnPropertyNames
const descriptorOf = Object.getOwnPropertyDescriptor
const same = Object.is
const hasOwn = Object.hasOwn
const reflectGet = Reflect.get
const isProxy = types.isProxy
// `uncurry(fn)` is `fn` called with its receiver as the first argument, whatever `fn.call` is later.
const uncurry = Function.prototype.bind.bind(Function.prototype.call) as <A extends unknown[], R>(
  fn: (...args: A) => R
) => (receiver: unknown, ...args: A) => R
const setHas = uncurry(Set.prototype.has) as (set: ReadonlySet<string>, name: string) => boolean
const sourceOf = uncurry(Function.prototype.toString) as (fn: unknown) => string
const endsWith = uncurry(String.prototype.endsWith) as (text: string, tail: string) => boolean
const nth = uncurry(Array.prototype.at) as <T>(list: ArrayLike<T>, index: number) => T | undefined

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

/** The standard keys as a list, so the check walks them by index. */
const KEYS: readonly string[] = [...STANDARD_ROOT_KEYS]

/**
 * A descriptor's field, `undefined` when the descriptor does not own it. A descriptor is an ordinary
 * object, so a name read from it that it does not own reaches `Object.prototype`: a planted accessor
 * called `get` would run during the comparison.
 *
 * @param descriptor - A property descriptor.
 * @param field - One of {@link DESCRIPTOR_FIELDS}.
 * @returns The field, or `undefined`.
 */
function readField(descriptor: PropertyDescriptor, field: string): unknown {
  return hasOwn(descriptor, field) ? reflectGet(descriptor, field) : undefined
}

/**
 * A key's descriptor as a list of its fields, in the order of {@link DESCRIPTOR_FIELDS}; `undefined`
 * for a key that is not there. Called while the module loads.
 *
 * @param name - A standard key.
 * @returns The fields, or `undefined`.
 */
function fieldsOf(name: string): unknown[] | undefined {
  const descriptor = descriptorOf(ROOT, name)
  return descriptor === undefined
    ? undefined
    : DESCRIPTOR_FIELDS.map((field) => readField(descriptor, field))
}

/** Each standard key as it was when the module loaded, in the order of {@link KEYS}. */
const LOADED: ReadonlyArray<unknown[] | undefined> = KEYS.map((name) => fieldsOf(name))

/**
 * What each standard key must be for the snapshot to mean anything: a native function with this name
 * (the `constructor` is `Object`), and `__proto__` an accessor of native functions. A key that is not,
 * at load, means the realm was polluted before the library was loaded, so no later comparison can tell.
 */
const EXPECTED_NAME: ReadonlyMap<string, string> = new Map(
  KEYS.map((name) => [name, name === 'constructor' ? 'Object' : name] as const)
)

/**
 * Whether a value is a function the engine implements, by its source: a replacement written in
 * JavaScript that carries the same name does not read `[native code]`, and a Proxy, which does,
 * is refused as a Proxy. Called while the module loads.
 *
 * @param value - What a standard key held.
 * @returns `true` for a native function.
 */
function isNative(value: unknown): boolean {
  return (
    typeof value === 'function' && !isProxy(value) && endsWith(sourceOf(value), '{ [native code] }')
  )
}

/**
 * Whether a standard key held the expected kind of value when the module loaded.
 *
 * @param index - The position of a standard key in {@link KEYS}.
 * @returns `true` when it did not.
 */
function wrongAtLoad(index: number): boolean {
  const name = nth(KEYS, index) as string
  const loaded = nth(LOADED, index)
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
const POLLUTED_AT_LOAD = KEYS.filter((_name, index) => wrongAtLoad(index)).length

/**
 * Whether a standard key is what it was at load: present with the same value or accessors and the
 * same flags, or absent as it was. It walks by index and reads only what was captured at load.
 *
 * @param index - The position of a standard key in {@link KEYS}.
 * @returns `true` when its descriptor differs from the one kept at load.
 */
function changed(index: number): boolean {
  const before = nth(LOADED, index)
  const now = descriptorOf(ROOT, nth(KEYS, index) as string)
  if (before === undefined || now === undefined) {
    return (before === undefined) !== (now === undefined)
  }
  for (let field = 0; field < DESCRIPTOR_FIELDS.length; field += 1) {
    if (!same(nth(before, field), readField(now, nth(DESCRIPTOR_FIELDS, field) as string))) {
      return true
    }
  }
  return false
}

/**
 * Refuses while the realm root holds a string key that is not standard, or a standard key that
 * was overwritten, redefined or removed. Everything it calls is a reference taken when the module
 * loaded, and it walks with index loops, so a built-in replaced after the import cannot blind it.
 *
 * @param owner - The component that is about to connect or send, for the refusal.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER`, naming the count and nothing else.
 */
export function assertStandardRealmRoot(owner: string): void {
  const names = namesOf(ROOT)
  let count = POLLUTED_AT_LOAD
  for (let at = 0; at < names.length; at += 1) {
    if (!setHas(STANDARD_ROOT_KEYS, nth(names, at) as string)) {
      count += 1
    }
  }
  for (let index = 0; index < KEYS.length; index += 1) {
    if (changed(index)) {
      count += 1
    }
  }
  if (count > 0) {
    throw refuseInput(
      owner,
      'Object.prototype',
      `holds ${count} key(s) outside the runtime's standard set, so nothing is sent`
    )
  }
}
