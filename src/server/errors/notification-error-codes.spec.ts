/**
 * @fileoverview Pins the whole `NOTIFICATION_ERROR_DEFINITIONS` catalog by exact value. A mutation
 * run neither removes a property from a constant table nor changes a number in it, so a default
 * message could vanish from an entry, or a status drift, with every test green; consumers read
 * these messages and statuses off every `NotificationException`.
 * @layer domain
 */

import { HttpStatus } from '@nestjs/common'

import { NOTIFICATION_ERROR_DEFINITIONS } from './notification-error-codes'

/**
 * The catalog as published. The codes are written out here rather than read from the shared
 * catalog, so the two cannot drift together unseen.
 */
const EXPECTED_CATALOG = {
  EMAIL_PROVIDER_NOT_CONFIGURED: {
    code: 'notification.email_provider_not_configured',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Email provider not configured'
  },
  EMAIL_SEND_FAILED: {
    code: 'notification.email_send_failed',
    status: HttpStatus.BAD_GATEWAY,
    message: 'Failed to send email'
  },
  EMAIL_ATTACHMENTS_TOO_LARGE: {
    code: 'notification.email_attachments_too_large',
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    message: 'Email attachments exceed size limit'
  },
  EMAIL_INVALID_RECIPIENT: {
    code: 'notification.email_invalid_recipient',
    status: HttpStatus.BAD_REQUEST,
    message: 'Invalid recipient email'
  },
  EMAIL_MISSING_BODY: {
    code: 'notification.email_missing_body',
    status: HttpStatus.BAD_REQUEST,
    message: 'Email payload requires either a template or a subject and html body'
  },
  TEMPLATE_NOT_FOUND: {
    code: 'notification.template_not_found',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Email template not found'
  },
  TEMPLATE_RENDER_FAILED: {
    code: 'notification.template_render_failed',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Failed to render email template'
  },
  OTP_STORAGE_NOT_CONFIGURED: {
    code: 'notification.otp_storage_not_configured',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'OTP storage not configured'
  },
  OTP_EMAIL_DELIVERY_NOT_CONFIGURED: {
    code: 'notification.otp_email_delivery_not_configured',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'OTP email delivery requested but email channel not configured'
  },
  OTP_MANUAL_DELIVERY_UNAVAILABLE: {
    code: 'notification.otp_manual_delivery_unavailable',
    status: HttpStatus.BAD_REQUEST,
    message: 'OTP manual delivery is unavailable while otp.codeSecret is set'
  },
  OTP_COOLDOWN_ACTIVE: {
    code: 'notification.otp_cooldown_active',
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Resend cooldown is active'
  },
  OTP_NOT_FOUND: {
    code: 'notification.otp_not_found',
    status: HttpStatus.NOT_FOUND,
    message: 'OTP not found or expired'
  },
  OTP_EXPIRED: {
    code: 'notification.otp_expired',
    status: HttpStatus.GONE,
    message: 'OTP code expired'
  },
  OTP_MAX_ATTEMPTS_EXCEEDED: {
    code: 'notification.otp_max_attempts_exceeded',
    status: HttpStatus.TOO_MANY_REQUESTS,
    message: 'Maximum OTP attempts exceeded'
  },
  OTP_INVALID_CODE: {
    code: 'notification.otp_invalid_code',
    status: HttpStatus.UNAUTHORIZED,
    message: 'Invalid OTP code'
  },
  OTP_INVALID_LENGTH: {
    code: 'notification.otp_invalid_length',
    status: HttpStatus.BAD_REQUEST,
    message: 'Invalid OTP length config'
  },
  SMS_PROVIDER_NOT_CONFIGURED: {
    code: 'notification.sms_provider_not_configured',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'SMS provider not configured'
  },
  SMS_SEND_FAILED: {
    code: 'notification.sms_send_failed',
    status: HttpStatus.BAD_GATEWAY,
    message: 'Failed to send SMS'
  },
  SMS_INVALID_RECIPIENT: {
    code: 'notification.sms_invalid_recipient',
    status: HttpStatus.BAD_REQUEST,
    message: 'Invalid phone number'
  },
  PUSH_PROVIDER_NOT_CONFIGURED: {
    code: 'notification.push_provider_not_configured',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Push provider not configured'
  },
  PUSH_SEND_FAILED: {
    code: 'notification.push_send_failed',
    status: HttpStatus.BAD_GATEWAY,
    message: 'Failed to send push notification'
  },
  AUDIT_LOG_FAILED: {
    code: 'notification.audit_log_failed',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Audit log write failed'
  },
  CHANNEL_DISABLED: {
    code: 'notification.channel_disabled',
    status: HttpStatus.NOT_IMPLEMENTED,
    message: 'Channel not enabled in module config'
  },
  INVALID_SCOPE_IDENTIFIER: {
    code: 'notification.invalid_scope_identifier',
    status: HttpStatus.BAD_REQUEST,
    message: 'Tenant or recipient identifier does not identify anybody'
  }
}

describe('NOTIFICATION_ERROR_DEFINITIONS', () => {
  // The whole catalog, entry by entry and with no extra key: a removed property, a changed
  // status or message, a renamed code and an added entry each fail it.
  it('should be exactly the published catalog', () => {
    expect(NOTIFICATION_ERROR_DEFINITIONS).toStrictEqual(EXPECTED_CATALOG)
  })
})
