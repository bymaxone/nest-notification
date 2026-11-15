/**
 * @fileoverview Specifies `assertIdentifies`: blank, non-string and control-character
 * identifiers are refused without echoing the value; ordinary identifiers pass.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'

import { assertIdentifies, assertPurpose, MAX_PURPOSE_LENGTH, purposeProblem } from './tenant-scope'

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

/** The exception `assertPurpose` raised for `value`, or `undefined` when it accepted it. */
function refusalOf(value: unknown): unknown {
  try {
    assertPurpose('Owner', value as string)
    return undefined
  } catch (error) {
    return error
  }
}

describe('assertPurpose', () => {
  // A purpose is part of every storage key, of the audit entry and of the template data: it is a
  // short name the host chooses, not free text.
  it.each([
    ['the canonical email_verification', 'email_verification'],
    ['the canonical password_reset', 'password_reset'],
    ['one character', 'p'],
    ['upper case', 'MFA_OOB'],
    ['digits', 'step2'],
    ['a hyphen', 'magic-link'],
    ['a colon', 'auth:login'],
    ['64 characters', 'a'.repeat(64)],
    ['64 colons', ':'.repeat(64)],
    ['64 mixed characters', `${'Az09:_-'.repeat(9)}x`]
  ])('should accept %s', (_label, value) => {
    expect(() => assertPurpose('Owner', value)).not.toThrow()
    expect(purposeProblem(value)).toBeUndefined()
  })

  it('should state the limit it holds', () => {
    expect(MAX_PURPOSE_LENGTH).toBe(64)
  })

  it.each([
    ['an empty string', '', 'empty'],
    ['65 characters', 'a'.repeat(65), 'longer than 64 characters'],
    ['65 colons', ':'.repeat(65), 'longer than 64 characters'],
    ['a space', 'a b', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a dot', 'auth.login', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a slash', 'a/b', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a backslash', 'a\\b', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a newline', 'a\nb', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a trailing newline', 'login\n', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a NUL', 'a\u0000b', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a non-ASCII letter', 'a\u00E9', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a fullwidth letter', '\uFF41', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a glob star', 'a*', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a glob question mark', 'a?b', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a glob bracket', 'a[b]', 'contains a character outside A-Z a-z 0-9 : _ -'],
    ['a percent', '%41', 'contains a character outside A-Z a-z 0-9 : _ -']
  ])('should refuse %s', (_label, value, reason) => {
    expect(refusalOf(value)).toEqual(
      expect.objectContaining({
        code: 'notification.invalid_scope_identifier',
        response: {
          error: expect.objectContaining({
            details: { boundary: 'Owner', parameter: 'purpose', reason }
          })
        }
      })
    )
    expect(purposeProblem(value)).toBe(reason)
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 7],
    ['an object', {}],
    ['an array', ['a']]
  ])('should refuse %s as not a string', (_label, value) => {
    expect(refusalOf(value)).toEqual(
      expect.objectContaining({
        response: {
          error: expect.objectContaining({
            details: expect.objectContaining({ parameter: 'purpose' })
          })
        }
      })
    )
    expect(purposeProblem(value)).toMatch(/^expected a string, received /)
  })

  // The refusal is serialized into the response: it names the boundary and the parameter, never the value.
  it('should not carry the offending value in the exception', () => {
    const caught = refusalOf('top secret/value')

    expect(JSON.stringify(caught)).not.toContain('secret')
    expect((caught as Error).message).not.toContain('secret')
    expect((caught as NotificationException).getResponse()).toMatchObject({
      error: { message: '[Owner] purpose contains a character outside A-Z a-z 0-9 : _ -' }
    })
  })
})
