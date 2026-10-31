/**
 * @fileoverview Keyed digest under which an OTP code is stored when `otp.codeSecret` is set.
 * @layer domain
 *
 * A code is short and drawn from a small space (a six-digit code has a million values), so
 * an unkeyed hash of it is recovered by trying every value, in a fraction of a second, by
 * anyone who can read the store. The digest is therefore an HMAC under a secret that lives
 * with the application and never in the store: a reader of the store alone holds nothing
 * to test a guess against. OWASP's Password Storage guidance reaches the same shape for a
 * low-entropy secret: a keyed hash whose key is "stored separately" from the data.
 *
 * The stored value carries a version prefix so a legacy plaintext entry, written before the
 * secret was configured, can be told apart and verified until it expires.
 */

import { createHmac } from 'node:crypto'

/** Prefix of a stored digest. A plaintext code is digits or letters and cannot start with it. */
export const CODE_DIGEST_PREFIX = 'hmac-sha256:v1:'

/** Shortest accepted secret, in bytes: the size of the HMAC-SHA-256 key block's useful entropy. */
export const MIN_CODE_SECRET_BYTES = 32

/** Domain separator, so the same secret used elsewhere never yields a matching digest. */
const CONTEXT = 'bymax-notification:otp-code:v1\0'

/**
 * Builds the function that turns a code into the value that is stored.
 *
 * @param secret - The application's secret, at least {@link MIN_CODE_SECRET_BYTES} bytes.
 * @returns A function from a plaintext code to its stored digest.
 */
export function createCodeDigester(secret: string): (code: string) => string {
  const key = Buffer.from(secret, 'utf8')
  return (code: string): string =>
    `${CODE_DIGEST_PREFIX}${createHmac('sha256', key).update(CONTEXT).update(code).digest('hex')}`
}

/**
 * Whether a stored code is a digest rather than a plaintext code.
 *
 * @param stored - The `OtpEntry.code` as read from the store.
 * @returns `true` when it carries the digest prefix.
 */
export function isCodeDigest(stored: string): boolean {
  return stored.startsWith(CODE_DIGEST_PREFIX)
}
