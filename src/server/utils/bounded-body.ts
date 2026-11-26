/**
 * @fileoverview Reads the text of an HTTP answer up to a bound.
 * @layer infrastructure
 */

import { checkedAwait } from './realm-root'

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
      await checkedAwait(reader.cancel(), owner)
      return ''
    }
    text += decoder.decode(value, { stream: true })
  }
}
