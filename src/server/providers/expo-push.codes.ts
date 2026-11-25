/**
 * @fileoverview Maps what the Expo Push Service answers to the closed {@link PushFailureReason} set.
 * @layer infrastructure
 *
 * Every table here is closed: a code that is not in it is `unknown`, and none of the provider's own
 * words (a message, a `details` object) is carried to the caller. The tables are the documented
 * contract of the service (docs.expo.dev/push-notifications/sending-notifications), pinned by specs.
 */

import type { PushFailureReason } from '../../shared/types/push.types'

/** A classified failure: why, and whether sending the same message again is safe. */
export interface ExpoFailure {
  readonly reason: PushFailureReason
  readonly retryable: boolean
}

/** What a device-level `details.error` of a ticket or a receipt means. */
const DEVICE_ERRORS: ReadonlyMap<string, ExpoFailure> = new Map<string, ExpoFailure>(
  Object.entries({
    DeviceNotRegistered: { reason: 'token_unregistered', retryable: false },
    MessageTooBig: { reason: 'message_too_big', retryable: false },
    MessageRateExceeded: { reason: 'rate_limited', retryable: true },
    MismatchSenderId: { reason: 'credentials', retryable: false },
    InvalidCredentials: { reason: 'credentials', retryable: false }
  })
)

/** The refusals that need no code to be read. */
const RATE_LIMITED: ExpoFailure = Object.freeze({ reason: 'rate_limited', retryable: true })
const REJECTED_CREDENTIALS: ExpoFailure = Object.freeze({ reason: 'credentials', retryable: false })

/** What a request-level `errors[0].code` means, for the codes that reject a whole call. */
const REQUEST_ERRORS: ReadonlyMap<string, ExpoFailure> = new Map<string, ExpoFailure>(
  Object.entries({
    TOO_MANY_REQUESTS: { reason: 'rate_limited', retryable: true },
    UNAUTHORIZED: { reason: 'credentials', retryable: false }
  })
)

/** A refusal this table does not name. The outcome is not known to be a non-delivery. */
export const UNKNOWN_FAILURE: ExpoFailure = Object.freeze({ reason: 'unknown', retryable: false })

/** The service could not be reached before a connection was made: nothing was sent, so retrying is safe. */
export const UNREACHABLE: ExpoFailure = Object.freeze({
  reason: 'provider_unavailable',
  retryable: true
})

/**
 * The service may have accepted the message and the answer was lost (a timeout, a reset, a body that
 * did not parse). Expo does not deduplicate, so sending again could deliver twice.
 */
export const OUTCOME_UNKNOWN: ExpoFailure = Object.freeze({
  reason: 'provider_unavailable',
  retryable: false
})

/** The request code of a call that mixes the tokens of more than one project. */
export const MIXED_PROJECTS_CODE = 'PUSH_TOO_MANY_EXPERIENCE_IDS'

/**
 * Classifies the `details.error` of a ticket or a receipt.
 *
 * @param code - The value the service put there, of any kind.
 * @returns The failure; `unknown` for a value the table does not name.
 */
export function classifyDeviceError(code: unknown): ExpoFailure {
  return (typeof code === 'string' ? DEVICE_ERRORS.get(code) : undefined) ?? UNKNOWN_FAILURE
}

/**
 * Classifies a call the service rejected as a whole.
 *
 * @param status - The HTTP status.
 * @param code - The `errors[0].code` of the body, when it had one.
 * @returns The failure. A 429, and a 5xx that carries an Expo errors envelope, are refused before
 *   processing and retryable; a bare 5xx may follow a delivery and is not. Any other refusal is not
 *   known to change on a retry.
 */
export function classifyRequestFailure(status: number, code: unknown): ExpoFailure {
  const named = typeof code === 'string' ? REQUEST_ERRORS.get(code) : undefined
  if (named !== undefined) {
    return named
  }
  if (status === 429) {
    return RATE_LIMITED
  }
  if (status === 401 || status === 403) {
    return REJECTED_CREDENTIALS
  }
  if (status >= 500) {
    // An errors envelope is the service refusing the call itself. A bare 502, 503 or 504 can be a
    // gateway answering after the service took the batch, so it is read like a timeout.
    return typeof code === 'string' ? UNREACHABLE : OUTCOME_UNKNOWN
  }
  return UNKNOWN_FAILURE
}

/** Codes Node sets when no connection was made, so nothing reached the service. */
const NEVER_CONNECTED: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/**
 * Classifies a request that failed before an answer: a timeout, a reset, a refused connection.
 *
 * @param code - The `code` of the error or of its `cause`, when it had one.
 * @returns Retryable only when the code proves no connection was made. A timeout or a reset may
 *   come after the service took the message, so it is not retryable.
 */
export function classifyTransportFailure(code: string | undefined): ExpoFailure {
  return code !== undefined && NEVER_CONNECTED.has(code) ? UNREACHABLE : OUTCOME_UNKNOWN
}

/** The shape of an Expo push token. A prefix, brackets, and no whitespace, control character or bracket inside. */
const EXPO_TOKEN = /^(?:Exponent|Expo)PushToken\[[^[\]\s\p{Cc}]{1,128}\]$/u

/**
 * Whether a string has the shape of an Expo push token. A token that fails is refused locally as
 * `token_invalid`, before any call, so it cannot cost the batch its place.
 */
export function isExpoPushToken(token: string): boolean {
  return EXPO_TOKEN.test(token)
}
