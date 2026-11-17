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
 * @returns A plain object holding what was read, or `source` itself when it is not an object.
 */
export function readOptionKeys<T>(
  source: T,
  keys: readonly (keyof T & string)[],
  refuseNull: readonly (keyof T & string)[] = []
): T {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return source
  }
  // `Reflect.get` is the same property access as `source[key]`, getters and prototypes included.
  const entries = keys
    .map((key) => [key, Reflect.get(source, key) as unknown] as const)
    .filter(([key, value]) => value !== undefined && (value !== null || refuseNull.includes(key)))
  return Object.fromEntries(entries) as T
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
