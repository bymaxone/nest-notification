/**
 * @fileoverview The closed set of log events this library writes. Every operational log line
 * carries one of these as its `event` field, beside the human-readable text in `message`, so a
 * log pipeline matches on `event` and a person reads the words.
 * @layer constants
 */

/**
 * The events, by short key. The value is the `event` field of the entry.
 *
 * An event names what happened and never what it happened to: identifiers, recipients and error
 * text stay out of it, and the closed set below is what the README's "Log events" table lists.
 */
export const NOTIFICATION_LOG_EVENTS = {
  /** The module was built; the message names the active channels. */
  BOOTSTRAP_OK: 'NOTIFICATION_BOOTSTRAP_OK',
  /** `otp.codeSecret` is not set, so OTP codes are stored in plaintext. */
  PLAINTEXT_OTP_CODES: 'NOTIFICATION_PLAINTEXT_OTP_CODES',
  /** A configured channel reports `isConfigured() = false` and is not enabled. */
  CHANNEL_NOT_USABLE: 'NOTIFICATION_CHANNEL_NOT_USABLE',
  /** The OTP storage does not carry the failed-attempt count across re-issues. */
  OTP_FAILURES_NOT_CARRIED: 'NOTIFICATION_OTP_FAILURES_NOT_CARRIED',
  /** The default OTP email template does not resolve (or could not be checked). */
  OTP_TEMPLATE_NOT_RESOLVED: 'NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED',
  /** An audit entry could not be written and the failure was swallowed. */
  AUDIT_WRITE_FAILED: 'NOTIFICATION_AUDIT_WRITE_FAILED',
  /** The Resend API call failed. */
  RESEND_SEND_FAILED: 'NOTIFICATION_RESEND_SEND_FAILED',
  /** The SMTP send failed. */
  SMTP_SEND_FAILED: 'NOTIFICATION_SMTP_SEND_FAILED',
  /** The SMTP transport could not be closed. */
  SMTP_CLOSE_FAILED: 'NOTIFICATION_SMTP_CLOSE_FAILED',
  /** The no-op email provider recorded a send, with the recipient masked. */
  NOOP_EMAIL: 'NOTIFICATION_NOOP_EMAIL'
} as const

/** One of the values of {@link NOTIFICATION_LOG_EVENTS}. */
export type NotificationLogEvent =
  (typeof NOTIFICATION_LOG_EVENTS)[keyof typeof NOTIFICATION_LOG_EVENTS]
