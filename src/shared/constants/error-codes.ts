/**
 * @fileoverview Public error-code catalog for the shared subpath.
 * @layer shared
 *
 * Zero-dependency map of every notification error code. The string values are
 * the single source of truth a frontend matches against; the server's
 * `NOTIFICATION_ERROR_DEFINITIONS` re-states the same codes (with HTTP status +
 * message) and a CI gate asserts the two stay byte-for-byte identical.
 */

/**
 * Stable error-code identifiers, keyed by their symbolic name.
 *
 * Values are namespaced under `notification.*` and never change once published —
 * consumers branch on them to localize messages. The 22 entries cover the email,
 * template, OTP, SMS, push, audit, and channel-config failure surfaces.
 */
export const NOTIFICATION_ERROR_CODES = {
  EMAIL_PROVIDER_NOT_CONFIGURED: 'notification.email_provider_not_configured',
  EMAIL_SEND_FAILED: 'notification.email_send_failed',
  EMAIL_ATTACHMENTS_TOO_LARGE: 'notification.email_attachments_too_large',
  EMAIL_INVALID_RECIPIENT: 'notification.email_invalid_recipient',
  /** The email payload carries neither a `template` nor a `subject` + `html` body source. */
  EMAIL_MISSING_BODY: 'notification.email_missing_body',
  TEMPLATE_NOT_FOUND: 'notification.template_not_found',
  TEMPLATE_RENDER_FAILED: 'notification.template_render_failed',
  OTP_STORAGE_NOT_CONFIGURED: 'notification.otp_storage_not_configured',
  OTP_EMAIL_DELIVERY_NOT_CONFIGURED: 'notification.otp_email_delivery_not_configured',
  OTP_COOLDOWN_ACTIVE: 'notification.otp_cooldown_active',
  OTP_NOT_FOUND: 'notification.otp_not_found',
  OTP_EXPIRED: 'notification.otp_expired',
  OTP_MAX_ATTEMPTS_EXCEEDED: 'notification.otp_max_attempts_exceeded',
  OTP_INVALID_CODE: 'notification.otp_invalid_code',
  OTP_INVALID_LENGTH: 'notification.otp_invalid_length',
  SMS_PROVIDER_NOT_CONFIGURED: 'notification.sms_provider_not_configured',
  SMS_SEND_FAILED: 'notification.sms_send_failed',
  SMS_INVALID_RECIPIENT: 'notification.sms_invalid_recipient',
  PUSH_PROVIDER_NOT_CONFIGURED: 'notification.push_provider_not_configured',
  PUSH_SEND_FAILED: 'notification.push_send_failed',
  AUDIT_LOG_FAILED: 'notification.audit_log_failed',
  CHANNEL_DISABLED: 'notification.channel_disabled'
} as const

/**
 * The literal-union type of every value in {@link NOTIFICATION_ERROR_CODES}.
 */
export type NotificationErrorCode =
  (typeof NOTIFICATION_ERROR_CODES)[keyof typeof NOTIFICATION_ERROR_CODES]
