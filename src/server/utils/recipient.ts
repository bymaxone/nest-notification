/**
 * @fileoverview Derives the recipient value an OTP's scope is keyed on.
 * @layer domain
 *
 * Two spellings of one mailbox must reach one OTP state. Otherwise every spelling carries
 * its own resend cooldown and its own attempt counter, so a caller multiplies both
 * limits by the number of spellings it can produce, and a user who types another case
 * than the one the code was issued for is told the code does not exist.
 *
 * Only the KEY is derived here. RFC 5321 §2.4 makes the local-part case sensitive and
 * requires a sender to preserve it, so a message keeps the case the caller supplied.
 * Surrounding whitespace is no part of an address and is trimmed there as well.
 */

/**
 * Returns the recipient as the scope key sees it.
 *
 * Surrounding whitespace is never part of an identifier. An email address is folded to
 * lower case as a whole: the domain is case-insensitive by the DNS rules, and the
 * local-part is, in practice, case-insensitive at every mail provider, which RFC 5321
 * §2.4 itself asks implementers to rely on ("exploiting the case sensitivity of mailbox
 * local-parts impedes interoperability and is discouraged"). A recipient that is not an
 * email (a phone number, a device id) is only trimmed, because its case can be
 * significant.
 *
 * `toLowerCase` is locale-independent, so the result does not vary with the process
 * locale.
 *
 * @param recipient - The recipient as supplied by the caller.
 * @returns The value to key the OTP state on.
 */
export function normalizeRecipient(recipient: string): string {
  const trimmed = recipient.trim()
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed
}
