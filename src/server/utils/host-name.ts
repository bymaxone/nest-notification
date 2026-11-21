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

/** The visible sequence for one invisible character: `\uXXXX`, or `\u{X…}` for a surrogate pair. */
function sequenceOf(character: string): string {
  const point = character.codePointAt(0) as number
  return character.length === 1
    ? `\\u${point.toString(16).padStart(4, '0')}`
    : `\\u{${point.toString(16)}}`
}

/**
 * The text a name from the host may take in a log or error line: cut at 200 characters (a cut is
 * marked with `…`) and with each control, format and separator character written as a visible
 * sequence. The 200 counts characters of the name, so an escaped character counts once and the
 * written text is at most 2000 characters plus the mark of a cut. The cut never splits a surrogate
 * pair, and a name is read only as far as the 201st character. A value that is not a string is
 * written as `[unreadable]`, because a host can hand over anything where the interface says
 * `string`.
 *
 * @param value - The name, as the host supplied it.
 * @returns The bounded, escaped text.
 */
export function textOfHostName(value: unknown): string {
  if (typeof value !== 'string') {
    return UNREADABLE
  }
  const characters: string[] = []
  for (const character of value) {
    if (characters.length >= MAX_HOST_NAME) {
      return `${characters.join('')}…`
    }
    characters.push(character.replace(INVISIBLE, sequenceOf))
  }
  return characters.join('')
}
