/**
 * @fileoverview The classified failure of a direct push adapter and the result of a token it did not serve.
 * @layer utils
 *
 * A failure is a closed reason and a retry answer, never the provider's words. `retryable` is true
 * only when the message was certainly not accepted, since neither provider deduplicates.
 */

import type { PushFailureReason } from '../../shared/types/push.types'
import type { PushSendResult } from '../interfaces/push-provider.interface'

/** A classified failure: why, and whether sending the same message again is safe. */
export interface PushFailure {
  readonly reason: PushFailureReason
  readonly retryable: boolean
}

/** One result of a send, as `PushSendResult` holds it. */
export type PushOutcome = PushSendResult['results'][number]

/** Builds one frozen failure. */
function failure(reason: PushFailureReason, retryable: boolean): PushFailure {
  return Object.freeze({ reason, retryable })
}

/** An answer no table names. The message is not known to be undelivered. */
export const UNKNOWN_FAILURE = failure('unknown', false)

/** No connection was made, or the provider refused before processing: sending again is safe. */
export const UNREACHABLE = failure('provider_unavailable', true)

/** The message may have been accepted and the answer lost: sending again could deliver twice. */
export const OUTCOME_UNKNOWN = failure('provider_unavailable', false)

/** Too many messages. */
export const RATE_LIMITED = failure('rate_limited', true)

/** The server's configuration was refused. */
export const REJECTED_CREDENTIALS = failure('credentials', false)

/** The token is gone for good. */
export const TOKEN_UNREGISTERED = failure('token_unregistered', false)

/** The token cannot be served by this sender. */
export const TOKEN_INVALID = failure('token_invalid', false)

/** The payload is over the provider's limit. */
export const MESSAGE_TOO_BIG = failure('message_too_big', false)

/** Codes Node sets when no connection was made, so nothing reached the provider. */
const NEVER_CONNECTED: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/**
 * Classifies a request that failed before an answer.
 *
 * @param code - The `code` of the error or of its `cause`, when it had one.
 * @returns {@link UNREACHABLE} only when the code proves no connection was made.
 */
export function transportFailure(code: string | undefined): PushFailure {
  return code !== undefined && NEVER_CONNECTED.has(code) ? UNREACHABLE : OUTCOME_UNKNOWN
}

/** The result of a token that was not served. */
export function failedOutcome(token: string, cause: PushFailure): PushOutcome {
  return { token, reason: cause.reason, retryable: cause.retryable }
}

/** Reads a field of a parsed value without trusting its shape. */
export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}
