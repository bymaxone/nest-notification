/**
 * @fileoverview Reads an options object once, by property access.
 * @layer utils
 *
 * Options are validated and then used. A getter or a Proxy on the host's object may answer with a
 * valid value the first time and another afterwards, so what is checked has to be what is kept: the
 * options are read once into a plain object, and the plain object is validated and used.
 *
 * The read is by property access on each KNOWN key, not a spread. A spread copies own enumerable
 * properties, and a host that passes a class whose options are getters on the prototype (a
 * ConfigService behind each) would lose every one of them and fall back to the defaults without a
 * sound. A key that the option type adds and the list misses would be dropped the same way, so each
 * list is checked against its type where it is written and the specs list every key of every type.
 */

import { types } from 'node:util'

// Captured when the module loads, so a later replacement on `Object` cannot change what is read.
const hasOwn = Object.hasOwn

/**
 * Reads one property by name the way `source[key]` does, getters and prototypes included, except
 * that a value found ONLY on the realm-root prototype (`Object.prototype`, or the same object of
 * another realm) is absent. Code that runs before this library can plant a key there, and an option
 * or an input the host did not set would take the planted value: a `bcc` on every message, a ceiling
 * of a million attempts, a key of its own for the codes. An own property, a property of a class the
 * host wrote and a getter on its prototype all still count, and so does a key of an object whose
 * prototype chain ends elsewhere. A `Proxy` is read through its own traps, as the host built it.
 *
 * The root is found by its shape, never by a property read off it: it is the prototype that has no
 * prototype. A test that read its `constructor` could be bypassed by overwriting that property, and
 * nothing is read from the root at all. The trade-off is that the topmost prototype of a chain the
 * host built by hand (`Object.create(Object.create(null))`) cannot be told from the realm root, so a
 * key held only there is absent too: put an option on the object, or on a class prototype, which
 * always has `Object.prototype` above it.
 *
 * @param source - The object the host gave.
 * @param key - The property name or index.
 * @returns The value, or `undefined` when there is none below the root.
 */
export function readName(source: object, key: string | number): unknown {
  if (types.isProxy(source) || hasOwn(source, key)) {
    return Reflect.get(source, key)
  }
  for (
    let prototype = Object.getPrototypeOf(source) as object | null;
    prototype !== null && Object.getPrototypeOf(prototype) !== null;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    if (hasOwn(prototype, key)) {
      return Reflect.get(source, key)
    }
  }
  return undefined
}

/**
 * A copy with no prototype, for what the library builds from the host's values and reads again
 * later: a key that is not in it is then absent, where an ordinary object would answer for it with
 * whatever the realm root holds.
 *
 * @param source - The object to copy.
 * @returns A new object with the same own enumerable properties and no prototype.
 */
export function nullProto<T extends object>(source: T): T {
  return Object.assign(Object.create(null) as T, source)
}

/**
 * Copies `value` into an object with no prototype that has an own key for each of `names`, `undefined`
 * where `value` has none: for a reader that copies what it is given into an ordinary object and
 * then reads names the host never set, so the own key shadows what the realm root holds.
 *
 * @param value - What the adapter sets.
 * @param names - Every name the reader looks for.
 * @returns The object to hand over.
 */
export function withOwnKeys<T extends object>(value: T, names: readonly string[]): T {
  return Object.assign(
    nullProto(Object.fromEntries(names.map((name) => [name, undefined]))),
    value
  ) as T
}

/**
 * Reads `keys` from `source` once each, into a new plain object. A value that is `undefined` or
 * `null` is left out: an option that reads as either is not set and takes its default, the same as
 * a key that is absent, and the checks run on what is left. `source` is returned as it is when it
 * is not an object, or is an array, so the validation that refuses it still sees what was given.
 *
 * @param source - The options as the host gave them.
 * @param keys - Every option of the type, by name.
 * @param refuseNull - Options whose default is the weaker security posture: a `null` stays in the
 * copy so the validation refuses it, because a `null` from a config lookup is a misconfiguration
 * and must not start the module unkeyed or non-strict.
 * @returns An object with no prototype holding what was read, or `source` itself when it is not an object.
 */
export function readOptionKeys<T>(
  source: T,
  keys: readonly (keyof T & string)[],
  refuseNull: readonly (keyof T & string)[] = []
): T {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return source
  }
  const entries = keys
    .map((key) => [key, readName(source, key)] as const)
    .filter(([key, value]) => value !== undefined && (value !== null || refuseNull.includes(key)))
  return nullProto(Object.fromEntries(entries) as object) as T
}

/** What a built-in constructor's source looks like once printed. */
const NATIVE_SOURCE = /\[native code\]/

/**
 * Whether an object is a plain object or an instance of a class the host wrote: no prototype on its
 * chain, before the root, is a built-in's. The root is the prototype that has no prototype, so an
 * object made in another realm (a `vm` context) is read the same as one made here. A `Map`, a `Set`, a `Date`, a `RegExp` or a
 * class that extends one is not, because what they hold is not read through property names.
 *
 * @param value - The object to test.
 * @returns `true` when it is a plain object, a null-prototype object or an instance of a host class.
 */
export function isPlainOrClassInstance(value: object): boolean {
  for (
    let prototype = Object.getPrototypeOf(value) as object | null;
    prototype !== null && Object.getPrototypeOf(prototype) !== null;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value
    if (
      typeof constructor === 'function' &&
      NATIVE_SOURCE.test(Function.prototype.toString.call(constructor))
    ) {
      return false
    }
  }
  return true
}

/**
 * Refuses options that are not an object, for the constructors of the providers.
 *
 * @param owner - The class name the message starts with.
 * @param options - The options as the host gave them.
 * @throws Error When `options` is `null`, an array or not an object.
 */
export function assertOptionsObject(owner: string, options: unknown): void {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error(`${owner}: options must be an object`)
  }
}

/**
 * The names an object holds: its own enumerable string keys, and the accessors (getters) of
 * the prototypes it inherits from before `Object.prototype`. A class used as a record, with a getter
 * for each name, is read the way a plain object is. A method, `constructor`, a symbol and a
 * non-enumerable own key are not names.
 */
export function namesOf(container: object): string[] {
  const names = new Set(Object.keys(container))
  for (
    let prototype = Object.getPrototypeOf(container) as object | null;
    prototype !== null && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(prototype))) {
      if (descriptor.get !== undefined) {
        names.add(name)
      }
    }
  }
  return [...names]
}
