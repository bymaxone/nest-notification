/**
 * @fileoverview Canonical email-template name convention.
 * @layer domain
 *
 * The library ships NO HTML for these templates — the consumer registers each one
 * in their `IEmailTemplateRenderer`. This catalog documents the conventional names
 * plus the variables each template is expected to receive, so adopters share a
 * vocabulary and get type-safe autocompletion.
 *
 * Using these constants is OPTIONAL — `emailService.sendTemplate({ template })`
 * accepts any string; the benefit is IDE autocompletion and a single source of
 * truth for the names a `bymax-fitness`-style consumer already ships.
 */

/**
 * Canonical template names recognized by the library's conventions.
 *
 * Each entry's JSDoc lists the variables the template is expected to interpolate.
 */
export const CANONICAL_EMAIL_TEMPLATES = {
  /** OTP for email verification — variables: `code`, `expiresInMinutes`, `purpose`, `name`, `appName`. */
  OTP_CODE: 'otp_code',
  /** OTP for password reset (distinct copy; may carry a deep link) — variables: `code`, `expiresInMinutes`, `name`, `appName`, `verificationLink`. */
  OTP_PASSWORD_RESET: 'otp_password_reset',
  /** OTP resend — same variables as the originating OTP template. */
  OTP_RESENT: 'otp_resent',
  /** Welcome after email verification — variables: `name`, `appName`, `appUrl`. */
  WELCOME: 'welcome',
  /** Password reset success — variables: `name`, `appName`, `supportEmail`. */
  PASSWORD_RESET_SUCCESS: 'password_reset_success',
  /** Trial ending soon — variables: `name`, `appName`, `trialPlanName`, `daysLeft`, `appUrl`. */
  TRIAL_EXPIRING: 'trial_expiring',
  /** Trial ended — variables: `name`, `appName`, `trialPlanName`, `durationDays`, `appUrl`. */
  TRIAL_EXPIRED: 'trial_expired',
  /** New device login — variables: `device`, `ip`, `timestamp`, `name`, `appName`. */
  NEW_LOGIN_ALERT: 'new_login_alert',
  /** MFA enabled — variables: `name`, `appName`. */
  MFA_ENABLED: 'mfa_enabled',
  /** MFA disabled — variables: `name`, `appName`. */
  MFA_DISABLED: 'mfa_disabled'
} as const

/** Union of the canonical template name string literals. */
export type CanonicalEmailTemplate =
  (typeof CANONICAL_EMAIL_TEMPLATES)[keyof typeof CANONICAL_EMAIL_TEMPLATES]
