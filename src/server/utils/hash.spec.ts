import { hashTenantRecipient } from './hash'

describe('hashTenantRecipient', () => {
  // The key fragment must be a full SHA-256 hex digest so it is fixed-width and
  // collision-resistant.
  it('should produce a 64-character lowercase hex string', () => {
    expect(hashTenantRecipient('tenant-a', 'jane@acme.com')).toMatch(/^[0-9a-f]{64}$/)
  })

  // Deterministic: the same inputs must always map to the same key, or lookups break.
  it('should be deterministic for the same inputs', () => {
    expect(hashTenantRecipient('a', 'b')).toBe(hashTenantRecipient('a', 'b'))
  })

  // Order matters: swapping tenant and recipient must yield a different key so
  // `('a','b')` cannot collide with `('b','a')`.
  it('should be order-sensitive', () => {
    expect(hashTenantRecipient('a', 'b')).not.toBe(hashTenantRecipient('b', 'a'))
  })

  // Multi-tenancy gate: the same recipient under two tenants must not collide.
  it('should isolate the same recipient across tenants', () => {
    expect(hashTenantRecipient('tenant-a', 'jane@acme.com')).not.toBe(
      hashTenantRecipient('tenant-b', 'jane@acme.com')
    )
  })
})
