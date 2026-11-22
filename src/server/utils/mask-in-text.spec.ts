/**
 * @fileoverview Holds the masking of an error's text to hiding every token that holds an at-sign,
 * whoever it belongs to and however it is spelled, and to doing it in one linear pass.
 * @layer utils
 */

import { EDGE, LOOKAHEAD, maskAddressTokens, QUOTED_UNITS, maskExact } from './mask-in-text'

const mask = (recipient: string): string => `<${String(recipient.length)}>`

describe('maskAddressTokens', () => {
  it('should mask the address inside the brackets of an SMTP reply and keep the brackets', () => {
    expect(maskAddressTokens('550 5.1.1 <bob@x.com> unknown user', () => '#')).toBe(
      '550 5.1.1 <#> unknown user'
    )
  })

  it('should mask an address that is not the recipient of the message', () => {
    expect(maskAddressTokens('forwarded to carol@y.org failed', () => '#')).toBe(
      'forwarded to # failed'
    )
  })

  it.each([
    ['fullwidth', 'bob＠x.com'],
    ['small', 'bob﹫x.com']
  ])('should mask an address written with the %s at-sign', (_label, address) => {
    expect(maskAddressTokens(`rejected ${address} now`, () => '#')).toBe('rejected # now')
  })

  it.each([
    ['a final sigma', 'ος@example.com'],
    ['marks in another order', 'à̕@x.com'],
    ['marks across thirty', `a${'̕'.repeat(30)}̀@x.com`],
    ['a trailing mark', 'bob@x.coḿ'],
    ['a sharp s', 'STRAẞE@X.COM'],
    ['astral letters', '\u{10400}@x.com'],
    ['a dotted capital i', 'İ@example.com']
  ])('should mask an address with %s, with no matching of spellings', (_label, address) => {
    expect(maskAddressTokens(`quoted ${address} here`, () => '#')).toBe('quoted # here')
  })

  it.each([
    ['percent-encoded fullwidth', 'bob%EF%BC%A0x.com'],
    ['hex entity of fullwidth', 'bob&#xff20;x.com'],
    ['decimal entity of fullwidth', 'bob&#65312;x.com'],
    ['hex entity of small', 'bob&#xFE6B;x.com'],
    ['entity inside an entity', 'bob&amp;#64;x.com'],
    ['percent-encoded percent signs', 'bob%25%34%30x.com'],
    ['three layers of percent', 'bob%252540x.com'],
    ['percent over a hex entity', 'bob%26%23x40%3Bx.com'],
    ['a percent run that is not UTF-8', 'bob%FF%40x.com']
  ])(
    'should mask an address written as %s, by decoding until the token stops changing',
    (_l, a) => {
      expect(maskAddressTokens(`rejected ${a} now`, () => '#')).toBe('rejected # now')
    }
  )

  it.each([
    ['a quoted-printable byte', 'bob=40x.com'],
    ['an RFC 2047 Q word', '=?utf-8?Q?bob=40x.com?='],
    ['an RFC 2047 Q word with a lowercase type', '=?UTF-8?q?bob=40x.com?='],
    ['an RFC 2047 B word', '=?utf-8?B?Ym9iQHguY29t?='],
    ['a quoted-printable fullwidth at-sign', 'bob=EF=BC=A0x.com'],
    ['a quoted-printable overlong at-sign', 'bob=C1=80x.com'],
    ['a quoted-printable three-byte overlong at-sign', 'bob=E0=81=80x.com'],
    ['an RFC 2047 Q word with a fullwidth at-sign', '=?utf-8?Q?bob=EF=BC=A0x.com?='],
    ['an RFC 2047 Q word with an overlong at-sign', '=?utf-8?Q?bob=C1=80x.com?='],
    ['bytes of both spellings in one run', 'bob%EF=BC%A0x.com'],
    ['an RFC 2047 B word with a fullwidth at-sign', '=?utf-8?B?Ym9i77ygeC5jb20=?='],
    ['an RFC 2047 B word with a two-byte overlong at-sign', '=?utf-8?B?Ym9iwYB4LmNvbQ==?='],
    ['an RFC 2047 B word with a three-byte overlong at-sign', '=?utf-8?B?Ym9i4IGAeC5jb20=?='],
    ['an RFC 2047 B word with a four-byte overlong at-sign', '=?utf-8?B?Ym9i8ICBgHguY29t?='],
    [
      'an RFC 2047 B word with bytes that are not UTF-8 before an at-sign',
      '=?utf-8?B?Ym9i/0B4LmNvbQ==?='
    ],
    ['an octal escape', 'bob\\100x.com'],
    ['a wide unicode escape', 'bob\\U00000040x.com'],
    ['a braced hex escape', 'bob\\x{40}x.com'],
    ['an escape followed by hex letters', 'bob\\u0040abcd.com'],
    ['an overlong two-byte UTF-8 at-sign', 'bob%C1%80x.com'],
    ['an overlong three-byte UTF-8 at-sign', 'bob%E0%81%80x.com'],
    ['an overlong four-byte UTF-8 at-sign', 'bob%F0%80%81%80x.com'],
    ['an overlong at-sign among other bytes', 'bob%41%C1%80%42x.com']
  ])('should mask an address written as %s', (_label, address) => {
    expect(maskAddressTokens(`rejected ${address} now`, () => '#')).toBe('rejected # now')
  })

  it('should read only the first part of a text that is longer than the bound', () => {
    const asked: string[] = []
    const text = `${'x'.repeat(8192)} tail@x.com`

    const out = maskAddressTokens(text, (token) => {
      asked.push(token)
      return '#'
    })

    expect(out).toBe(`${'x'.repeat(8192)}…`)
    expect(asked).toStrictEqual([])
  })

  it.each([
    ['a quoted local part that ends at the bound', ' '.repeat(8179) + '"Alice Smith"@example.com'],
    [
      'a plain address that starts a few characters before the bound',
      ' '.repeat(8190) + 'alice@example.com'
    ],
    [
      'a quoted local part that the bound cuts in two',
      ' '.repeat(8170) + '"Alice Smith"@example.com'
    ]
  ])('should publish no front half of an address that %s', (_name, text) => {
    const out = maskAddressTokens(text, () => '#')

    expect(out).not.toMatch(/Alice|alice|al\b/u)
    expect(out.endsWith('…')).toBe(true)
  })

  it('should mask whole an address that starts inside the bound and ends past it', () => {
    const text = `${' '.repeat(8185)}bob@example.com and more`

    const out = maskAddressTokens(text, () => '#')

    expect(out).toBe(`${' '.repeat(8185)}#…`)
  })

  it('should leave out the front of an address whose quote opens just before the end of what was read', () => {
    // A run of 1,100 characters that starts at 8,105, inside the bound, and a quoted local part whose
    // quote opens at 9,205 and closes at 9,217, past the end of what was read (9,216): the quoted
    // piece does not close in what is read, so the token is cut at its space, short of the at-sign.
    const text = `${' '.repeat(8105)}${'z'.repeat(1100)}"alice smith"@example.com`

    const out = maskAddressTokens(text, () => '#')

    expect(out).not.toMatch(/alice|zzz{10}"/u)
  })

  it('should read a quoted piece of as many escaped pairs as the constant allows as one token, and no more', () => {
    const piece = (units: number): string => `"${'\\ '.repeat(units)}"@example.com`

    expect(maskAddressTokens(piece(QUOTED_UNITS), () => '#')).toBe('#')
    expect(maskAddressTokens(piece(QUOTED_UNITS + 1), () => '#')).not.toBe('#')
  })

  it('should leave out the front of an address whose quoted piece is made of escaped pairs and closes beyond what was read', () => {
    // The quote opens 501 characters before the end of what was read (9,216) and its body, 300 escaped
    // spaces, closes past it: the token is cut at the first space, far from the end by a count of one
    // character per unit, and near it by a count of two.
    const text = `${' '.repeat(8100)}${'z'.repeat(615)}"alice ${'\\ '.repeat(300)}"@example.com`

    const out = maskAddressTokens(text, () => '#')

    expect(out).not.toMatch(/alice/u)
  })

  it.each([
    ['ends one past the edge', 1, false],
    ['ends exactly at the edge', 0, true]
  ])('should %s of what was read: kept is %s', (_name, past, kept) => {
    // What is read is 9,216 characters and the edge is EDGE before its end. The run starts at 8,100.
    const length = 9216 - EDGE - 8100 + past
    const text = `${' '.repeat(8100)}${'z'.repeat(length)} ${'y'.repeat(1200)}`

    const out = maskAddressTokens(text, () => '#')

    expect(out.includes('z'.repeat(length))).toBe(kept)
  })

  it('should leave out a token that starts exactly at the bound', () => {
    const text = `${' '.repeat(8192)}qqqqq ${'y'.repeat(1200)}`

    expect(maskAddressTokens(text, () => '#')).not.toContain('q')
  })

  it('should keep a token that runs to the end of a text that fits in what is read', () => {
    const text = 'z'.repeat(8500)

    expect(maskAddressTokens(text, () => '#')).toBe(`${text}…`)
  })

  it('should leave out the front of an address whose quoted piece holds escaped astral characters', () => {
    // An escaped astral character is a backslash and two UTF-16 code units, three in all, so the
    // piece is longer in what the text is cut by than twice its units.
    const text = `${' '.repeat(8100)}${'x'.repeat(250)}"Alice ${'\\😀'.repeat(294)}"@example.com`

    const out = maskAddressTokens(text, () => '#')

    expect(out).not.toMatch(/Alice/u)
  })

  it('should read a quoted piece of the most units, each an escaped astral character, as one token', () => {
    const piece = `"${'\\😀'.repeat(QUOTED_UNITS)}"@example.com`

    expect(maskAddressTokens(piece, () => '#')).toBe('#')
  })

  it('should keep the zone it leaves out inside what is read past the bound', () => {
    expect(EDGE).toBeLessThan(LOOKAHEAD)
  })

  it('should leave out a token that runs to the end of what was read', () => {
    const out = maskAddressTokens('x'.repeat(20_000), () => '#')

    expect(out).toBe('…')
  })

  it('should return a text of exactly the bound as it is, with nothing added', () => {
    const text = 'x'.repeat(8192)

    expect(maskAddressTokens(text, () => '#')).toBe(text)
  })

  it('should keep a wide escape that is not a code point in place, so it cannot join its neighbours', () => {
    expect(maskAddressTokens('%4\\U001100000', () => '#')).toBe('%4\\U001100000')
  })

  it('should leave a wide escape that is not a code point as it was written', () => {
    expect(maskAddressTokens('bob\\U00110000x.com', () => '#')).toBe('bob\\U00110000x.com')
  })

  it('should keep the whole of a text that is exactly at the bound', () => {
    const text = 'x'.repeat(8191) + '@'

    expect(maskAddressTokens(text, () => '#')).toBe('#')
  })

  it('should mask a token that is still changing after the decoding limit', () => {
    const layered = `x%${'25'.repeat(9)}41`

    expect(maskAddressTokens(`a ${layered} b`, () => '#')).toBe('a # b')
  })

  it('should mask a token that needs exactly as many passes as the limit allows', () => {
    const atTheLimit = `x%${'25'.repeat(7)}41`

    expect(maskAddressTokens(`a ${atTheLimit} b`, () => '#')).toBe('a # b')
  })

  it('should leave an ampersand entity that is not an at-sign alone', () => {
    expect(maskAddressTokens('AT&amp;T said &AMP; no', () => '#')).toBe('AT&amp;T said &AMP; no')
  })

  it.each([
    ['a code point past the last one', 'a &#x110000; b'],
    ['a number too long to be a code point', `a &#x${'f'.repeat(400)}; b`],
    ['bytes of a code point past the last one', 'a %F4%90%80%80 b'],
    ['bytes that are not UTF-8', 'a %FF%FE%80 b']
  ])('should leave %s as it was written, without throwing', (_label, text) => {
    expect(maskAddressTokens(text, () => '#')).toBe(text)
  })

  it('should find an at-sign beside bytes that are not UTF-8, in any position', () => {
    expect(maskAddressTokens('a %80%40x.com b %40%FF c', () => '#')).toBe('a # b # c')
  })

  it('should not read a code point past the BMP as the character its low sixteen bits spell', () => {
    expect(maskAddressTokens('AT&#x10040;T', () => '#')).toBe('AT&#x10040;T')
  })

  it('should keep an out-of-range number as written, so what is around it cannot join into an at-sign', () => {
    expect(maskAddressTokens('a&#x&#x110000;40;b', () => '#')).toBe('a&#x&#x110000;40;b')
  })

  it('should decode the largest code point without treating it as out of range', () => {
    expect(maskAddressTokens('a &#x10ffff;&#64; b', () => '#')).toBe('a # b')
  })

  it('should leave an escape that is not an at-sign and a code point out of range alone', () => {
    expect(maskAddressTokens('a %41 &#x110000; &#65; b', () => '#')).toBe(
      'a %41 &#x110000; &#65; b'
    )
  })

  it('should split tokens at white space, brackets, commas and parentheses', () => {
    expect(maskAddressTokens('a@b.c,d@e.f(j@k.l)[m@n.o] s@t.u\tv@w.x', () => '#')).toBe(
      '#,#(#)[#] #\t#'
    )
  })

  it('should mask a list of addresses separated by semicolons as one token', () => {
    expect(maskAddressTokens('to a@b.c;d@e.f done', () => '#')).toBe('to # done')
  })

  it('should leave a text without an at-sign as it is', () => {
    expect(maskAddressTokens('connection refused by relay.example.com:25', mask)).toBe(
      'connection refused by relay.example.com:25'
    )
  })

  it('should ask the mask once for each distinct token', () => {
    const asked: string[] = []

    maskAddressTokens('a@b.c and a@b.c and d@e.f', (address) => {
      asked.push(address)
      return '#'
    })

    expect(asked).toEqual(['a@b.c', 'd@e.f'])
  })

  it('should replace a token over the cap, asking the mask for its first characters', () => {
    const long = `${'x'.repeat(600)}@y.com`
    let answered = ''

    const out = maskAddressTokens(`before ${long} after`, (address) => {
      answered = address
      return '#'
    })

    expect(out).toBe('before # after')
    expect(answered).toBe(long.slice(0, 512))
  })

  it('should read a long text, and a long run without a break, in time that follows its length', () => {
    const started = Date.now()

    maskAddressTokens(`${'word '.repeat(200_000)}${'a'.repeat(500_000)}@x.com`, mask)
    maskAddressTokens('́'.repeat(500_000), mask)

    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('should answer an empty text with the empty text', () => {
    expect(maskAddressTokens('', mask)).toBe('')
  })
})

describe('an address whose spelling holds a delimiter', () => {
  it('should mask an address with an apostrophe in its local part whole', () => {
    const asked: string[] = []

    const out = maskAddressTokens("rejected o'brien@x.com now", (address) => {
      asked.push(address)
      return '#'
    })

    expect(out).toBe('rejected # now')
    expect(asked).toEqual(["o'brien@x.com"])
  })

  it('should mask a quoted local part with white space in it, brackets kept', () => {
    expect(maskAddressTokens('550 <"first last"@x.com> unknown', () => '#')).toBe('550 <#> unknown')
  })

  it('should mask a quoted string that holds the at-sign itself', () => {
    expect(maskAddressTokens('bad "a@b c" here', () => '#')).toBe('bad # here')
  })

  it('should keep a quote that never closes in its token, and mask the token', () => {
    expect(maskAddressTokens('a@b.c"unclosed text', () => '#')).toBe('# text')
  })

  it('should mask a quoted local part too long to be one piece, whole', () => {
    expect(maskAddressTokens(`got "${'a'.repeat(301)}"@example.com now`, () => '#')).toBe(
      'got # now'
    )
  })

  it.each(['bob%40x.com', 'bob&#64;x.com', 'bob&#x40;x.com', 'bob&#X040;x.com', 'bob\\u0040x.com'])(
    'should mask an address whose at-sign is written as the escape in %s',
    (address) => {
      expect(maskAddressTokens(`got ${address} here`, () => '#')).toBe('got # here')
    }
  )

  it('should mask a quoted local part that holds an escaped quote, whole', () => {
    expect(maskAddressTokens('relay rejected "first\\"last"@example.com now', () => '#')).toBe(
      'relay rejected # now'
    )
  })

  it('should read a text of quotes that never close in time that follows its length', () => {
    const started = Date.now()

    maskAddressTokens('"\\"'.repeat(150_000), mask)

    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('should read many quotes in one pass', () => {
    const started = Date.now()

    maskAddressTokens('"x '.repeat(200_000), mask)

    expect(Date.now() - started).toBeLessThan(2_000)
  })
})

describe('the at-sign and the delimiters', () => {
  it.each([
    'bob&commat;x.com',
    'bob&COMMAT;x.com',
    'bob&commatx.com',
    'bob&#64x.com',
    'bob&#x40x.com',
    'bob&#X40;x.com',
    'bob%2540x.com',
    'bob%u0040x.com',
    'bob\\x40x.com',
    'bob\\u{40}x.com',
    'bob\\u0040x.com'
  ])('should mask an address whose at-sign is written %p', (address) => {
    expect(maskAddressTokens(`got ${address} here`, () => '#')).toBe('got # here')
  })

  it.each(['\u00a0', '\u2028', '\ufeff', '\u200b', '\u3000'])(
    'should keep an address whole when the text puts the space %p inside it',
    (space) => {
      expect(maskAddressTokens(`rejected bob${space}@x.com now`, () => '#')).toBe('rejected # now')
    }
  )

  it('should still split tokens at ASCII white space', () => {
    expect(maskAddressTokens('a@b.c\td@e.f\r\ng@h.i\fj@k.l\vm@n.o p@q.r', () => '#')).toBe(
      '#\t#\r\n#\f#\v# #'
    )
  })

  it('should hide a token whose mask throws, and answer the marker', () => {
    expect(
      maskAddressTokens('refused bob@x.com', () => {
        throw new Error('mask of the host')
      })
    ).toBe('refused [masked]')
  })
})

describe('maskExact', () => {
  it('should replace every occurrence of a value that is not an address', () => {
    expect(maskExact('failed for +5511999 and +5511999', '+5511999', () => '#')).toBe(
      'failed for # and #'
    )
  })

  it('should leave the text as it is for an empty value', () => {
    expect(maskExact('abc', '', mask)).toBe('abc')
  })
})
