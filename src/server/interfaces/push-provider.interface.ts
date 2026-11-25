/**
 * @fileoverview Push provider contract (`IPushProvider`).
 * @layer domain
 *
 * A provider sends one notification to many device tokens and answers per token, with a closed
 * {@link PushFailureReason} the host can act on. The library stores no tokens: the host does, and
 * deletes the ones a result reports as `token_unregistered`.
 */

import type {
  PushFailureReason,
  PushReceiptResult,
  PushTokenResult
} from '../../shared/types/push.types'

/** Options for one push notification to send. */
export interface PushSendOptions {
  /** Device token(s). */
  tokens: string | string[]
  /** Notification title. */
  title: string
  /** Notification body. */
  body: string
  /** Arbitrary data payload read by the mobile client. */
  data?: Record<string, string>
  /** Image URL. Ignored by a provider that cannot show one. */
  imageUrl?: string
  /** Sound (e.g. `'default'`, `'custom.caf'`). */
  sound?: string
  /** Badge count (iOS). */
  badge?: number
  /** Time-to-live in seconds. */
  ttlSeconds?: number
  /** Delivery priority. */
  priority?: 'high' | 'normal'
  /** Android notification channel id. */
  channelId?: string
  /** iOS subtitle, shown under the title. */
  subtitle?: string
  /** Category id of the action buttons the client registered. */
  categoryId?: string
  /** Replaces an earlier undelivered message with the same key (Android). Ignored by Expo. */
  collapseKey?: string
  /** Groups notifications in the notification centre (iOS). Ignored by Expo. */
  threadId?: string
  /** Lets an iOS notification service extension change the content before it is shown. */
  mutableContent?: boolean
  /** Wakes the app in the background with no visible notification (iOS silent push). */
  contentAvailable?: boolean
}

/** Per-token result of a push send, in the order the tokens were given. */
export interface PushSendResult {
  results: Array<
    PushTokenResult & {
      /**
       * @deprecated Free text a provider put here is never published by the adapters this package
       * ships, which leave it unset. Read `reason` instead.
       */
      error?: string
    }
  >
}

/**
 * Push notification provider.
 *
 * Shipped implementation: Expo Push Service (`ExpoPushProvider`, from the `./push` subpath). A host can
 * implement its own. Import `./push` at startup, next to the main entry: it checks the realm root against
 * a snapshot it takes when it is first imported, so a lazy import takes its baseline at that moment.
 */
export interface IPushProvider {
  /** Provider name (e.g. `'expo'`). */
  readonly name: string
  /** Whether the provider is configured and ready to send. */
  isConfigured(): boolean
  /**
   * Sends a push notification to one or more device tokens.
   *
   * It answers per token. It throws only when nothing was sent, so a caller that retries a thrown
   * send does not deliver twice what an earlier chunk had already carried.
   *
   * @param options - The notification payload and target tokens.
   * @returns Per-token send results.
   * @throws Error When nothing was sent.
   */
  send(options: PushSendOptions): Promise<PushSendResult>
  /**
   * Reads the delivery receipts of messages an earlier send accepted. Optional: a provider that
   * answers delivery at send time has none.
   *
   * @param ticketIds - The `messageId` values the send returned.
   * @returns One receipt per id, `pending` for an id the provider has no receipt for yet.
   */
  fetchReceipts?(ticketIds: readonly string[]): Promise<PushReceiptResult[]>
}

export type { PushFailureReason, PushReceiptResult, PushTokenResult }
