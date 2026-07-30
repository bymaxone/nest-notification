/**
 * @fileoverview SMS provider contract (`ISmsProvider`) — declared, not yet served.
 * @layer domain
 *
 * The contract is exported so consumers can plan their dispatch code paths against a
 * stable shape. No `SmsService` implements it, and `validateOptions` rejects an `sms`
 * channel at startup rather than letting it fail on the first send.
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
 * Intended implementations: Twilio, AWS SNS, MessageBird, Vonage.
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
