/**
 * @fileoverview Holds the masked recipients to replacing every occurrence of every raw address in a
 * text, in any letter case, with what the mask answers for that address.
 * @layer utils
 */

import { maskRecipientsInText } from './mask-in-text'

const mask = (recipient: string): string => `<${recipient.length}>`

describe('maskRecipientsInText', () => {
  it('should replace every occurrence of every address with its masked form', () => {
    expect(maskRecipientsInText('a@b.c failed, a@b.c and d@e.f', ['a@b.c', 'd@e.f'], mask)).toBe(
      '<5> failed, <5> and <5>'
    )
  })

  it('should find an address in another letter case', () => {
    expect(maskRecipientsInText('550 <Bob@X.com> unknown', ['bob@x.com'], mask)).toBe(
      '550 <<9>> unknown'
    )
  })

  it('should read the characters of an address as text, never as a pattern', () => {
    expect(maskRecipientsInText('a+b@x.com and aab@xcom', ['a+b@x.com'], mask)).toBe(
      '<9> and aab@xcom'
    )
  })

  it('should leave a text without the addresses as it is', () => {
    expect(maskRecipientsInText('nothing here', ['a@b.c'], mask)).toBe('nothing here')
  })

  it('should leave the text as it is when there are no addresses', () => {
    expect(maskRecipientsInText('abc', [], mask)).toBe('abc')
  })

  it('should skip an empty address, which would match everywhere', () => {
    expect(maskRecipientsInText('abc', [''], mask)).toBe('abc')
  })

  it('should still mask when a character elsewhere changes length in lower case', () => {
    expect(maskRecipientsInText('\u0130 Bob@X.com', ['bob@x.com'], mask)).toBe('\u0130 <9>')
  })

  it('should mask an address that is shorter than the leading characters it is filed under', () => {
    expect(maskRecipientsInText('code 7 and 7', ['7'], () => '#')).toBe('code # and #')
  })

  it('should keep the text around an astral character intact', () => {
    expect(maskRecipientsInText('\u{1F600} a@b.c \u{1F600}', ['A@B.C'], mask)).toBe(
      '\u{1F600} <5> \u{1F600}'
    )
  })

  it('should answer a long text with many addresses in time that follows the text', () => {
    const addresses = Array.from({ length: 3_000 }, (_, i) => `user${String(i)}@example.com`)
    const text = 'x'.repeat(100_000)
    const started = Date.now()

    const out = maskRecipientsInText(text + addresses[2999], addresses, mask)

    expect(out.endsWith('<' + String(addresses[2999]?.length) + '>')).toBe(true)
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('should mask the first of two addresses that overlap, and move past it', () => {
    expect(maskRecipientsInText('abcd', ['abc', 'bcd'], () => '#')).toBe('#d')
  })

  it.each([
    ['\u0130@example.com', 'i\u0307@example.com'],
    ['i\u0307@example.com', '\u0130@example.com']
  ])(
    'should find %p when the address is %p, whichever has the longer lower case',
    (text, address) => {
      expect(maskRecipientsInText(`550 ${text} unknown`, [address], () => '[masked]')).toBe(
        '550 [masked] unknown'
      )
    }
  )

  it('should not mask part of a character whose lower case holds the address', () => {
    expect(maskRecipientsInText('\u0130', ['i'], () => '#')).toBe('\u0130')
  })

  it('should find an address written with a final sigma, which lower-casing the whole text would give', () => {
    expect(
      maskRecipientsInText('\u03bf\u03c2@example.com', ['\u039f\u03a3@example.com'], mask)
    ).toBe('<14>')
  })

  it('should find an address of cased astral letters', () => {
    expect(maskRecipientsInText('\u{10400}@x.com', ['\u{10428}@x.com'], () => '#')).toBe('#')
  })

  it('should mask the longest address that begins at a position', () => {
    expect(maskRecipientsInText('bob@x.com.br', ['bob@x.com', 'bob@x.com.br'], () => '#')).toBe('#')
  })

  it('should begin a match only at the start of a character', () => {
    expect(maskRecipientsInText('\u0130', ['\u0307'], () => '#')).toBe('\u0130')
  })

  it('should answer a text that repeats the start of every address in time that follows the text', () => {
    const addresses = Array.from({ length: 1_000 }, (_, i) => `user${String(i)}@example.com`)
    const started = Date.now()

    maskRecipientsInText('user'.repeat(100_000), addresses, mask)

    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('should find an address written in another normalization form', () => {
    expect(maskRecipientsInText('e\u0301@x.com', ['\u00e9@x.com'], mask)).toBe('<7>')
    expect(maskRecipientsInText('\u00e9@x.com', ['e\u0301@x.com'], mask)).toBe('<8>')
  })

  it('should find an address written with a capital or a lower-case sharp s', () => {
    expect(maskRecipientsInText('STRA\u1e9eE@X.COM', ['stra\u00dfe@x.com'], () => '#')).toBe('#')
    expect(maskRecipientsInText('stra\u00dfe@x.com', ['STRASSE@x.com'], () => '#')).toBe('#')
  })

  it('should ask the mask only for the addresses the text quotes, and once for each', () => {
    const asked: string[] = []

    maskRecipientsInText('a@b.c and a@b.c', ['a@b.c', 'never@x.com'], (address) => {
      asked.push(address)
      return '#'
    })

    expect(asked).toEqual(['a@b.c'])
  })

  it.each([
    ['a\u0315\u0300@x.com', 'a\u0300\u0315@x.com'],
    ['a\u0301\u0323@x.com', '\u1ea1\u0301@x.com'],
    ['\u1ea1\u0301@x.com', 'a\u0301\u0323@x.com']
  ])('should find %p when the address is %p, the marks being in another order', (text, address) => {
    expect(maskRecipientsInText(`550 ${text} unknown`, [address], () => '#')).toBe('550 # unknown')
  })

  it('should read a run of marks with no letter before it as one character', () => {
    expect(maskRecipientsInText('\u0301\u0323 a@b.c', ['a@b.c'], () => '#')).toBe('\u0301\u0323 #')
  })

  it('should answer an empty text with the empty text', () => {
    expect(maskRecipientsInText('', ['a@b.c'], mask)).toBe('')
  })
})
