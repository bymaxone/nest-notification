/**
 * @fileoverview Holds the cause of a failed send to carrying the provider's message and its code,
 * and nothing else of the error it was built from.
 * @layer utils
 */

import { codeWithoutSecrets, maskedFailure } from './masked-failure'

describe('maskedFailure', () => {
  it('should carry the text and the provider code, and no cause', () => {
    const failure = maskedFailure(
      'refused',
      Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      []
    )

    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toBe('refused')
    expect((failure as Error & { code?: string }).code).toBe('ECONNREFUSED')
    expect(failure.cause).toBeUndefined()
  })

  it('should have no code of its own when the provider gave none', () => {
    const failure = maskedFailure('refused', new Error('x'), [])

    expect(Object.keys(failure)).toStrictEqual([])
    expect('code' in failure).toBe(false)
  })

  it('should carry no code that holds a value declared secret', () => {
    const error = Object.assign(new Error('x'), { code: 'ABC123' })

    const failure = maskedFailure('refused', error, ['ABC123'])

    expect('code' in failure).toBe(false)
    expect(JSON.stringify(failure)).not.toContain('ABC123')
  })
})

describe('codeWithoutSecrets', () => {
  it.each([
    ['a code that holds a secret', 'ABC123', ['b', 'C12'], undefined],
    ['a code that holds none', 'ECONNREFUSED', ['ABC123'], 'ECONNREFUSED'],
    ['no secret declared', 'ECONNREFUSED', undefined, 'ECONNREFUSED'],
    ['an empty secret', 'ECONNREFUSED', [''], 'ECONNREFUSED'],
    ['no code', undefined, ['ABC123'], undefined]
  ])('should answer for %s', (_label, code, secrets, expected) => {
    expect(codeWithoutSecrets(code, secrets)).toBe(expected)
  })
})
