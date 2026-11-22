/**
 * @fileoverview Reads the options of SmtpEmailProvider once into the copy the provider keeps.
 * @layer infrastructure
 *
 * `credentials` and `tls` are the host's objects and are read like the options around them: each
 * declared key once, by property access, so a class with getters on its prototype works, a getter
 * that answers differently later changes nothing, and a key that reads as `undefined` or `null` is
 * not set. The options whose default is the weaker transport or login posture refuse a `null`.
 */

import {
  assertOptionsObject,
  namesOf,
  nullProto,
  readName,
  readOptionKeys
} from '../utils/read-options'
import {
  SMTP_CREDENTIAL_KEYS,
  SMTP_OPTION_KEYS,
  SMTP_TLS_KEYS,
  SMTP_WEAKER_WHEN_UNSET
} from './smtp-email.types'
import type { SmtpEmailProviderOptions, SmtpPoolOptions } from './smtp-email.types'

/**
 * Whether an object is a sequence and not an options object: an array, a typed array, a buffer, a
 * data view, an array buffer or anything else with a numeric `length`.
 *
 * @param value - The object to test.
 * @returns `true` when it is a sequence.
 */
function isArrayLike(value: object): boolean {
  return (
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    typeof readName(value, 'length') === 'number'
  )
}

/**
 * Reads the two limits off a `pool` option, or `undefined` when it is not an options object or
 * cannot be read: a value that is not an object, a sequence, a getter or a Proxy that throws, or
 * `null`, which has no `length` to read and ends in the same place.
 *
 * @param pool - The option as the caller passed it.
 * @returns The limits as given, or `undefined` when the option is not a readable options object.
 */
function readLimits(
  pool: SmtpPoolOptions
): readonly [number | undefined, number | undefined] | undefined {
  try {
    if (typeof pool !== 'object' || isArrayLike(pool)) {
      return undefined
    }
    return [
      readName(pool, 'maxConnections') as number | undefined,
      readName(pool, 'maxMessages') as number | undefined
    ]
  } catch {
    return undefined
  }
}

/**
 * Reads the limits of the `pool` option once, refusing an option that is not an object of positive
 * integers. Reading it is host code too, so a getter or a Proxy that throws is refused like any
 * other value that is not an options object; and the limits are kept as plain values, so a getter
 * that answers differently later cannot change the transport that is built.
 *
 * @param pool - The option as the caller passed it.
 * @returns The limits that were set, or `undefined` when there is no pool.
 * @throws Error When `pool` is not an object, or a limit is not an integer of at least `1`.
 */
export function readPool(pool: SmtpPoolOptions | undefined): SmtpPoolOptions | undefined {
  if (pool === undefined) {
    return undefined
  }
  const limits = readLimits(pool)
  if (limits === undefined) {
    throw new Error('SmtpEmailProvider: pool must be an object')
  }
  const [maxConnections, maxMessages] = limits
  for (const [name, value] of [
    ['maxConnections', maxConnections],
    ['maxMessages', maxMessages]
  ] as const) {
    if (value !== undefined && !(Number.isSafeInteger(value) && value >= 1)) {
      throw new Error(
        `SmtpEmailProvider: pool.${name} must be a positive integer of at most ${String(Number.MAX_SAFE_INTEGER)}`
      )
    }
  }
  // No prototype: a limit that is not set is absent when the transport is built, whatever the root holds.
  return nullProto({
    ...(maxConnections === undefined ? {} : { maxConnections }),
    ...(maxMessages === undefined ? {} : { maxMessages })
  })
}
/**
 * Refuses a key of `tls` that the provider does not forward. Dropping it would leave the session
 * with a weaker setting than the host asked for (a version floor, a cipher list, a verifier), so
 * the build fails and names the key. A `tls` that is not an object is left to the transport.
 *
 * @param tls - The option as the host gave it.
 * @throws Error When `tls` holds a key outside {@link SMTP_TLS_KEYS}.
 */
function refuseUnknownTlsKeys(tls: unknown): void {
  if (typeof tls !== 'object' || tls === null || Array.isArray(tls)) {
    return
  }
  // Every own key, enumerable or not, and every accessor the object inherits: a key that is left
  // out of the list below is refused, never dropped.
  for (const name of new Set<string | symbol>([...Reflect.ownKeys(tls), ...namesOf(tls)])) {
    if (typeof name === 'symbol') {
      throw new Error('SmtpEmailProvider: tls has a symbol key, which is not a supported option')
    }
    if (!(SMTP_TLS_KEYS as readonly string[]).includes(name)) {
      throw new Error(`SmtpEmailProvider: tls.${name} is not a supported option`)
    }
  }
}

/** The versions a session may be bounded to. */
const TLS_VERSIONS: readonly string[] = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3']

/** PEM material as the transport takes it: a string, binary data, or an array of them. */
function isTlsMaterial(value: unknown): boolean {
  const one = (item: unknown): boolean => typeof item === 'string' || ArrayBuffer.isView(item)
  return Array.isArray(value) ? value.every(one) : one(value)
}

const isBoolean = (value: unknown): boolean => typeof value === 'boolean'
const isString = (value: unknown): boolean => typeof value === 'string'
const isFunction = (value: unknown): boolean => typeof value === 'function'
const isVersion = (value: unknown): boolean =>
  typeof value === 'string' && TLS_VERSIONS.includes(value)

