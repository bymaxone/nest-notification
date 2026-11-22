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

/** What stands for a token whose mask answered with the address again, as the default mask does. */
const ADDRESS_MASK = '[address]'

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
const TOKEN = /(?:"(?:[^"\\]|\\.){0,300}"|[^\t-\r ()<>[\],])+/gu

/** The at-sign itself: `@`, fullwidth `\uff20` or small `\ufe6b`. */
const AT_SIGN = /[@\uff20\ufe6b]/u

/**
 * One spelling of a character that stands for another: a run of `%xx` bytes, `%u0040`, a numeric
 * entity (decimal or hex, semicolon optional), `&commat;` or `&amp;`, `\x40`, `\u0040` and `\u{40}`.
 */
const ESCAPE =
  /(?:%[0-9a-f]{2})+|%u([0-9a-f]{4})|&#x([0-9a-f]+);?|&#(\d+);?|&(commat|amp);?|\\x([0-9a-f]{2})|\\u([0-9a-f]{4})|\\u\{([0-9a-f]+)\}/giu

/** The most times a token is decoded; one that still changes after that is treated as an address. */
const MAX_DECODES = 8

/** A run of `%xx` bytes as text; when it is not UTF-8, the bytes that are ASCII. */
function fromPercent(run: string): string {
  try {
    return decodeURIComponent(run)
  } catch {
    // Stryker disable next-line Regex: equivalent — a byte pair outside 0-7 left in place, or decoded to a letter, is never an at-sign, and an at-sign pair beside it is decoded on the next pass; a token that needs more passes than MAX_DECODES is masked either way.
    return run.replace(/%[0-7][0-9a-f]/giu, (pair) =>
      String.fromCharCode(parseInt(pair.slice(1), 16))
    )
  }
}

/** One spelling decoded; a code point out of range stays as it was written. */
function decodeOne(
  spelling: string,
  u4?: string,
  hex?: string,
  decimal?: string,
  named?: string,
  x2?: string,
  uEsc?: string,
  braced?: string
): string {
  if (named !== undefined) {
    // `amp` is the three-letter name, `commat` the six-letter one.
    return named.length === 3 ? '&' : '@'
  }
  const digits = u4 ?? hex ?? decimal ?? x2 ?? uEsc ?? braced
  if (digits === undefined) {
    return fromPercent(spelling)
  }
  const point = parseInt(digits, decimal === undefined ? 16 : 10)
  // Stryker disable next-line EqualityOperator: equivalent — U+10FFFF is no at-sign, so keeping its spelling or decoding it leaves the answer of holdsAtSign the same.
  return point <= 0x10ffff ? String.fromCodePoint(point) : spelling
}

/**
 * Whether a token holds an at-sign once every layer of escaping is taken off: it is decoded again
 * until it stops changing, so `%2540`, `&amp;#64;`, `%25%34%30` and `%EF%BC%A0` are all found by
 * the same rule, with no pattern to add for the next spelling.
 */
function holdsAtSign(token: string): boolean {
  let text = token
  for (let pass = 0; pass < MAX_DECODES; pass += 1) {
    if (AT_SIGN.test(text)) {
      return true
    }
    const next = text.replace(ESCAPE, decodeOne)
    if (next === text) {
      return false
    }
    text = next
  }
  return true
}

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
    if (!holdsAtSign(token)) {
      return token
    }
    const head = token.slice(0, MAX_TOKEN)
    const answer = answers.get(head) ?? askMask(mask, head)
    answers.set(head, answer)
    return answer
  })
}

/** Masks every address-shaped token of `text` with the fixed `[address]`, for text no host mask is asked about. */
export function maskAddresses(text: string): string {
  return maskAddressTokens(text, () => ADDRESS_MASK)
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
    // A mask that hands the address back (the default one) hides nothing, so its answer is
    // replaced; a host's own form is kept whenever it holds no at-sign.
    const answer = mask(token)
    return holdsAtSign(answer) ? ADDRESS_MASK : answer
  } catch {
    return MASK_FAILED
  }
}
