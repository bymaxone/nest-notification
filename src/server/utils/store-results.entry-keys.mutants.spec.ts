/**
 * @fileoverview Holds the answer of `get` to every field of an entry: each is copied by name, so a
 * field the list leaves out would vanish from what the library reads.
 * @layer utils
 */

import { checkStoreResult } from './store-results'

const ENTRY = {
  code: 'hash',
  expiresAt: 1_700_000_000_000,
  attempts: 2,
  maxAttempts: 5,
  validated: true,
  metadata: { purpose: 'login' }
}

describe('checkStoreResult for get', () => {
  it.each(Object.entries(ENTRY))('should carry the %s field of the entry', (key, value) => {
    const answer = checkStoreResult('get', ENTRY, 'store') as Record<string, unknown>

    expect(answer[key]).toEqual(value)
  })

  it('should carry exactly the six fields and no other', () => {
    const answer = checkStoreResult('get', { ...ENTRY, extra: 1 }, 'store')

    expect(Object.keys(answer as object).sort()).toEqual(Object.keys(ENTRY).sort())
  })
})
