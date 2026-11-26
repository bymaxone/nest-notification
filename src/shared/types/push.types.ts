/**
 * @fileoverview Push-channel result types shared by the server and by any client that types them.
 * @layer shared
 *
 * Zero-dependency types. A push provider answers per device token, and the host acts on the answer
 * (it stores the tokens), so the answer is a closed set rather than provider text.
 */

/**
 * Why one device token was not served. A closed set: the provider's own words never reach it.
 *
 * - `token_unregistered` — the token is gone for good; the host must delete it.
 * - `token_invalid` — malformed, or it belongs to another project; the host must not retry it.
 * - `message_too_big` — the payload exceeds the provider's limit; shrink it.
 * - `rate_limited` — too many messages; retry later.
 * - `provider_unavailable` — the provider could not be reached or answered with a transient error.
 * - `credentials` — a configuration problem on the server's side, never the device's.
 * - `unknown` — the provider answered with something this set does not name.
 */
export type PushFailureReason =
  | 'token_unregistered'
  | 'token_invalid'
  | 'message_too_big'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'credentials'
  | 'unknown'

/** The outcome of one device token in a send. */
export interface PushTokenResult {
  /** The device token this result is for, exactly as the caller gave it. */
  token: string
  /**
   * The provider's id for the accepted message. For Expo it is the ticket id, which
   * `fetchReceipts` takes later; for FCM it is the message name. Absent when the token was not served.
   */
  messageId?: string
  /** Why the token was not served. Absent when it was. */
  reason?: PushFailureReason
  /**
   * Whether sending the same message to this token again is safe. `false` for a refusal that will
   * not change, and for an outcome the provider may or may not have acted on, since a provider
   * that does not deduplicate would deliver it twice.
   */
  retryable?: boolean
}

/** The delivery state of one accepted message, as a later receipt call reports it. */
export type PushReceiptStatus = 'ok' | 'pending' | 'error'

/** The receipt of one accepted message, keyed by the id the send returned. */
export interface PushReceiptResult {
  /** The id `PushTokenResult.messageId` carried. The host keeps the id-to-token mapping. */
  ticketId: string
  /** `pending` when the provider has no receipt for the id yet, which is not a failure. */
  status: PushReceiptStatus
  /** Why delivery failed, when `status` is `error`. */
  reason?: PushFailureReason
  /** Whether sending again is safe, when `status` is `error`. */
  retryable?: boolean
}
