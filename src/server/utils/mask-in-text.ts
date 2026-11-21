/**
 * @fileoverview Puts the masked recipient where an error's text carries the raw one.
 * @layer utils
 */

/** An address to find: its lower-cased units and what the mask answers for it. */
interface Needle {
  units: readonly string[]
  masked: string
}

/** How many leading units a needle is filed under, so a position meets only the needles that can start there. */
const PREFIX = 2

/**
 * A text in lower case, as a list of UTF-16 units, and for each unit the index in the original text
 * of the character it came from. A character whose lower case is longer than itself (`\u0130` is
 * `i` and a combining dot) gives several units that point at the one character, so a match is
 * found whatever length the lower case of an address or of the text has.
 */
function fold(text: string): { units: string[]; origin: number[] } {
  const units: string[] = []
  const origin: number[] = []
  for (let index = 0; index < text.length; index += 1) {
    for (const unit of text.charAt(index).toLowerCase().split('')) {
      units.push(unit)
      origin.push(index)
    }
  }
  origin.push(text.length)
  return { units, origin }
}

/**
 * Replaces every occurrence of each address in `text`, ignoring letter case, with what the mask
 * answers for it. A relay quotes the address it refused (`550 <bob@x.com> unknown`), often in
 * another case than the caller wrote it, and the audit row that carries the text is where the mask
 * is promised.
 *
 * The text is read once from the start. Each position is compared with the addresses filed under
 * the same leading units only, so the cost follows the length of the text and not the length of the
 * text times the number of addresses.
 *
 * @param text - The text an audit entry would carry.
 * @param addresses - The addresses of the message, from `to`, `cc` and `bcc`.
 * @param mask - `audit.maskRecipient`, asked once for each address.
 * @returns The text with every occurrence of every address replaced.
 */
export function maskRecipientsInText(
  text: string,
  addresses: readonly string[],
  mask: (recipient: string) => string
): string {
  const filed = new Map<string, Needle[]>()
  for (const address of addresses.filter((entry) => entry !== '')) {
    const units = fold(address).units
    const key = units.slice(0, PREFIX).join('')
    filed.set(key, [...(filed.get(key) ?? []), { units, masked: mask(address) }])
  }
  const { units, origin } = fold(text)
  let out = ''
  let from = 0
  let at = 0
  while (at < units.length) {
    const candidates = [
      ...(filed.get(units.slice(at, at + PREFIX).join('')) ?? []),
      ...(filed.get(units.slice(at, at + 1).join('')) ?? [])
    ]
    const found = candidates.find(
      (needle) =>
        needle.units.every((unit, offset) => units.at(at + offset) === unit) &&
        // A match that ends inside the lower case of one character is not a match of that character.
        origin.at(at + needle.units.length) !== origin.at(at + needle.units.length - 1)
    )
    if (found === undefined) {
      at += 1
    } else {
      out += text.slice(from, origin.at(at)) + found.masked
      at += found.units.length
      from = Number(origin.at(at))
    }
  }
  return out + text.slice(from)
}
