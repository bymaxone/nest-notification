/**
 * @fileoverview One HTTPS call to the Expo Push Service, answered as data and never as an exception.
 * @layer infrastructure
 *
 * The URLs are constants of this file: nothing a caller or an option holds can point a request
 * anywhere else, and a redirect is refused rather than followed. The access token is read once into
 * the header of each call and appears nowhere else. A failure is a classified {@link ExpoFailure};
 * the service's own text, an error message or a response body never leaves this file.
 */

import { errorCodeOf } from '../utils/availability'
import { readBounded } from '../utils/bounded-body'
import { checkedAwait } from '../utils/realm-root'
import {
  MIXED_PROJECTS_CODE,
  OUTCOME_UNKNOWN,
  classifyRequestFailure,
  classifyTransportFailure
} from './expo-push.codes'
import type { ExpoFailure } from './expo-push.codes'
import { field } from './expo-push.mapping'

// Read from the global once, when the module loads: a later replacement of the built-in changes nothing here.
const parseJson = JSON.parse
const stringifyJson = JSON.stringify

/** The most bytes of an answer that are read: a read of 1000 receipts is a few hundred kilobytes. */
const ANSWER_LIMIT = 1_048_576

/** The only endpoint a send goes to. */
export const EXPO_SEND_URL = 'https://exp.host/--/api/v2/push/send'

/** The only endpoint a receipt read goes to. */
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts'

/** The fetch the adapter calls; the platform's by default, a host's when it needs a proxy agent. */
export type ExpoFetch = (url: string, init: RequestInit) => Promise<Response>

/** A call that did not succeed. */
export interface ExpoRefusal {
  readonly kind: 'failed'
  readonly failure: ExpoFailure
  /** The `details` of a mixed-project refusal, the one piece of an error body a caller reads. */
  readonly mixedProjects?: unknown
}

/** How one call ended. */
export type ExpoCall = { readonly kind: 'ok'; readonly body: unknown } | ExpoRefusal

/** What a call needs besides its payload. */
export interface ExpoCallOptions {
  readonly fetch: ExpoFetch
  readonly accessToken: string | undefined
  readonly timeoutMs: number
  readonly owner: string
}

/** Parses JSON, `undefined` when the text is not JSON. */
function parse(text: string): unknown {
  try {
    return parseJson(text) as unknown
  } catch {
    return undefined
  }
}

/** Builds the failure of an answer that was not a success, or that carries an `errors` list instead of data. */
export function refused(status: number, body: unknown): ExpoRefusal {
  const first: unknown = Array.isArray(field(body, 'errors'))
    ? (field(body, 'errors') as unknown[])[0]
    : undefined
  const code = field(first, 'code')
  const failure = classifyRequestFailure(status, code)
  return code === MIXED_PROJECTS_CODE
    ? { kind: 'failed', failure, mixedProjects: field(first, 'details') }
    : { kind: 'failed', failure }
}

/**
 * Posts one JSON payload to one of the two fixed endpoints.
 *
 * @param url - {@link EXPO_SEND_URL} or {@link EXPO_RECEIPTS_URL}.
 * @param payload - The JSON body.
 * @param options - The fetch, the access token, the bound and the owner named in a refusal.
 * @returns The parsed body of a 2xx answer, or the classified failure. An answer over 1 MiB is read
 * no further and counts as one that does not parse.
 */
export async function callExpo(
  url: typeof EXPO_SEND_URL | typeof EXPO_RECEIPTS_URL,
  payload: unknown,
  options: ExpoCallOptions
): Promise<ExpoCall> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json'
  }
  if (options.accessToken !== undefined) {
    headers.authorization = `Bearer ${options.accessToken}`
  }
  let response: Response
  let text: string | undefined
  try {
    response = await checkedAwait(
      options.fetch(url, {
        method: 'POST',
        headers,
        body: stringifyJson(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs)
      }),
      options.owner
    )
    text = await checkedAwait(readBounded(response, ANSWER_LIMIT, options.owner), options.owner)
  } catch (error) {
    return { kind: 'failed', failure: classifyTransportFailure(errorCodeOf(error)) }
  }
  const body = text === undefined ? undefined : parse(text)
  if (!response.ok) {
    return refused(response.status, body)
  }
  // A 2xx the service sent that does not parse may still have been acted on.
  return body === undefined ? { kind: 'failed', failure: OUTCOME_UNKNOWN } : { kind: 'ok', body }
}
