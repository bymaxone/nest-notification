/**
 * @fileoverview Reads the text of an HTTP answer up to a bound.
 * @layer infrastructure
 */

import { checkedAwait } from './realm-root'

/**
 * Reads a body chunk by chunk, so that an answer of any size costs at most the bound and one chunk.
 *
 * @param response - The answer whose body is read.
 * @param limit - The most bytes accepted.
 * @param owner - The component named in a refusal of the realm.
 * @returns The text, `''` for an answer without a body, or `undefined` past the bound, where the
 * stream is cancelled.
 */
export async function readBounded(
  response: Response,
  limit: number,
  owner: string
): Promise<string | undefined> {
  if (response.body === null) {
    return ''
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
      return undefined
    }
    text += decoder.decode(value, { stream: true })
  }
}