/** The words a refusal uses for a version bound and for PEM material. */
const VERSION_WORDS = 'one of TLSv1, TLSv1.1, TLSv1.2 or TLSv1.3'
const MATERIAL_WORDS = 'a string, a Buffer or an array of them'
const KEY_WORDS =
  'a string, a Buffer or an array of strings, Buffers and { pem, passphrase } objects'
const PFX_WORDS =
  'a string, a Buffer or an array of strings, Buffers and { buf, passphrase } objects'

/**
 * A key or a bundle: PEM material, or an array whose entries are PEM material or objects carrying
 * it with an optional passphrase. Node takes the object form only inside an array, so a bare object
 * is refused here and not at the first send. `field` names the property that holds the material
 * (`pem` for a key, `buf` for a bundle).
 */
function isTlsEntry(field: 'pem' | 'buf'): (value: unknown) => boolean {
  const material = (item: unknown): boolean => typeof item === 'string' || ArrayBuffer.isView(item)
  const entry = (item: unknown): boolean => {
    if (typeof item !== 'object' || item === null || ArrayBuffer.isView(item)) {
      return material(item)
    }
    const passphrase: unknown = readName(item, 'passphrase')
    return (
      material(readName(item, field)) &&
      (passphrase === undefined || typeof passphrase === 'string')
    )
  }
  return (value) => (Array.isArray(value) ? value.every(entry) : material(value))
}

/**
 * Copies the entries of a `key` or `pfx` array that are objects into plain objects, reading each
 * once, so the entry that is checked, forwarded and scrubbed is the same one and a getter on the
 * host's object cannot answer differently later. Strings and binary data are kept as they are.
 *
 * @param tls - The copy of the option, whose `key` or `pfx` may be an array.
 * @param name - `key` or `pfx`.
 * @param field - The property that holds the material: `pem` or `buf`.
 */
function copyTlsEntries(tls: object, name: 'key' | 'pfx', field: 'pem' | 'buf'): void {
  const value: unknown = readName(tls, name)
  if (!Array.isArray(value)) {
    return
  }
  // `Array.from` reads every index once, so a hole becomes an `undefined` entry that the check
  // refuses, where `map` and `every` would skip it.
  Reflect.set(
    tls,
    name,
    Array.from(value as unknown[], (item: unknown) => {
      if (typeof item !== 'object' || item === null || ArrayBuffer.isView(item)) {
        return item
      }
      const passphrase: unknown = readName(item, 'passphrase')
      return passphrase === undefined
        ? { [field]: readName(item, field) }
        : { [field]: readName(item, field), passphrase }
    })
  )
}

/** What each forwarded key must be, and the words the refusal uses for it. */
const TLS_VALUE_RULES: ReadonlyArray<
  readonly [(typeof SMTP_TLS_KEYS)[number], (value: unknown) => boolean, string]
> = [
  ['rejectUnauthorized', isBoolean, 'a boolean'],
  ['servername', isString, 'a string'],
  ['ciphers', isString, 'a string'],
  ['passphrase', isString, 'a string'],
  ['minVersion', isVersion, VERSION_WORDS],
  ['maxVersion', isVersion, VERSION_WORDS],
  ['ca', isTlsMaterial, MATERIAL_WORDS],
  ['cert', isTlsMaterial, MATERIAL_WORDS],
  ['key', isTlsEntry('pem'), KEY_WORDS],
  ['pfx', isTlsEntry('buf'), PFX_WORDS],
  ['checkServerIdentity', isFunction, 'a function']
]

/**
 * Refuses a forwarded `tls` value of the wrong type, naming the key and the type it needs. The
 * message never carries the value, which may be a passphrase, and checking it here means the
 * transport's own error, which can quote what it was given, is not the one that reports it.
 *
 * @param tls - The copy of the option, whose keys were read once.
 * @throws Error When a key that is set holds a value of the wrong type.
 */
function assertTlsValues(tls: unknown): void {
  if (typeof tls !== 'object' || tls === null || Array.isArray(tls)) {
    return
  }
  for (const [key, accepts, expected] of TLS_VALUE_RULES) {
    const value: unknown = readName(tls, key)
    if (value !== undefined && !accepts(value)) {
      throw new Error(`SmtpEmailProvider: tls.${key} must be ${expected}`)
    }
  }
}

/**
 * Copies the options of the provider, reading every declared key once.
 *
 * @param options - The options as the host gave them.
 * @returns The options the provider keeps, with `credentials` and `tls` copied key by key.
 * @throws Error When `options` is not an object, or a `null` is given for `secure`, `requireTls`
 * or `credentials`, whose default is the weaker posture.
 */
export function readSmtpOptions(options: SmtpEmailProviderOptions): SmtpEmailProviderOptions {
  assertOptionsObject('SmtpEmailProvider', options)
  const own = readOptionKeys(options, SMTP_OPTION_KEYS, SMTP_WEAKER_WHEN_UNSET)
  for (const key of SMTP_WEAKER_WHEN_UNSET) {
    if (readName(own, key) === null) {
      throw new Error(`SmtpEmailProvider: ${key} must not be null`)
    }
  }
  if (own.credentials !== undefined) {
    own.credentials = readOptionKeys(own.credentials, SMTP_CREDENTIAL_KEYS)
  }
  if (own.tls !== undefined) {
    refuseUnknownTlsKeys(own.tls)
    own.tls = readOptionKeys(own.tls, SMTP_TLS_KEYS)
    if (typeof own.tls === 'object' && !Array.isArray(own.tls)) {
      copyTlsEntries(own.tls, 'key', 'pem')
      copyTlsEntries(own.tls, 'pfx', 'buf')
    }
    assertTlsValues(own.tls)
  }
  return own
}
