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

/** The longest text that is kept; what follows is dropped, except the end of a token that starts inside it. */
const MAX_TEXT = 8192

/**
 * How far past {@link MAX_TEXT} a token that starts before it is followed, so a token that straddles the
 * bound is read whole and masked whole, and not published as the front half of an address.
 */
export const LOOKAHEAD = 1024

/** What stands for a token whose mask threw. */
const MASK_FAILED = '[masked]'

/** What stands for a token whose mask answered with the address again, as the default mask does. */
const ADDRESS_MASK = '[address]'

/** The longest token handed to the mask; a longer one with an at-sign is replaced from its first characters. */
const MAX_TOKEN = 512

/**
 * How many units a quoted piece may hold between its quotes: a unit is one character, or a backslash
 * and the character it escapes, so the piece spans up to this many units between its quotes. The pattern below spells the number out, and
 * a spec holds the two to each other.
 */
export const QUOTED_UNITS = 300

/**
 * A token: a run of characters that are neither ASCII white space nor one of `<>(),[]` (any other
 * space stays inside it, so it cannot cut an address in two), where a quoted string
 * (`"first last"@x.com`) is one piece. Inside the quotes a backslash escapes the next character and
 * at most {@link QUOTED_UNITS} units may stand between them, so a text of opening quotes is not read again from
 * each one to its end; a quote that opens no such piece is an ordinary character. The apostrophe
 * is no delimiter (`o'brien@x.com` is an address), nor is the semicolon, which ends `&#64;`.
 */
const TOKEN = /(?:"(?:[^"\\]|\\.){0,300}"|[^\t-\r ()<>[\],])+/gu

/**
 * The most UTF-16 code units one unit of a quoted piece can take: the pattern reads whole code points
 * (`u`), so a unit is a backslash and a code point, and an astral code point is two code units, which
 * makes three. The string the text is cut by is counted in code units.
 */
const UNIT_WIDTH = 3

/**
 * How near the end of what was read a token may end before its end is in doubt: a quoted piece is at
 * most {@link QUOTED_UNITS} units of {@link UNIT_WIDTH} code units between its quotes, and the quotes,
 * so a quote that opens this close to the end may close beyond it, and the token that precedes it
 * would be published without the at-sign that follows. It stays below {@link LOOKAHEAD}, or what is
 * read would end inside the zone it is meant to leave out.
 */
export const EDGE = UNIT_WIDTH * QUOTED_UNITS + 2

/** The at-sign itself: `@`, fullwidth `\uff20` or small `\ufe6b`. */
const AT_SIGN = /[@\uff20\ufe6b]/u

/**
 * One spelling of a character that stands for another, in the order its groups are read: `%u0040`,
 * a numeric entity (hex or decimal, semicolon optional), `&commat;` or `&amp;`, `\x{40}`, `\x40`,
 * `\u{40}`, `\u0040`, an octal escape (`\100`), an RFC 2047 encoded word (`=?utf-8?Q?..?=` or
 * `?B?`), and a run of `%xx` or quoted-printable `=xx` bytes.
 */
const ESCAPE =
  /%u([0-9a-f]{4})|&#x([0-9a-f]+);?|&#(\d+);?|&(commat|amp);?|\\x\{([0-9a-f]+)\}|\\x([0-9a-f]{2})|\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})|\\([0-7]{1,3})|=\?[^?\s]{1,40}\?([qb])\?([^?\s]{0,1000})\?=|(?:[%=][0-9a-f]{2})+/giu

/** `\U0000hhhh`, whose capital U the case-blind pattern above cannot tell from `\u`. */
const WIDE_ESCAPE = /\\U([0-9A-Fa-f]{8})/gu

/** The overlong spellings of `@` in UTF-8, which a strict decoder turns into U+FFFD. */
const OVERLONG_AT = /%c1%80|%e0%81%80|%f0%80%81%80/giu

/** The most times a token is decoded; one that still changes after that is treated as an address. */
const MAX_DECODES = 8

/** A run of `%xx` or `=xx` bytes as UTF-8 text; a byte that is not valid UTF-8 becomes U+FFFD, the ASCII around it stays. */
function fromPercent(run: string): string {
  return Buffer.from(
    run.replaceAll('=', '%').replace(OVERLONG_AT, '%40').replaceAll('%', ''),
    'hex'
  ).toString('utf8')
}

/**
 * An RFC 2047 encoded word's payload: `B` is base64, whose bytes are read as UTF-8 like any other run, and `Q` is quoted-printable, whose `=xx` bytes the next
 * pass reads as UTF-8 like any other run, so its text is returned as it is.
 */
function fromWord(type: string, payload: string): string {
  // The bytes of a `B` word go through the same decode as every other run of bytes.
  return type.toLowerCase() === 'b'
    ? fromPercent(
        Buffer.from(payload, 'base64')
          .toString('hex')
          .replace(/[0-9a-f]{2}/gu, '%$&')
      )
    : payload
}

/** One spelling decoded; a code point out of range stays as it was written. */
function decodeOne(spelling: string, ...groups: Array<string | undefined>): string {
  const [percentU, hexEntity, decimal, named, braceX, x2, braceU, u4, octal, type, word] = groups
  if (named !== undefined) {
    // `amp` is the three-letter name, `commat` the six-letter one.
    return named.length === 3 ? '&' : '@'
  }
  if (type !== undefined) {
    return fromWord(type, String(word))
  }
  const hex = percentU ?? hexEntity ?? braceX ?? x2 ?? braceU ?? u4
  const number = hex ?? decimal ?? octal
  if (number === undefined) {
    return fromPercent(spelling)
  }
  try {
    return String.fromCodePoint(
      parseInt(number, hex !== undefined ? 16 : decimal !== undefined ? 10 : 8)
    )
  } catch {
    // A number past U+10FFFF, or too long to be one, is no character: the spelling stays.
    return spelling
  }
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
    const next = text
      .replace(WIDE_ESCAPE, (spelling, hex: string) => decodeOne(spelling, hex))
      .replace(ESCAPE, decodeOne)
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
  // The text is bounded before it is read: the cost of the rule grows with its length, and the text is
  // a provider's, so its length is the provider's to choose. A token that starts inside the bound is
  // read to its end, so it is masked whole; one that starts past it is left out, and so is one that
  // ends near the end of what was read, whose end is not known.
  const clipped = text.length > MAX_TEXT
  const window = clipped ? text.slice(0, MAX_TEXT + LOOKAHEAD) : text
  const unfinished = window.length < text.length
  const masked = window.replace(TOKEN, (token, offset: number) => {
    if (
      clipped &&
      (offset >= MAX_TEXT || (unfinished && offset + token.length > window.length - EDGE))
    ) {
      return ''
    }
    if (!holdsAtSign(token)) {
      return token
    }
    const head = token.slice(0, MAX_TOKEN)
    const answer = answers.get(head) ?? askMask(mask, head)
    answers.set(head, answer)
    return answer
  })
  return clipped ? `${masked.trimEnd()}…` : masked
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
