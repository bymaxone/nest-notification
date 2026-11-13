/**
 * @fileoverview The two rules that keep a message addressed to the people the caller meant:
 * an OTP recipient is exactly one mailbox, and a message addresses a bounded number of them.
 * @layer domain
 *
 * An email transport does not take an address, it takes an address LIST: a string such as
 * `victim@x.com, attacker@evil.example` is parsed into two recipients, and a display form
 * such as `"x" <a@x.com>` into a third spelling of one. An OTP code is delivered to every
 * address the recipient string names, so a recipient the caller can shape is a second
 * mailbox the caller chose; and an unbounded list turns the endpoint into a mail cannon
 * sending from the host's own domain. Both are refused here, before any state or send exists.
 */

import { NotificationException } from '../errors/notification-exception'

/** The longest address RFC 5321 §4.5.3.1 allows in a path (254 characters). */
const MAX_ADDRESS_LENGTH = 254

/**
 * Characters that make a string something other than one plain mailbox: whitespace and control
 * characters (a CRLF forges a header, a space separates two addresses), the list delimiters,
 * and the syntax of a display name, a comment, a quoted local part or an IP literal.
 */
const NOT_A_PLAIN_MAILBOX = /[\s\p{Cc},;<>()[\]"\\:]/u

/** Delimiters the transport splits an address string on. */
const RECIPIENT_DELIMITERS = /[,;]/

/**
 * Refuses a recipient that is not exactly one mailbox.
 *
 * The refusal names the reason from a fixed vocabulary and never the value: it is serialized
 * into the HTTP response, and the recipient is what must not be echoed.
 *
 * @param recipient - The recipient as supplied by the caller.
 * @throws NotificationException `EMAIL_INVALID_RECIPIENT` when the value is not one address.
 */
export function assertSingleMailbox(recipient: string): void {
  const address = recipient.trim()
  const at = address.indexOf('@')
  const refused =
    address.length === 0 ||
    address.length > MAX_ADDRESS_LENGTH ||
    NOT_A_PLAIN_MAILBOX.test(address) ||
    at < 1 ||
    at !== address.lastIndexOf('@') ||
    at === address.length - 1
  if (refused) {
    throw new NotificationException('EMAIL_INVALID_RECIPIENT', { reason: 'not_a_single_mailbox' })
  }
}

/**
 * Counts the recipients a field addresses, after splitting each string the way the transport
 * does, so a list packed into one string counts as many as the same list in an array.
 *
 * @param field - A `to`, `cc` or `bcc` value.
 * @returns The number of non-empty address segments.
 */
export function countRecipients(field: string | readonly string[] | undefined): number {
  if (field === undefined) {
    return 0
  }
  const entries = typeof field === 'string' ? [field] : field
  return entries
    .flatMap((entry) => entry.split(RECIPIENT_DELIMITERS))
    .filter((segment) => segment.trim() !== '').length
}
