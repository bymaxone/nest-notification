/**
 * @fileoverview Puts the masked recipient where an error's text carries an address.
 * @layer utils
 *
 * An error can quote the address it refused, in any spelling, and the audit row that carries the
 * text is where `audit.maskRecipient` is promised. Matching our own recipients means deciding when
 * two spellings are one address (case, normalization, every script), and a miss leaves one readable.
 * The rule here asks nothing of the spelling: a token that holds an at-sign is masked, whoever it
 * belongs to. Over-masking a word is the accepted price; a missed address is not.
 */

/** What stands for a token whose mask threw. */
const MASK_FAILED = '[masked]'

/** The longest token handed to the mask; a longer one with an at-sign is replaced from its first characters. */
const MAX_TOKEN = 512

/**
 * A token: a run of characters that are neither ASCII white space nor one of `<>(),[]` (any other
 * space stays inside it, so it cannot cut an address in two), where a quoted string
 * (`"first last"@x.com`) is one piece. Inside the quotes a backslash escapes the next character and
 * at most 300 characters may stand between them, so a text of opening quotes is not read again from
 * each one to its end; a quote that opens no such piece is an ordinary character. The apostrophe
 * is no delimiter (`o'brien@x.com` is an address), nor is the semicolon, which ends `&#64;`.
 */
const TOKEN = /(?:"(?:[^"\\]|\\.){0,300}"|[^ \t\n\r\f\v<>(),[\]])+/gu

/**
 * The at-sign: `@`, fullwidth `\uff20`, small `\ufe6b`, or an escape of it (`%40`, `%2540`, `%u0040`,
 * `&commat;`, `&#64;`, `&#x40;` with or without the semicolon, `\x40`, `\u0040`, `\u{40}`), in any case.
 */
const AT_SIGN =
  /[@\uff20\ufe6b]|%(?:25)*40|%u0*40|&commat;?|&#0*64;?|&#x0*40;?|\\x0*40|\\u0*40|\\u\{0*40\}/iu

/**
 * Replaces every token of `text` that holds an at-sign with what the mask answers for it. The whole
 * token goes (`<bob@x.com>` keeps its brackets and loses the address), and a token that holds an
 * at-sign and is longer than {@link MAX_TOKEN} is replaced too, the mask being asked for its first
 * characters, so a long run cannot be a way to keep an address in the row.
 *
 * @param text - The text an audit entry would carry.
 * @param mask - `audit.maskRecipient`, asked once for each distinct token.
 * @returns The text with each such token replaced.
 */
export function maskAddressTokens(text: string, mask: (recipient: string) => string): string {
  const answers = new Map<string, string>()
  return text.replace(TOKEN, (token) => {
    if (!AT_SIGN.test(token)) {
      return token
    }
    const head = token.slice(0, MAX_TOKEN)
    const answer = answers.get(head) ?? askMask(mask, head)
    answers.set(head, answer)
    return answer
  })
}

/**
 * Replaces every occurrence of `value`, exactly as written, with what the mask answers for it. It is
 * for a recipient that is not an address (a phone number, a device id), which the token rule does not
 * see.
 *
 * @param text - The text an audit entry would carry.
 * @param value - The recipient as the caller gave it.
 * @param mask - `audit.maskRecipient`.
 * @returns The text with each occurrence replaced; `text` itself when `value` is empty.
 */
export function maskExact(
  text: string,
  value: string,
  mask: (recipient: string) => string
): string {
  return value === '' ? text : text.split(value).join(mask(value))
}

/**
 * The answer of the mask for a token. A mask is the host's function and may throw; the text is
 * being written to an audit row from inside a failure path, which a throw would replace, so a
 * mask that fails is answered with a marker and the token is still hidden.
 */
function askMask(mask: (recipient: string) => string, token: string): string {
  try {
    return mask(token)
  } catch {
    return MASK_FAILED
  }
}
