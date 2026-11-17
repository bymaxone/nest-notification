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
 * @returns A plain object holding what was read, or `source` itself when it is not an object.
 */
export function readOptionKeys<T>(source: T, keys: readonly (keyof T & string)[]): T {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return source
  }
  // `Reflect.get` is the same property access as `source[key]`, getters and prototypes included.
  const entries = keys
    .map((key) => [key, Reflect.get(source, key) as unknown] as const)
    .filter(([, value]) => value !== undefined && value !== null)
  return Object.fromEntries(entries) as T
}
