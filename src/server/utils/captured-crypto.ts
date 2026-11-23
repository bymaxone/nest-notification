/**
 * @fileoverview The two hashes the library keys and digests with, calling `crypto` through what was
 * read when the module loaded.
 * @layer infrastructure
 *
 * Reading `createHash` once is not enough: the object it returns has `update` and `digest` on a
 * prototype, and a host that replaces one after the import decides what every key and every stored
 * code digest is. `update` that returns the object and a `digest` that answers a constant make the
 * stored digest of a code equal that of any guess. So the methods are read here too, from the
 * prototypes of one object each, and called through a `Reflect.apply` read at the same time; the
 * prototypes are also in the load baseline the realm check compares.
 */

import { createHash, createHmac } from 'node:crypto'

const hashOf = createHash
const keyedHash = createHmac
const apply = Reflect.apply

/** The prototype of what `createHash` returns, the holder of its `update` and `digest`. */
export const HASH_PROTOTYPE: object = Object.getPrototypeOf(hashOf('sha256')) as object

/** The prototype of what `createHmac` returns, the holder of its `update` and `digest`. */
export const HMAC_PROTOTYPE: object = Object.getPrototypeOf(keyedHash('sha256', 'k')) as object

type Method = (...args: unknown[]) => unknown

const hashUpdate = (HASH_PROTOTYPE as Record<string, Method>).update as Method
const hashDigest = (HASH_PROTOTYPE as Record<string, Method>).digest as Method
const hmacUpdate = (HMAC_PROTOTYPE as Record<string, Method>).update as Method
const hmacDigest = (HMAC_PROTOTYPE as Record<string, Method>).digest as Method

/**
 * SHA-256 of one value.
 *
 * @param value - The text to hash.
 * @returns The digest, lowercase hex.
 */
export function sha256Hex(value: string): string {
  const hash = hashOf('sha256')
  apply(hashUpdate, hash, [value])
  return apply(hashDigest, hash, ['hex']) as string
}

/**
 * HMAC-SHA-256 of two values in a row, under a key.
 *
 * @param key - The key.
 * @param first - The first text.
 * @param second - The second text.
 * @returns The digest, lowercase hex.
 */
export function hmacSha256Hex(key: Buffer, first: string, second: string): string {
  const hmac = keyedHash('sha256', key)
  apply(hmacUpdate, hmac, [first])
  apply(hmacUpdate, hmac, [second])
  return apply(hmacDigest, hmac, ['hex']) as string
}
