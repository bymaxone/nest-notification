/**
 * @fileoverview Holds the bounded read of an HTTP body.
 * @layer infrastructure
 */

import { readBounded } from './bounded-body'

const LIMIT = 8

/** A response whose body arrives in the given chunks, counting the pulls and a cancellation. */
function chunked(chunks: Uint8Array[]): {
  response: Response
  pulls: number
  cancelled: boolean
} {
  const state = { response: undefined as unknown as Response, pulls: 0, cancelled: false }
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const chunk = chunks[state.pulls++]
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
  state.response = new Response(body)
  return state
}

const read = (response: Response): Promise<string | undefined> =>
  readBounded(response, LIMIT, 'Test')

describe('readBounded', () => {
  it('reads a body of exactly the bound', async () => {
    expect(await read(new Response('a'.repeat(LIMIT)))).toBe('a'.repeat(LIMIT))
  })

  it('answers nothing for one byte over the bound', async () => {
    expect(await read(new Response('a'.repeat(LIMIT + 1)))).toBeUndefined()
  })

  it('stops reading and cancels the stream once over the bound', async () => {
    /* Arrange */
    const chunk = new Uint8Array(LIMIT)
    const state = chunked([chunk, chunk, chunk, chunk])
    /* Act */
    const text = await read(state.response)
    /* Assert */
    expect(text).toBeUndefined()
    expect(state.pulls).toBe(2)
    expect(state.cancelled).toBe(true)
  })

  it('counts bytes, not characters', async () => {
    expect(await read(new Response('é'.repeat(LIMIT / 2 + 1)))).toBeUndefined()
  })

  it('decodes a character split between two chunks', async () => {
    /* Arrange */
    const bytes = new TextEncoder().encode('aébc')
    /* Act */
    const text = await read(chunked([bytes.slice(0, 2), bytes.slice(2)]).response)
    /* Assert */
    expect(text).toBe('aébc')
  })

  it('marks a character cut off at the end of the body', async () => {
    /* Arrange: the first byte of a two-byte character */
    const state = chunked([new Uint8Array([0x31, 0xc3])])
    /* Act / Assert */
    expect(await read(state.response)).toBe('1\uFFFD')
  })

  it('answers an empty text for an answer without a body', async () => {
    expect(await read(new Response(null, { status: 204 }))).toBe('')
  })
})
