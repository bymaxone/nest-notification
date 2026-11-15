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

import { domainToASCII } from 'node:url'

/**
 * Whether the last label of a domain is a number, which the URL host parser reads as an IPv4
 * address in any base (`0x7f.1` is `127.0.0.1`). A top-level domain is never a number, so such a
 * host is not a domain name and is not folded: two spellings stay two keys.
 */
const NUMERIC_LAST_LABEL = /(?:^|\.)(?:0x[0-9a-f]*|[0-9]+)\.?$/i

/**
 * The domain of an email as the resolver sees it. IDNA mapping (UTS #46, non-transitional, so `ß`
 * stays) gives one spelling to a Unicode domain, its compatibility forms (fullwidth letters,
 * ligatures) and its punycode form. A domain the mapping rejects, or a numeric host, falls back to
 * compatibility folding and lower case, so it is never merged with a different domain.
 */
function normalizeDomain(domain: string): string {
  const folded = domain.normalize('NFKC')
  const mapped = domainToASCII(folded)
  return mapped !== '' && !NUMERIC_LAST_LABEL.test(folded) ? mapped : folded.toLowerCase()
}

/**
 * Returns the recipient as the scope key sees it.
 *
 * Surrounding whitespace is never part of an identifier. An email address is folded to
 * lower case: the domain is case-insensitive by the DNS rules, and the
 * local-part is, in practice, case-insensitive at every mail provider, which RFC 5321
 * §2.4 itself asks implementers to rely on ("exploiting the case sensitivity of mailbox
 * local-parts impedes interoperability and is discouraged"). A recipient that is not an
 * email (a phone number, a device id) is only trimmed, because its case can be
 * significant.
 *
 * Only an ASCII `@` makes an identifier an email, and what follows the last one is the domain.
 * The domain is folded the way the resolver folds it (see `normalizeDomain`). The local part gets
 * no Unicode normalization: two local parts that differ in a compatibility character, such as
 * `ﬁle` and `file`, are two mailboxes at a provider that accepts them, and one key for both would
 * let a code mailed to one verify for the other. Plus tags are kept for the same reason: `a+1@x.com`
 * and `a@x.com` are two keys.
 *
 * `toLowerCase` is locale-independent, so the result does not vary with the process
 * locale.
 *
 * @param recipient - The recipient as supplied by the caller.
 * @returns The value to key the OTP state on.
 */
export function normalizeRecipient(recipient: string): string {
  const trimmed = recipient.trim()
  const at = trimmed.lastIndexOf('@')
  if (at === -1) {
    return trimmed
  }
  return `${trimmed.slice(0, at).toLowerCase()}@${normalizeDomain(trimmed.slice(at + 1))}`
}
