/**
 * @fileoverview Email send provider contract (`IEmailProvider`) and its DTOs.
 * @layer domain
 *
 * Defines *what* to send, never *how*. Reference adapters (Resend, SendGrid, SES)
 * implement this; `EmailService` consumes it and maps thrown errors to
 * `NotificationException`.
 */

/**
 * Email send provider.
 *
 * Implementations must:
 * - never log the email body in plaintext (it may carry OTP codes / PII);
 * - never leak credentials (API keys) in error messages;
 * - throw an `Error` with a useful message on failure — `EmailService` catches it
 *   and converts it to a `NotificationException`.
 */
export interface IEmailProvider {
  /**
   * Sends a transactional email.
   *
   * @param options - The message envelope and body.
   * @returns The provider's send result (carries the `messageId`).
   * @throws Error When the send fails; `EmailService` converts it to a `NotificationException`.
   */
  send(options: EmailSendOptions): Promise<EmailSendResult>

  /**
   * Whether the provider is configured and ready to send. Used by `EmailService`
   * for startup validation (e.g. warn when credentials are missing).
   */
  isConfigured(): boolean

  /** Provider name (e.g. `'resend'`, `'sendgrid'`, `'ses'`) — used in logs and audit. */
  readonly name: string
}

/** A single email attachment. `content` is a `Buffer` or a base64 string. */
export interface EmailAttachment {
  filename: string
  content: Buffer | string
  contentType?: string
}

/** Options describing one transactional email to send. */
export interface EmailSendOptions {
  /** Recipient email address(es). */
  to: string | string[]
  /** Sender email (overrides the channel's `defaultFrom`). */
  from?: string
  /** Sender display name. */
  fromName?: string
  /** Subject line. */
  subject: string
  /** HTML body. */
  html: string
  /** Plain-text body (recommended for deliverability). */
  text?: string
  /** Reply-to address. */
  replyTo?: string
  /** Carbon-copy recipient(s). */
  cc?: string | string[]
  /** Blind carbon-copy recipient(s). */
  bcc?: string | string[]
  /** Provider-side tracking tags (Resend tags, SES tags, …). */
  tags?: ReadonlyArray<{ name: string; value: string }>
  /** Custom headers. */
  headers?: Record<string, string>
  /** Attachments. */
  attachments?: ReadonlyArray<EmailAttachment>
  /**
   * Secret values a provider must scrub from any error text it logs or throws
   * — a relay that echoes the rejected content puts the body (and any secret
   * inside it, e.g. an OTP code) into the transport error.
   */
  redactValues?: readonly string[]
  /**
   * Whether this send's failures may surface the text the provider authored.
   * `false` means the adapter must publish none of it — not in a log line, not
   * in the message of the error it throws — because the body carries a
   * credential and redaction cannot be relied on to remove it.
   */
  publishProviderText?: boolean
}

/** Result of a successful send. `messageId` is provider-specific; useful for audit correlation. */
export interface EmailSendResult {
  messageId: string
}
