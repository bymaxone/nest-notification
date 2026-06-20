/**
 * @fileoverview Server-side error catalog: code + HTTP status + default message.
 * @layer domain
 *
 * Each definition pairs a stable error code with the HTTP status and English
 * message `NotificationException` emits. The code strings are byte-for-byte
 * identical to `shared/constants/error-codes.ts`; a CI gate asserts the two stay
 * in sync.
 */

import { HttpStatus } from '@nestjs/common'

import { NOTIFICATION_ERROR_CODES } from '../../shared/constants/error-codes'

/** Shape of one entry in {@link NOTIFICATION_ERROR_DEFINITIONS}. */
export interface NotificationErrorDefinition {
  code: string
  status: HttpStatus
  message: string
}

/**
 * The complete error catalog, keyed by symbolic name. Drives both the HTTP status
 * and the default message of every `NotificationException`.
 */
export const NOTIFICATION_ERROR_DEFINITIONS = {
  EMAIL_PROVIDER_NOT_CONFIGURED: {
    code: NOTIFICATION_ERROR_CODES.EMAIL_PROVIDER_NOT_CONFIGURED,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Email provider not configured'
  },
  EMAIL_SEND_FAILED: {
    code: NOTIFICATION_ERROR_CODES.EMAIL_SEND_FAILED,
    status: HttpStatus.BAD_GATEWAY,
    message: 'Failed to send email'
  },
  EMAIL_ATTACHMENTS_TOO_LARGE: {
    code: NOTIFICATION_ERROR_CODES.EMAIL_ATTACHMENTS_TOO_LARGE,
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    message: 'Email attachments exceed size limit'
  },
  EMAIL_INVALID_RECIPIENT: {
    code: NOTIFICATION_ERROR_CODES.EMAIL_INVALID_RECIPIENT,
    status: HttpStatus.BAD_REQUEST,
    message: 'Invalid recipient email'
  },
  EMAIL_MISSING_BODY: {
    code: NOTIFICATION_ERROR_CODES.EMAIL_MISSING_BODY,
    status: HttpStatus.BAD_REQUEST,
    message: 'Email payload requires either a template or a subject and html body'
  },
  TEMPLATE_NOT_FOUND: {
    code: NOTIFICATION_ERROR_CODES.TEMPLATE_NOT_FOUND,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Email template not found'
  },
  TEMPLATE_RENDER_FAILED: {
    code: NOTIFICATION_ERROR_CODES.TEMPLATE_RENDER_FAILED,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Failed to render email template'
  },
  OTP_STORAGE_NOT_CONFIGURED: {
    code: NOTIFICATION_ERROR_CODES.OTP_STORAGE_NOT_CONFIGURED,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'OTP storage not configured'
  },
  OTP_EMAIL_DELIVERY_NOT_CONFIGURED: {
    code: NOTIFICATION_ERROR_CODES.OTP_EMAIL_DELIVERY_NOT_CONFIGURED,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'OTP email delivery requested but email channel not configured'
  },
  OTP_COOLDOWN_ACTIVE: {
    code: NOTIFICATION_ERROR_CODES.OTP_COOLDOWN_ACTIVE,
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Resend cooldown is active'
  },
  OTP_NOT_FOUND: {
    code: NOTIFICATION_ERROR_CODES.OTP_NOT_FOUND,
    status: HttpStatus.NOT_FOUND,
    message: 'OTP not found or expired'
  },
  OTP_EXPIRED: {
    code: NOTIFICATION_ERROR_CODES.OTP_EXPIRED,
    status: HttpStatus.GONE,
    message: 'OTP code expired'
  },
  OTP_MAX_ATTEMPTS_EXCEEDED: {
    code: NOTIFICATION_ERROR_CODES.OTP_MAX_ATTEMPTS_EXCEEDED,
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Maximum OTP attempts exceeded'
  },
  OTP_INVALID_CODE: {
    code: NOTIFICATION_ERROR_CODES.OTP_INVALID_CODE,
    status: HttpStatus.UNAUTHORIZED,
    message: 'Invalid OTP code'
  },
  OTP_INVALID_LENGTH: {
    code: NOTIFICATION_ERROR_CODES.OTP_INVALID_LENGTH,
    status: HttpStatus.BAD_REQUEST,
    message: 'Invalid OTP length config'
  },
  SMS_PROVIDER_NOT_CONFIGURED: {
    code: NOTIFICATION_ERROR_CODES.SMS_PROVIDER_NOT_CONFIGURED,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'SMS provider not configured'
  },
  SMS_SEND_FAILED: {
    code: NOTIFICATION_ERROR_CODES.SMS_SEND_FAILED,
    status: HttpStatus.BAD_GATEWAY,
    message: 'Failed to send SMS'
  },
  SMS_INVALID_RECIPIENT: {
    code: NOTIFICATION_ERROR_CODES.SMS_INVALID_RECIPIENT,
    status: HttpStatus.BAD_REQUEST,
    message: 'Invalid phone number'
  },
  PUSH_PROVIDER_NOT_CONFIGURED: {
    code: NOTIFICATION_ERROR_CODES.PUSH_PROVIDER_NOT_CONFIGURED,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Push provider not configured'
  },
  PUSH_SEND_FAILED: {
    code: NOTIFICATION_ERROR_CODES.PUSH_SEND_FAILED,
    status: HttpStatus.BAD_GATEWAY,
    message: 'Failed to send push notification'
  },
  AUDIT_LOG_FAILED: {
    code: NOTIFICATION_ERROR_CODES.AUDIT_LOG_FAILED,
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Audit log write failed'
  },
  CHANNEL_DISABLED: {
    code: NOTIFICATION_ERROR_CODES.CHANNEL_DISABLED,
    status: HttpStatus.NOT_IMPLEMENTED,
    message: 'Channel not enabled in module config'
  }
} as const satisfies Record<string, NotificationErrorDefinition>

/** The symbolic key of any entry in {@link NOTIFICATION_ERROR_DEFINITIONS}. */
export type NotificationErrorKey = keyof typeof NOTIFICATION_ERROR_DEFINITIONS

/**
 * Indexed view of the catalog keyed by symbolic name. Using a `Map` for lookups
 * avoids object-injection on a caller-supplied key (CodeQL js/prototype-pollution
 * and the `security/detect-object-injection` lint).
 */
export const NOTIFICATION_ERROR_DEFINITION_MAP: ReadonlyMap<
  NotificationErrorKey,
  NotificationErrorDefinition
> = new Map(
  Object.entries(NOTIFICATION_ERROR_DEFINITIONS) as Array<
    [NotificationErrorKey, NotificationErrorDefinition]
  >
)

export { NOTIFICATION_ERROR_CODES } from '../../shared/constants/error-codes'
