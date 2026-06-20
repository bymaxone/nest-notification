/**
 * @fileoverview Public `OtpPurpose` string union for the shared subpath.
 * @layer shared
 *
 * Zero-dependency type importable from backend and frontend alike (e.g. to label
 * an OTP flow in the UI). No runtime code.
 */

/**
 * Purpose of an OTP flow.
 *
 * The five canonical purposes are listed as string literals so editors offer
 * autocompletion, while the `(string & {})` escape hatch keeps the union open to
 * custom purposes (e.g. `'invoice_verification'`) without losing that
 * autocompletion — a widening to a bare `string` would drop the literal hints.
 *
 * - `email_verification` — confirm ownership of an email address.
 * - `password_reset` — authorize a password change.
 * - `mfa_oob` — out-of-band multi-factor challenge.
 * - `phone_verification` — confirm a phone number; SMS-delivered (v0.2 / manual today).
 * - `magic_link` — long, single-use token delivered as a URL rather than typed.
 */
export type OtpPurpose =
  | 'email_verification'
  | 'password_reset'
  | 'mfa_oob'
  | 'phone_verification'
  | 'magic_link'
  // Intentional open-union escape hatch — keeps literal autocompletion above
  // while still accepting arbitrary custom purposes. See the JSDoc on this type.
  | (string & {})
