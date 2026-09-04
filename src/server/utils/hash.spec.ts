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

  // The property the isolation rests on, stated as a test rather than as a comment:
  // the pair must be encoded so no two distinct pairs share an input. Joining the raw
  // values around a delimiter fails exactly here — every case below produced ONE key
  // under `sha256(`${tenantId}:${recipient}`)`, whatever the digest's strength.
  it.each([
    ['delimiter moved left', 'acme:bob', 'x', 'acme', 'bob:x'],
    ['delimiter moved right', 'a', 'b:c:d', 'a:b', 'c:d'],
    ['boundary at the very start', ':x', 'y', '', 'x:y'],
    ['boundary at the very end', 'x', 'y:', 'x:y', '']
  ])(
    'should not collide when the boundary shifts (%s)',
    (_case, tenantA, recipientA, tenantB, recipientB) => {
      const keyOf = (tenantId: string, recipient: string): string | symbol => {
        try {
          return hashTenantRecipient(tenantId, recipient)
        } catch {
          // An empty component is refused outright, which is a stronger answer than a
          // distinct key. A unique symbol can never equal the other side's digest.
          return Symbol('refused')
        }
      }
      expect(keyOf(tenantA, recipientA)).not.toBe(keyOf(tenantB, recipientB))
    }
  )

  // An empty tenant is not a tenant: every caller omitting one would otherwise share
  // a single namespace, which is the isolation failure reached from the other side.
  it('should refuse an empty tenant id', () => {
    expect(() => hashTenantRecipient('', 'jane@acme.com')).toThrow(
      'tenantId and recipient must both be non-empty'
    )
  })

  // Same reasoning on the other component — an empty recipient collapses every
  // recipient of one tenant onto one key.
  it('should refuse an empty recipient', () => {
    expect(() => hashTenantRecipient('tenant-a', '')).toThrow(
      'tenantId and recipient must both be non-empty'
    )
  })
})
