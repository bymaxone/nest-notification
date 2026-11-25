/**
 * @fileoverview A receipts answer with no data map, told apart by the `errors` list it carries.
 * @layer infrastructure
 */

import { ExpoPushProvider } from './expo-push.provider'
import type { ExpoFetch } from './expo-push.client'

/** A fetch that answers every call with this one body. */
function answering(body: unknown): ExpoFetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

/** Awaits a call that must reject and hands back the error it rejected with. */
async function failureOf(pending: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await pending
  } catch (error) {
    return error as Error & { code?: string }
  }
  throw new Error('the call was expected to reject')
}

describe('ExpoPushProvider.fetchReceipts, an answer with no data map', () => {
  it.each([
    ['TOO_MANY_REQUESTS', 'rate_limited', 'EUNAVAILABLE'],
    ['UNAUTHORIZED', 'credentials', undefined],
    ['SOMETHING_ELSE', 'provider_unavailable', undefined]
  ] as const)(
    'classifies the first error code %s of a 200 answer with no data as %s',
    async (code, reason, errorCode) => {
      /* Arrange */
      const fetch = answering({ errors: [{ code, message: 'x' }] })
      /* Act */
      const failure = await failureOf(new ExpoPushProvider({ fetch }).fetchReceipts(['A']))
      /* Assert */
      expect(failure.message).toBe(`ExpoPushProvider: the push was not sent (${reason})`)
      expect(failure.code).toBe(errorCode)
    }
  )

  it.each([
    ['an empty errors list', { errors: [] }],
    ['an error with no code', { errors: [{ message: 'x' }] }],
    ['errors that is not a list', { errors: 'TOO_MANY_REQUESTS' }]
  ] as const)('keeps the plain failure for a 200 answer with no data and %s', async (_l, body) => {
    /* Arrange */
    const fetch = answering(body)
    /* Act */
    const failure = await failureOf(new ExpoPushProvider({ fetch }).fetchReceipts(['A']))
    /* Assert */
    expect(failure.message).toBe('ExpoPushProvider: the push was not sent (provider_unavailable)')
    expect(failure.code).toBeUndefined()
  })
})
