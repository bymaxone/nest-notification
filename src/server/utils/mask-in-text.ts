/**
 * @fileoverview Puts the masked recipient where an error's text carries an address.
 * @layer utils
 *
 * A provider's or a store's error can quote the address it refused, in any spelling its code chose,
 * and the audit row that carries the text is where `audit.maskRecipient` is promised. Matching our
 * own recipients against the text means deciding when two spellings are one address, which is a
 * question of case, normalization and every script's rules, and a miss leaves an address readable.
 * The rule here asks nothing of the spelling: a token that holds an at-sign is masked, whoever it
 * belongs to. Over-masking a word of error text is the accepted price; a missed address is not.
 */

/** The longest token handed to the mask whole; a longer one that holds an at-sign is still replaced, from its first characters. */
const MAX_TOKEN = 512

/**
 * A token: a run of characters that are neither white space nor one of `<>(),[]`, in which a quoted
 * string (a quoted local part such as `"first last"@x.com`) counts as one piece whatever it holds.
 * Inside the quotes a backslash escapes the character after it, and at most 300 characters may
 * stand between them, so that a text of opening quotes is not read again from each one to its end.
 * A quote that opens no such piece is an ordinary character of the token, so a quoted string too
 * long to be one piece is still part of its token. The apostrophe is not a delimiter, since
 * `o'brien@x.com` is an address, and neither is the semicolon, which ends the escape `&#64;` and so
 * cannot end a token (a list of addresses separated by semicolons is one token, masked whole).
 */
const TOKEN = /(?:"(?:[^"\\]|\\.){0,300}"|[^\s<>(),[\]])+/gu

/**
 * The at-sign, in the forms an address is written with: `@`, fullwidth `\uff20`, small `\ufe6b`, and
 * the escapes a provider's text may carry for it (`%40`, `&#64;`, `&#x40;`, `\u0040`).
 */
const AT_SIGN = /[@\uff20\ufe6b]|%40|&#0*64;|&#x0*40;|\\u0*40/iu

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
    const answer = answers.get(head) ?? mask(head)
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
