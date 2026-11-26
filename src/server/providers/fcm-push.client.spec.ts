/**
 * @fileoverview Holds the one POST to Google to its bound on the size of an answer: at most
 * 65 536 bytes are read, and a larger answer is unreadable, like one that is not JSON.
 * @layer infrastructure
 */

import { postToGoogle } from './fcm-push.client'

const LIMIT = 65_536
const URL = 'https://oauth2.googleapis.com/token'

/** A JSON string literal of exactly `bytes` bytes. */
const jsonOf = (bytes: number): string => `"${'a'.repeat(bytes - 2)}"`

/** A response whose body arrives in the given chunks, recording a cancellation. */
function chunked(chunks: Uint8Array[], status = 200): { response: Response; cancelled: boolean } {
  const state = { response: undefined as unknown as Response, cancelled: false }
  let next = 0
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[next++]
        if (chunk === undefined) {
          controller.close()
          return
        }
        controller.enqueue(chunk)
      },
      cancel() {
        state.cancelled = true
      }
    },
    { highWaterMark: 0 }
  )
  state.response = new Response(body, { status })
  return state
}

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

  it('stops reading and cancels the stream once over the limit', async () => {
    /* Arrange */
    const chunk = new Uint8Array(LIMIT).fill(0x20)
    const state = chunked([chunk, chunk, chunk, chunk])
    const reads = jest.fn()
    const reader = state.response.body!.getReader.bind(state.response.body)
    jest.spyOn(state.response.body!, 'getReader').mockImplementation((() => {
      const real = reader()
      const read = real.read.bind(real)
      real.read = () => {
        reads()
        return read()
      }
      return real
    }) as ReadableStream['getReader'])
    /* Act */
    const call = await post(state.response)
    /* Assert */
    expect(call).toEqual({ kind: 'answer', status: 200, body: undefined })
    expect(reads).toHaveBeenCalledTimes(2)
    expect(state.cancelled).toBe(true)
  })

  it('decodes a character split between two chunks', async () => {
    /* Arrange */
    const bytes = new TextEncoder().encode('{"a":"é"}')
    const state = chunked([bytes.slice(0, 7), bytes.slice(7)])
    /* Act */
    const call = await post(state.response)
    /* Assert */
    expect(call).toEqual({ kind: 'answer', status: 200, body: { a: 'é' } })
  })

  it('keeps a character cut off at the end of the answer', async () => {
    /* Arrange: the first byte of a two-byte character after valid JSON */
    const state = chunked([new Uint8Array([0x31, 0xc3])])
    /* Act */
    const call = await post(state.response)
    /* Assert */
    expect(call).toEqual({ kind: 'answer', status: 200, body: undefined })
  })

  it('answers no body for an answer without one', async () => {
    /* Act */
    const call = await post(new Response(null, { status: 204 }))
    /* Assert */
    expect(call).toEqual({ kind: 'answer', status: 204, body: undefined })
  })
})
