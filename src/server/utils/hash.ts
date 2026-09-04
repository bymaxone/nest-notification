/**
 * @fileoverview SHA-256 hashing of `(tenantId, recipient)` for storage keys.
 * @layer infrastructure
 *
 * Storage keys are `sha256(sha256(tenantId):sha256(recipient))` for two reasons:
 * 1. Privacy — an operator with `KEYS`-level access to the store cannot enumerate
 *    the email/phone of every recipient with a pending OTP.
 * 2. Multi-tenancy — each component is hashed to a fixed length BEFORE the two are
 *    joined, so no two distinct pairs can produce the same input string.
 *
 * The second point is about the encoding, not about the digest, and no property of
 * SHA-256 substitutes for it. Joining the raw values around a delimiter makes
 * `('acme:bob', 'x')` and `('acme', 'bob:x')` produce the same input string — and
 * therefore the same key — while preimage and collision resistance hold perfectly.
 *
 * What that buys is precise, and overclaiming it would repeat the mistake it fixes:
 * distinct pairs are no longer *constructibly* mapped onto one key, because the
 * ambiguity was in the encoding and the encoding is now unique. The key itself stays
 * collision-RESISTANT rather than collision-free — an unbounded domain cannot map
 * injectively into 256 bits, and no construction changes that.
 *
 * A component that names no tenant and no recipient is refused rather than hashed:
 * empty, whitespace-only, or not a string at all. `('', r)` would put every caller
 * that omits a tenant into one shared namespace — the same isolation failure arrived
 * at from the other side.
 */

import { createHash } from 'node:crypto'

/** SHA-256 of one value, lowercase hex. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Rejects a component that identifies nothing, naming this contract rather than
 * letting the value fail deeper inside `createHash`.
 *
 * The `typeof` check is not redundant with the parameter type. This function sits on
 * a trust boundary: the value crosses from consumer code, where the declared `string`
 * is a contract this library states and the caller may not honour — a `null` claim or
 * a numeric database id type-checks at their call site and arrives here anyway.
 *
 * @param label - Parameter name to quote in the message.
 * @param value - The candidate component.
 * @throws Error When the value is not a string, or is empty or whitespace-only.
 */
function assertIdentifies(label: string, value: string): void {
  if (typeof value !== 'string') {
    throw new Error(
      `[hashTenantRecipient] ${label} must be a string; received ${typeof value}. ` +
        'The declared type is a contract, not a guarantee, at this boundary.'
    )
  }
  if (value.trim() === '') {
    throw new Error(
      `[hashTenantRecipient] ${label} must not be empty or whitespace-only; ` +
        'a component that names nothing collapses distinct callers into one storage namespace.'
    )
  }
}

/**
 * Derives a deterministic, PII-free storage key fragment from a tenant and recipient.
 *
 * @param tenantId - Tenant isolation scope. Must be a non-blank string.
 * @param recipient - Pre-normalized recipient identifier. Must be a non-blank string.
 * @returns A 64-character lowercase hex SHA-256 digest. Order-sensitive, and unique
 *   per pair up to SHA-256's collision resistance — the encoding contributes no
 *   ambiguity of its own, so two distinct pairs never map onto one key by
 *   construction.
 * @throws Error When either component is not a string, or is empty or whitespace-only.
 */
export function hashTenantRecipient(tenantId: string, recipient: string): string {
  assertIdentifies('tenantId', tenantId)
  assertIdentifies('recipient', recipient)
  return createHash('sha256')
    .update(`${sha256(tenantId)}:${sha256(recipient)}`)
    .digest('hex')
}
