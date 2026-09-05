import { NOTIFICATION_ERROR_CODES } from '../../shared/constants/error-codes'
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

  // A component that names nothing is refused on either side: an empty tenant would
  // share one namespace across every caller omitting one, and an empty recipient
  // would collapse every recipient of a tenant onto one key. Whitespace names nothing
  // either — it produces a distinct key, so there is no collision, but there is also
  // no tenant, and a key filed under `' '` answers no question anyone asked.
  it.each([
    ['empty tenant id', '', 'jane@acme.com', 'tenantId'],
    ['empty recipient', 'tenant-a', '', 'recipient'],
    ['whitespace-only tenant id', '   ', 'jane@acme.com', 'tenantId'],
    ['whitespace-only recipient', 'tenant-a', '\t\n ', 'recipient']
  ])('should refuse a blank component (%s)', (_case, tenantId, recipient, named) => {
    expect(() => hashTenantRecipient(tenantId, recipient)).toThrow(
      expect.objectContaining({
        code: NOTIFICATION_ERROR_CODES.INVALID_SCOPE_IDENTIFIER,
        response: {
          error: expect.objectContaining({
            details: {
              boundary: 'hashTenantRecipient',
              parameter: named,
              reason: 'empty or whitespace-only'
            }
          })
        }
      })
    )
  })

  // The declared `string` is a contract this library states, not one the caller is
  // forced to honour: a null claim or a numeric database id type-checks at their call
  // site and arrives here anyway. Without this the value reaches `createHash().update`
  // and fails with a TypeError naming crypto's `data` argument instead of this rule.
  it.each([
    ['null tenant id', null, 'jane@acme.com', 'tenantId', 'object'],
    ['numeric tenant id', 123, 'jane@acme.com', 'tenantId', 'number'],
    ['undefined recipient', 'tenant-a', undefined, 'recipient', 'undefined']
  ])(
    'should refuse a non-string component naming this contract (%s)',
    (_case, tenantId, recipient, named, received) => {
      // Called through `Reflect.apply` rather than cast past the signature: this is
      // how untyped consumer code reaches the function, and it needs no suppression
      // to express.
      expect(() => Reflect.apply(hashTenantRecipient, undefined, [tenantId, recipient])).toThrow(
        expect.objectContaining({
          code: NOTIFICATION_ERROR_CODES.INVALID_SCOPE_IDENTIFIER,
          response: {
            error: expect.objectContaining({
              details: {
                boundary: 'hashTenantRecipient',
                parameter: named,
                reason: `expected a string, received ${received}`
              }
            })
          }
        })
      )
    }
  )

  // The response message is what an HTTP consumer actually reads, and it carries the
  // same three facts as `details` — a consumer that never inspects `details` still learns
  // which boundary refused and why. Asserted because nothing else reads it.
  it('should name the boundary, parameter and reason in the response message', () => {
    const thrown = (() => {
      try {
        hashTenantRecipient('tenant-a', '   ')
      } catch (error: unknown) {
        return error as { getResponse: () => { error: { message: string } } }
      }
      return null
    })()

    expect(thrown?.getResponse().error.message).toBe(
      '[hashTenantRecipient] recipient empty or whitespace-only'
    )
  })

  // `details` is serialized into the HTTP response, so the refusal must name the
  // boundary and the reason without echoing the value — a tenant id or a recipient is
  // exactly what must not come back to the caller in an error body.
  it('should not echo the offending value in the serialized error', () => {
    const thrown = (() => {
      try {
        hashTenantRecipient('  ', 'jane@acme.com')
      } catch (error: unknown) {
        return error
      }
      return null
    })()

    expect(JSON.stringify(thrown)).not.toContain('jane@acme.com')
  })
})
