/**
 * @fileoverview Canonical OTP purpose constants.
 * @layer domain
 *
 * The five built-in purposes, exposed as constants so consumers get type-safe
 * references. Callers may still pass arbitrary purpose strings — these are the
 * well-known ones the library documents.
 */

/** The canonical OTP purposes the library ships with. */
export const NOTIFICATION_PURPOSES = {
  EMAIL_VERIFICATION: 'email_verification',
  PASSWORD_RESET: 'password_reset',
  MFA_OOB: 'mfa_oob',
  PHONE_VERIFICATION: 'phone_verification',
  MAGIC_LINK: 'magic_link'
} as const

/** Literal-union type of the canonical purpose values. */
export type CanonicalNotificationPurpose =
  (typeof NOTIFICATION_PURPOSES)[keyof typeof NOTIFICATION_PURPOSES]
