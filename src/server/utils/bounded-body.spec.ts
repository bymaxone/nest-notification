/**
 * @fileoverview Holds the bounded read of an HTTP body.
 * @layer infrastructure
 */

import { boundedChunks, readBounded } from './bounded-body'

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

const read = (response: Response): Promise<string> => readBounded(response, LIMIT, 'Test')

describe('readBounded', () => {
  it('reads a body of exactly the bound', async () => {
    expect(await read(new Response('a'.repeat(LIMIT)))).toBe('a'.repeat(LIMIT))
  })

  it('answers nothing for one byte over the bound', async () => {
    expect(await read(new Response('a'.repeat(LIMIT + 1)))).toBe('')
  })

  it('stops reading and cancels the stream once over the bound', async () => {
    /* Arrange */
    const chunk = new Uint8Array(LIMIT)
    const state = chunked([chunk, chunk, chunk, chunk])
    /* Act */
    const text = await read(state.response)
    /* Assert */
    expect(text).toBe('')
    expect(state.pulls).toBe(2)
    expect(state.cancelled).toBe(true)
  })

  // Cancelling one branch of a clone settles only once the other branch is cancelled or read.
  it('does not wait for the cancellation of a cloned answer', async () => {
    /* Arrange: the other branch is never read */
    const response = new Response('a'.repeat(LIMIT + 1))
    const other = response.clone()
    /* Act / Assert */
    expect(await read(response)).toBe('')
    expect(other.bodyUsed).toBe(false)
  }, 1_000)

  it('answers nothing when the cancellation rejects', async () => {
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => controller.enqueue(new Uint8Array(LIMIT + 1)),
      cancel: () => Promise.reject(new Error('no'))
    })

    expect(await read(new Response(body))).toBe('')
  })

  it('counts bytes, not characters', async () => {
    expect(await read(new Response('é'.repeat(LIMIT / 2 + 1)))).toBe('')
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

  // An injected fetch may answer with something that has `text()` but no web stream as its body.
  const shaped = (body: object | undefined, text: string): Response =>
    Object.defineProperties(new Response(), {
      body: { value: body },
      text: { value: () => Promise.resolve(text) }
    })

  it.each([
    ['a body that is no web stream', { pipe: () => undefined }],
    ['no body property', undefined]
  ])('reads %s through text()', async (_case, body) => {
    expect(await read(shaped(body, 'a'.repeat(LIMIT)))).toBe('a'.repeat(LIMIT))
  })

  it('holds a text() read to the bound in bytes', async () => {
    expect(await read(shaped(undefined, 'é'.repeat(LIMIT / 2 + 1)))).toBe('')
  })

  it('answers an empty text for an answer without a body', async () => {
    expect(await read(new Response(null, { status: 204 }))).toBe('')
  })
})

describe('boundedChunks', () => {
  it('collects chunks up to exactly the bound, decoding a character split between two', () => {
    /* Arrange */
    const bytes = Buffer.from('abcdef\u00e9')
    const collector = boundedChunks(LIMIT)
    /* Act */
    const kept = [collector.add(bytes.subarray(0, 7)), collector.add(bytes.subarray(7))]
    /* Assert */
    expect(kept).toEqual([true, true])
    expect(collector.text()).toBe('abcdef\u00e9')
  })

  it('keeps nothing past the bound, and stays past it', () => {
    /* Arrange */
    const collector = boundedChunks(LIMIT)
    /* Act */
    const kept = [
      collector.add(Buffer.from('12345678')),
      collector.add(Buffer.from('9')),
      collector.add(Buffer.alloc(0))
    ]
    /* Assert */
    expect(kept).toEqual([true, false, false])
    expect(collector.text()).toBe('')
  })

  it('is empty when nothing arrived', () => {
    /* Assert */
    expect(boundedChunks(LIMIT).text()).toBe('')
  })
})
