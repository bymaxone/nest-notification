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
 * Replaces each occurrence of `needle` in `text`, ignoring letter case where lower-casing keeps the
 * text's length (so an index in the one is an index in the other), and exactly otherwise.
 */
function replaceAll(text: string, needle: string, replacement: string): string {
  const lowered = text.toLowerCase()
  const fold = lowered.length === text.length
  const hay = fold ? lowered : text
  const target = fold ? needle.toLowerCase() : needle
  let out = ''
  let from = 0
  for (let at = hay.indexOf(target); at !== -1; at = hay.indexOf(target, from)) {
    out += text.slice(from, at) + replacement
    from = at + target.length
  }
  return out + text.slice(from)
}
