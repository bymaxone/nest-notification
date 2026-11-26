/**
 * @fileoverview Maps what FCM HTTP v1 answers to the closed failure set.
 * @layer infrastructure
 *
 * The tables are closed, and a token is reported gone only on the one documented answer that says
 * so, since a host deletes such tokens.
 */

import {
  OUTCOME_UNKNOWN,
  RATE_LIMITED,
  REJECTED_CREDENTIALS,
  TOKEN_INVALID,
  TOKEN_UNREGISTERED,
  UNKNOWN_FAILURE,
  UNREACHABLE,
  field
} from '../utils/push-outcome'
import type { PushFailure } from '../utils/push-outcome'

/** What the `errorCode` of an `FcmError` detail means, whatever the status. */
const FCM_ERRORS: ReadonlyMap<string, PushFailure> = new Map<string, PushFailure>(
  Object.entries({
    SENDER_ID_MISMATCH: TOKEN_INVALID,
    QUOTA_EXCEEDED: RATE_LIMITED,
    UNAVAILABLE: UNREACHABLE,
    INTERNAL: UNREACHABLE,
    THIRD_PARTY_AUTH_ERROR: REJECTED_CREDENTIALS
  })
)

/** The `details` list of an error body, empty when it has none. */
function detailsOf(body: unknown): unknown[] {
  const details = field(field(body, 'error'), 'details')
  return Array.isArray(details) ? (details as unknown[]) : []
}

/** The FCM `errorCode` of an error body, when it has one. */
export function fcmErrorCode(body: unknown): string | undefined {
  for (const detail of detailsOf(body)) {
    const code = field(detail, 'errorCode')
    if (typeof code === 'string') {
      return code
    }
  }
  return undefined
}

/** Whether a field violation of the body is about the device token. */
function namesToken(body: unknown): boolean {
  return detailsOf(body).some((detail) => {
    const violations = field(detail, 'fieldViolations')
    return (
      Array.isArray(violations) &&
      violations.some((violation) => field(violation, 'field') === 'message.token')
    )
  })
}

/** Reads a 5xx: only an enveloped 500 or 503 refused the call; others may follow a delivery. */
function serverFailure(status: number, body: unknown): PushFailure {
  const enveloped = typeof field(field(body, 'error'), 'status') === 'string'
  return enveloped && (status === 500 || status === 503) ? UNREACHABLE : OUTCOME_UNKNOWN
}

/**
 * Classifies a send FCM refused.
 *
 * @param status - The HTTP status, not a 2xx.
 * @param body - The parsed body, `undefined` when it was not JSON.
 * @returns The failure.
 */
export function classifyFcmRefusal(status: number, body: unknown): PushFailure {
  const code = fcmErrorCode(body)
  if (code === 'UNREGISTERED' && status === 404) {
    return TOKEN_UNREGISTERED
  }
  const named = code === undefined ? undefined : FCM_ERRORS.get(code)
  if (named !== undefined) {
    return named
  }
  if (status === 400 && namesToken(body)) {
    return TOKEN_INVALID
  }
  if (status === 401 || status === 403) {
    return REJECTED_CREDENTIALS
  }
  if (status === 429) {
    return RATE_LIMITED
  }
  return status >= 500 ? serverFailure(status, body) : UNKNOWN_FAILURE
}
