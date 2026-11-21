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
})
