/**
 * @fileoverview Holds the one POST to Google to its bound on the size of an answer: at most
 * 65 536 bytes are accepted, and a larger answer is unreadable, like one that is not JSON.
 * @layer infrastructure
 */

import { postToGoogle } from './fcm-push.client'

const LIMIT = 65_536
const URL = 'https://oauth2.googleapis.com/token'

/** A JSON string literal of exactly `bytes` bytes. */
const jsonOf = (bytes: number): string => `"${'a'.repeat(bytes - 2)}"`

const post = (response: Response): ReturnType<typeof postToGoogle> =>
  postToGoogle(URL, {}, '', {
    fetch: () => Promise.resolve(response),
    timeoutMs: 1000,
    owner: 'FcmPushProvider'
  })

describe('postToGoogle, size of an answer', () => {
  it('reads an answer of exactly the limit', async () => {
    /* Act */
    const call = await post(new Response(jsonOf(LIMIT)))
    /* Assert */
    expect(call).toEqual({ kind: 'answer', status: 200, body: 'a'.repeat(LIMIT - 2) })
  })

  it('answers no body for one byte over the limit', async () => {
    /* Act */
    const call = await post(new Response(jsonOf(LIMIT + 1), { status: 503 }))
    /* Assert */
    expect(call).toEqual({ kind: 'answer', status: 503, body: undefined })
  })

  it('answers no body for an answer without one', async () => {
    /* Act */
    const call = await post(new Response(null, { status: 204 }))
    /* Assert */
    expect(call).toEqual({ kind: 'answer', status: 204, body: undefined })
  })
})
