/**
 * @fileoverview Reads the options of SmtpEmailProvider once into the copy the provider keeps.
 * @layer infrastructure
 *
 * `credentials` and `tls` are the host's objects and are read like the options around them: each
 * declared key once, by property access, so a class with getters on its prototype works, a getter
 * that answers differently later changes nothing, and a key that reads as `undefined` or `null` is
 * not set. The options whose default is the weaker transport or login posture refuse a `null`.
 */

import { assertOptionsObject, readOptionKeys } from '../utils/read-options'
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
    typeof (value as { length?: unknown }).length === 'number'
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
    return [pool.maxConnections, pool.maxMessages]
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
  return {
    ...(maxConnections === undefined ? {} : { maxConnections }),
    ...(maxMessages === undefined ? {} : { maxMessages })
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
    if (Reflect.get(own, key) === null) {
      throw new Error(`SmtpEmailProvider: ${key} must not be null`)
    }
  }
  if (own.credentials !== undefined) {
    own.credentials = readOptionKeys(own.credentials, SMTP_CREDENTIAL_KEYS)
  }
  if (own.tls !== undefined) {
    own.tls = readOptionKeys(own.tls, SMTP_TLS_KEYS)
  }
  return own
}
