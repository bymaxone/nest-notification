/**
 * @fileoverview SHA-256 hashing of `(tenantId, recipient)` for storage keys.
 * @layer infrastructure
 *
 * Storage keys are `sha256(sha256(tenantId):sha256(recipient))` for two reasons:
 * 1. Privacy — an operator with `KEYS`-level access to the store cannot enumerate
 *    the email/phone of every recipient with a pending OTP.
 * 2. Multi-tenancy — each component is hashed to a fixed length BEFORE the two are
 *    joined, so the pair is encoded unambiguously.
 *
 * The second point is about the encoding, not about the digest, and no property of
 * SHA-256 substitutes for it. Joining the raw values around a delimiter makes
 * `('acme:bob', 'x')` and `('acme', 'bob:x')` produce the same input string — and
 * therefore the same key — while preimage and collision resistance hold perfectly.
 * Neither component may be empty: `('', r)` would put every caller that omits a
 * tenant into one shared namespace, which is the same isolation failure arrived at
 * from the other side.
 */

import { createHash } from 'node:crypto'

/** SHA-256 of one value, lowercase hex. */
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Derives a deterministic, PII-free storage key fragment from a tenant and recipient.
 *
 * @param tenantId - Tenant isolation scope. Must be non-empty.
 * @param recipient - Pre-normalized recipient identifier. Must be non-empty.
 * @returns A 64-character lowercase hex SHA-256 digest. Order-sensitive, and
 *   injective in the pair: distinct `(tenantId, recipient)` pairs never share a key.
 * @throws Error When either component is empty.
 */
export function hashTenantRecipient(tenantId: string, recipient: string): string {
  if (tenantId === '' || recipient === '') {
    throw new Error(
      '[hashTenantRecipient] tenantId and recipient must both be non-empty; ' +
        'an empty component collapses distinct callers into one storage namespace.'
    )
  }
  return createHash('sha256')
    .update(`${sha256(tenantId)}:${sha256(recipient)}`)
    .digest('hex')
}
