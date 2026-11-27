/**
 * @fileoverview Reads the text of an HTTP answer up to a bound.
 * @layer infrastructure
 */

import { checkedAwait, silence } from './realm-root'

/**
 * Reads a web stream chunk by chunk, so it costs at most the bound and one chunk.
 *
 * @param response - The answer whose body is read.
 * @param limit - The most bytes accepted.
 * @param owner - The component named in a refusal of the realm.
 * @returns The text; `''` for an answer without a body and past the bound, where a stream is
 * cancelled. An empty text parses to nothing, so a caller needs no case of its own for either.
 */
export async function readBounded(
  response: Response,
  limit: number,
  owner: string
): Promise<string> {
  // An injected fetch may offer only `text()`: such an answer is bounded after buffering.
  if (typeof response.body?.getReader !== 'function') {
    const body = await checkedAwait(response.text(), owner)
    return Buffer.byteLength(body) > limit ? '' : body
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await checkedAwait(reader.read(), owner)
    if (done) {
      return text + decoder.decode()
    }
    bytes += value.byteLength
    if (bytes > limit) {
      // Not awaited: on a cloned answer it settles only once the other branch is done with too.
      silence(reader.cancel())
      return ''
    }
    text += decoder.decode(value, { stream: true })
  }
}

/** The bytes of an answer that arrives as chunks, kept up to a bound. */
export interface BoundedChunks {
  /** Keeps a chunk; `false` once the answer is over the bound, when the caller stops its stream. */
  add: (chunk: Buffer) => boolean
  /** The text kept; `''` past the bound. */
  text: () => string
}

/**
 * Collects an answer that is pushed to the caller, as a Node stream does.
 *
 * @param limit - The most bytes accepted.
 * @returns An empty collector.
 */
export function boundedChunks(limit: number): BoundedChunks {
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  return {
    add: (chunk): boolean => {
      bytes += chunk.byteLength
      if (bytes > limit) {
        return false
      }
      text += decoder.decode(chunk, { stream: true })
      return true
    },
    text: (): string => (bytes > limit ? '' : text + decoder.decode())
  }
}
