/**
 * @fileoverview Writes a name the host supplied (a storage name, a locale, a class name) into log
 * and error text bounded and with every invisible character visible.
 * @layer utils
 */

/** The longest host name that reaches a line, in characters. */
const MAX_HOST_NAME = 200

/** Controls, format characters (bidi, zero-width, BOM), and the line and paragraph separators. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

/** The text written for a value that is not a string. */
const UNREADABLE = '[unreadable]'

/** The visible sequence for one invisible character: `\uXXXX`, or `\u{X…}` past U+FFFF. */
function sequenceOf(character: string): string {
  const point = character.codePointAt(0) as number
  return point > 0xffff ? `\\u{${point.toString(16)}}` : `\\u${point.toString(16).padStart(4, '0')}`
}

/**
 * The text a name from the host may take in a log or error line: cut at 200 characters (a cut is
 * marked with `…`) and with each control, format and separator character written as a visible
 * sequence. The 200 counts characters of the name, so an escaped character counts once and the
 * written text is at most 2000 characters plus the mark of a cut. The cut never splits a surrogate pair. A value that is not a string is written as `[unreadable]`,
 * because a host can hand over anything where the interface says `string`.
 *
 * @param value - The name, as the host supplied it.
 * @returns The bounded, escaped text.
 */
export function textOfHostName(value: unknown): string {
  if (typeof value !== 'string') {
    return UNREADABLE
  }
  // Twice the bound is read, so a name of surrogate pairs still yields 200 characters to keep.
  const characters = Array.from(value.slice(0, MAX_HOST_NAME * 2)).map((character) =>
    character.replace(INVISIBLE, sequenceOf)
  )
  const kept = characters.slice(0, MAX_HOST_NAME).join('')
  return characters.length > MAX_HOST_NAME || value.length > MAX_HOST_NAME * 2 ? `${kept}…` : kept
}
