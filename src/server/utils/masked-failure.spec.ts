/**
 * @fileoverview Holds the cause of a failed send to carrying the provider's message and its code,
 * and nothing else of the error it was built from.
 * @layer utils
 */

import { maskedFailure } from './masked-failure'

describe('maskedFailure', () => {
  it('should carry the text and the provider code, and no cause', () => {
    const failure = maskedFailure(
      'refused',
      Object.assign(new Error('x'), { code: 'ECONNREFUSED' })
    )

    expect(failure).toBeInstanceOf(Error)
    expect(failure.message).toBe('refused')
    expect((failure as Error & { code?: string }).code).toBe('ECONNREFUSED')
    expect(failure.cause).toBeUndefined()
  })

  it('should have no code of its own when the provider gave none', () => {
    const failure = maskedFailure('refused', new Error('x'))

    expect(Object.keys(failure)).toStrictEqual([])
    expect('code' in failure).toBe(false)
  })
})
