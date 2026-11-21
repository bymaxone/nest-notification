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

  it('should match exactly when lower-casing would change the length of the text', () => {
    expect(maskRecipientsInText('\u0130 a@b.c A@B.C', ['a@b.c'], mask)).toBe('\u0130 <5> A@B.C')
  })
})
