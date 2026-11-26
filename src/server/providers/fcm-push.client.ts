/**
 * @fileoverview One HTTPS POST to Google, answered as data and never as an exception.
 * @layer infrastructure
 *
 * The hosts are constants of this file and a redirect is refused rather than followed.
 */

import { errorCodeOf } from '../utils/availability'
import { readBounded } from '../utils/bounded-body'
import { transportFailure } from '../utils/push-outcome'
import type { PushFailure } from '../utils/push-outcome'
import { checkedAwait } from '../utils/realm-root'

// Read from the global once, when the module loads: a later replacement of the built-in changes nothing here.
const parseJson = JSON.parse

/** The most bytes of an answer that are read. */
const ANSWER_LIMIT = 65_536

/** The only endpoint an access token is asked of, and the audience of the assertion. */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** The send endpoint of a project. `projectId` was checked at construction. */
export function fcmSendUrl(projectId: string): string {
  return `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`
}

/** The fetch the adapter calls; the platform's by default, a host's when it needs a proxy agent. */
export type FcmFetch = (url: string, init: RequestInit) => Promise<Response>

/** What a call needs besides its address and body. */
export interface FcmCallOptions {
  readonly fetch: FcmFetch
  readonly timeoutMs: number
  readonly owner: string
}

/** An answer with its status and parsed body (`undefined` when not JSON), or a lost request. */
export type FcmCall =
  | { readonly kind: 'answer'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'lost'; readonly failure: PushFailure }

/** Parses JSON, `undefined` when the text is not JSON. */
function parse(text: string): unknown {
  try {
    return parseJson(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * Posts one body.
 *
 * @param url - {@link GOOGLE_TOKEN_URL} or {@link fcmSendUrl}.
 * @param headers - The headers of the call.
 * @param body - The encoded body.
 * @param options - The fetch, the bound and the owner named in a refusal.
 * @returns The status and parsed body, or the classified transport failure. The body is `undefined`
 * when the answer is not JSON or is over 65 536 bytes.
 */
export async function postToGoogle(
  url: string,
  headers: Record<string, string>,
  body: string,
  options: FcmCallOptions
): Promise<FcmCall> {
  try {
    const response = await checkedAwait(
      options.fetch(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs)
      }),
      options.owner
    )
    const text = await checkedAwait(
      readBounded(response, ANSWER_LIMIT, options.owner),
      options.owner
    )
    const parsed = text === undefined ? undefined : parse(text)
    return { kind: 'answer', status: response.status, body: parsed }
  } catch (error) {
    return { kind: 'lost', failure: transportFailure(errorCodeOf(error)) }
  }
}
