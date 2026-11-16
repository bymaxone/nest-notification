/**
 * @fileoverview Test helper: whether a log line still carries a control character the escape
 * is meant to have written as a visible sequence.
 * @layer test
 */

/** The bidirectional override used by the log-escape specs, built from its code point. */
export const BIDI_OVERRIDE = String.fromCharCode(0x202e)

/**
 * Whether `text` holds a C0 or C1 control, a line or paragraph separator, or a bidirectional
 * control as the raw character.
 *
 * @param text - The log line to inspect.
 * @returns `true` when any such character is present.
 */
export function hasRawControl(text: string): boolean {
  return [...text].some((character) => {
    const code = character.codePointAt(0) ?? 0
    return (
      code < 0x20 ||
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    )
  })
}
