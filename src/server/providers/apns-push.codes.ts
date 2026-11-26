/**
 * @fileoverview Classifies a refusal of APNs from its status and `reason`.
 * @layer infrastructure
 */

import {
  MESSAGE_TOO_BIG,
  OUTCOME_UNKNOWN,
  RATE_LIMITED,
  REJECTED_CREDENTIALS,
  TOKEN_INVALID,
  TOKEN_UNREGISTERED,
  UNKNOWN_FAILURE,
  UNREACHABLE
} from '../utils/push-outcome'
import type { PushFailure } from '../utils/push-outcome'

/** The reason APNs gives for a provider token over its age. */
export const EXPIRED_PROVIDER_TOKEN = 'ExpiredProviderToken'

/** The reason of a provider that signs new tokens too often. */
const TOO_MANY_TOKEN_UPDATES = 'TooManyProviderTokenUpdates'

/** The refusals a `status reason` pair names. A `BadDeviceToken` is often a wrong environment, so it never unregisters. */
const BY_ANSWER: ReadonlyMap<string, PushFailure> = new Map([
  ['410 Unregistered', TOKEN_UNREGISTERED],
  ['410 ExpiredToken', TOKEN_UNREGISTERED],
  ['400 BadDeviceToken', TOKEN_INVALID],
  ['400 DeviceTokenNotForTopic', TOKEN_INVALID],
  ['400 TopicDisallowed', REJECTED_CREDENTIALS]
])

/** The refusals the status alone names. */
const BY_STATUS: ReadonlyMap<number, PushFailure> = new Map([
  [403, REJECTED_CREDENTIALS],
  [413, MESSAGE_TOO_BIG],
  [429, RATE_LIMITED]
])

/**
 * Classifies an answer that is not a success.
 *
 * @param status - The HTTP status.
 * @param reason - The `reason` of the body, when it had one.
 * @returns The failure. A `500` or `503` is retryable only when APNs itself said why.
 */
export function classifyApnsRefusal(status: number, reason: string | undefined): PushFailure {
  if (status >= 500) {
    const said = reason !== undefined && (status === 500 || status === 503)
    return said ? UNREACHABLE : OUTCOME_UNKNOWN
  }
  return (
    BY_ANSWER.get(`${String(status)} ${String(reason)}`) ?? BY_STATUS.get(status) ?? UNKNOWN_FAILURE
  )
}

/** Whether a refusal is about the account, so that no other token of the batch would pass. */
export function refusesAccount(failure: PushFailure, reason: string | undefined): boolean {
  return failure === REJECTED_CREDENTIALS || reason === TOO_MANY_TOKEN_UPDATES
}
