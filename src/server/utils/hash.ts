/**
 * @fileoverview SHA-256 hashing of `(tenantId, recipient)` for storage keys.
 * @layer infrastructure
 *
 * Storage keys are `sha256(`${tenantId}:${recipient}`)` for two reasons:
 * 1. Privacy — an operator with `KEYS`-level access to the store cannot enumerate
 *    the email/phone of every recipient with a pending OTP.
 * 2. Multi-tenancy — SHA-256 preimage resistance makes a cross-tenant key
 *    collision computationally infeasible.
 */

import { createHash } from 'node:crypto'

/**
 * Derives a deterministic, PII-free storage key fragment from a tenant and recipient.
 *
 * @param tenantId - Tenant isolation scope.
 * @param recipient - Pre-normalized recipient identifier.
 * @returns A 64-character lowercase hex SHA-256 digest. Order-sensitive.
 */
export function hashTenantRecipient(tenantId: string, recipient: string): string {
  return createHash('sha256').update(`${tenantId}:${recipient}`).digest('hex')
}
