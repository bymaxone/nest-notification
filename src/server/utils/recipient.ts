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
 * What a domain is made of before the mapping may read it: letters, numbers, marks, hyphen, dot and
 * underscore. `domainToASCII` reads its input as the host of a URL, which has syntax: `#`, `/`, `?`
 * and `\\` end the host, `%` is an escape, a tab or a newline is dropped.
 */
const PLAIN_DOMAIN = /^[\p{L}\p{N}\p{M}_.-]+$/u

/** A label made of ASCII characters only. */
const ASCII_LABEL = /^\p{ASCII}*$/u

/**
 * Whether `mapped`, what `domainToASCII` returned for `folded`, is nothing but the lower case and the
 * punycode of its labels: the same number of labels, each ASCII label the lower case of the input
 * one, each other label a punycode label. A mapping that cut the host short, decoded an escape,
 * dropped a character or read the host as an address (`0x7f.1` is `127.0.0.1`) has a label that is
 * not that, so it is not used and the domain keeps its own spelling. A domain is never given the
 * spelling of another one.
 */
function isLabelWiseMapping(folded: string, mapped: string): boolean {
  const expected = folded
    .split('.')
    .map((label) => (ASCII_LABEL.test(label) ? label.toLowerCase() : null))
  const output = mapped.split('.')
  return (
    expected.length === output.length &&
    output.every((label, index) => {
      const want = expected.at(index)
      return want === null ? label.startsWith('xn--') : label === want
    })
  )
}

/**
 * The domain of an email as the resolver sees it. The key is the mapping the resolver itself applies
 * to the domain as written, IDNA (UTS #46, non-transitional, so `ß` stays), which gives one spelling
 * to a Unicode domain, its compatibility forms (fullwidth letters, ligatures) and its punycode form.
 * Compatibility normalization is not applied to the key: it differs from that mapping for some
 * characters (the lunate sigma becomes a final sigma there and an ordinary sigma in the mapping), so
 * a key made from it could be the key of another domain. It only gives the shape the mapping must
 * have. Text that is not plain domain text, and a mapping that is not label by label the lower case
 * and the punycode of that shape, keep the domain as written, lower-cased, so a domain is never
 * merged with a different one.
 */
function normalizeDomain(domain: string): string {
  const folded = domain.normalize('NFKC')
  if (!PLAIN_DOMAIN.test(folded)) {
    return domain.toLowerCase()
  }
  const mapped = domainToASCII(domain)
  return isLabelWiseMapping(folded, mapped) ? mapped : domain.toLowerCase()
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
