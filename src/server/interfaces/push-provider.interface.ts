/**
 * @fileoverview Push provider contract (`IPushProvider`) — v0.2 sketch.
 * @layer domain
 *
 * @since v0.2 (planned) — the interface is declared in v0.1 so consumers can plan
 * their dispatch code paths; `PushService` is not implemented yet and
 * `validateOptions` rejects a `push` channel.
 */

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
  /** Image URL. */
  imageUrl?: string
  /** Sound (e.g. `'default'`, `'custom.caf'`). */
  sound?: string
  /** Badge count (iOS). */
  badge?: number
  /** Time-to-live in seconds. */
  ttlSeconds?: number
  /** Delivery priority. */
  priority?: 'high' | 'normal'
}

/** Per-token result of a push send. */
export interface PushSendResult {
  results: Array<{ token: string; messageId?: string; error?: string }>
}

/**
 * Push notification provider.
 *
 * @since v0.2 (planned) — implementations: FCM (Firebase), APN (Apple), Web Push (VAPID).
 */
export interface IPushProvider {
  /** Provider name (e.g. `'fcm'`). */
  readonly name: string
  /** Whether the provider is configured and ready to send. */
  isConfigured(): boolean
  /**
   * Sends a push notification to one or more device tokens.
   *
   * @param options - The notification payload and target tokens.
   * @returns Per-token send results.
   * @throws Error When the send fails wholesale.
   */
  send(options: PushSendOptions): Promise<PushSendResult>
}
