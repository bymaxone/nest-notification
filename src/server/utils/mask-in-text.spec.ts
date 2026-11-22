/**
 * @fileoverview Holds the masking of an error's text to hiding every token that holds an at-sign,
 * whoever it belongs to and however it is spelled, and to doing it in one linear pass.
 * @layer utils
 */

import { maskAddressTokens, maskExact } from './mask-in-text'

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
