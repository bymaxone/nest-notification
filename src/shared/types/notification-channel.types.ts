/**
 * @fileoverview Public `NotificationChannel` union for the shared subpath.
 * @layer shared
 *
 * Zero-dependency type. `'sms'` and `'push'` are declared in v0.1 so consumers
 * can plan dispatch code paths even though their services ship in v0.2.
 */

/**
 * A delivery/identity channel a notification can flow through.
 *
 * - `email` — transactional email.
 * - `otp` — one-time-passcode lifecycle (generate / verify / consume).
 * - `sms` — text message (declared now, implemented in v0.2).
 * - `push` — device push notification (declared now, implemented in v0.2).
 */
export type NotificationChannel = 'email' | 'otp' | 'sms' | 'push'
