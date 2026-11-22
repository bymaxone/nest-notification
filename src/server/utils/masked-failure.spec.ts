/**
 * @fileoverview Holds the code a provider's error carried to being published only when it holds no
 * value the caller declared secret.
 * @layer utils
 */

import { codeWithoutSecrets } from './masked-failure'

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
