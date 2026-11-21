/**
 * @fileoverview Puts the masked recipient where an error's text carries the raw one.
 * @layer utils
 */

/**
 * Replaces every occurrence of each address in `text`, whatever its letter case, with what the mask
 * answers for it. A relay quotes the address it refused (`550 <bob@x.com> unknown`), often in
 * another case than the caller wrote it, and the audit row that carries the text is where the mask
 * is promised.
 *
 * @param text - The text an audit entry would carry.
 * @param addresses - The addresses of the message, from `to`, `cc` and `bcc`.
 * @param mask - `audit.maskRecipient`.
 * @returns The text with every occurrence of every address replaced.
 */
export function maskRecipientsInText(
  text: string,
  addresses: readonly string[],
  mask: (recipient: string) => string
): string {
  let masked = text
  for (const address of addresses.filter((entry) => entry !== '')) {
    masked = replaceAll(masked, address, mask(address))
  }
  return masked
}

/**
 * Replaces each occurrence of `needle` in `text`, ignoring letter case. Each stretch of the text is
 * compared on its own, so a character elsewhere whose lower case has another length cannot turn the
 * comparison off for the rest of the text.
 */
function replaceAll(text: string, needle: string, replacement: string): string {
  const target = needle.toLowerCase()
  let out = ''
  let from = 0
  for (let at = 0; at + needle.length <= text.length; at += 1) {
    if (text.slice(at, at + needle.length).toLowerCase() === target) {
      out += text.slice(from, at) + replacement
      from = at + needle.length
      at = from - 1
    }
  }
  return out + text.slice(from)
}
