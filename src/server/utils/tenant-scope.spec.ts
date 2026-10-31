import { assertIdentifies } from './tenant-scope'

describe('assertIdentifies', () => {
  // A control character in an identifier reaches the consumer's audit sink and
  // log lines verbatim: a newline forges a second log record. No legitimate tenant
  // or recipient contains one, so it is refused like a blank.
  it.each([
    ['a newline', 'acme\nINJECTED'],
    ['a carriage return', 'acme\rINJECTED'],
    ['a tab', 'ac\tme'],
    ['a NUL', 'ac\u0000me'],
    ['DEL', 'ac\u007fme'],
    ['a C1 control', 'ac\u0085me']
  ])('should refuse %s', (_label, value) => {
    expect(() => assertIdentifies('Owner', 'tenantId', value)).toThrow(
      expect.objectContaining({
        code: 'notification.invalid_scope_identifier',
        response: {
          error: expect.objectContaining({
            details: {
              boundary: 'Owner',
              parameter: 'tenantId',
              reason: 'contains a control character'
            }
          })
        }
      })
    )
  })

  // The refusal must not echo the value: details is serialized into the response.
  it('should not carry the offending value in the exception', () => {
    let caught: unknown
    try {
      assertIdentifies('Owner', 'tenantId', 'secret\nvalue')
    } catch (error) {
      caught = error
    }

    expect(JSON.stringify(caught)).not.toContain('secret')
    expect((caught as Error).message).not.toContain('secret')
  })

  // Ordinary identifiers, including ones with separators and non-ASCII letters, pass.
  it.each(['acme', 'tenant_123', 'a:b', '../../etc', 'ação-ünï', 'x'.repeat(5000)])(
    'should accept %j',
    (value) => {
      expect(() => assertIdentifies('Owner', 'tenantId', value)).not.toThrow()
    }
  )

  // Empty, whitespace-only and non-string values are refused.
  it('should keep refusing empty, whitespace-only and non-string values', () => {
    expect(() => assertIdentifies('Owner', 'x', '')).toThrow()
    expect(() => assertIdentifies('Owner', 'x', '   ')).toThrow()
    expect(() => assertIdentifies('Owner', 'x', 7 as unknown as string)).toThrow()
  })
})
