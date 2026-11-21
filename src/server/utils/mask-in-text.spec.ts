/**
 * @fileoverview Holds the masked recipient to replacing every occurrence of the raw one in a text.
 * @layer utils
 */

import { maskRecipientInText } from './mask-in-text'

describe('maskRecipientInText', () => {
  it('should replace every occurrence of the recipient with its masked form', () => {
    expect(maskRecipientInText('a@b.c failed, a@b.c again', 'a@b.c', '***')).toBe(
      '*** failed, *** again'
    )
  })

  it('should leave a text without the recipient as it is', () => {
    expect(maskRecipientInText('nothing here', 'a@b.c', '***')).toBe('nothing here')
  })

  it('should leave the text as it is for an empty recipient', () => {
    expect(maskRecipientInText('abc', '', '***')).toBe('abc')
  })
})
