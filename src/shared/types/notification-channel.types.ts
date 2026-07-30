/**
 * @fileoverview Public `NotificationChannel` union for the shared subpath.
 * @layer shared
 *
 * Zero-dependency type. `'sms'` and `'push'` are part of the union so consumers can
 * plan dispatch code paths against a stable shape, even though no service serves them.
 */

/**
 * A delivery/identity channel a notification can flow through.
 *
 * - `email` — transactional email.
 * - `otp` — one-time-passcode lifecycle (generate / verify / consume).
 * - `sms` — text message (declared; no service behind it).
 * - `push` — device push notification (declared; no service behind it).
 */
export type NotificationChannel = 'email' | 'otp' | 'sms' | 'push'
