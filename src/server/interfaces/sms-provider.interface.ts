/**
 * @fileoverview SMS provider contract (`ISmsProvider`) — v0.2 sketch.
 * @layer domain
 *
 * @since v0.2 (planned) — the interface is declared in v0.1 so consumers can plan
 * their dispatch code paths; `SmsService` is not implemented yet and
 * `validateOptions` rejects an `sms` channel.
 */

/** Options for one SMS to send. */
export interface SmsSendOptions {
  /** Recipient in E.164 format (e.g. `'+5511999998888'`). */
  to: string
  /** Sender (E.164 or an alphanumeric sender id). */
  from?: string
  /** Message body. */
  body: string
  /** Provider-side tracking tags (not supported by every provider). */
  tags?: ReadonlyArray<{ name: string; value: string }>
}

/** Result of a successful SMS send. */
export interface SmsSendResult {
  messageId: string
}

/**
 * SMS provider.
 *
 * @since v0.2 (planned) — implementations: Twilio, AWS SNS, MessageBird, Vonage.
 */
export interface ISmsProvider {
  /** Provider name (e.g. `'twilio'`, `'sns'`). */
  readonly name: string
  /** Whether the provider is configured and ready to send. */
  isConfigured(): boolean
  /**
   * Sends an SMS.
   *
   * @param options - The message envelope and body.
   * @returns The provider's send result.
   * @throws Error When the send fails.
   */
  send(options: SmsSendOptions): Promise<SmsSendResult>
}
