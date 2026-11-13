/**
 * @fileoverview Holds the two recipient rules to the forms an attacker would try: an OTP
 * recipient is exactly one mailbox, and a message addresses a bounded number of them,
 * counted the way the transport splits them.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'

import { assertSingleMailbox, countRecipients } from './recipient-list'

/** Every form that would hand the code to a second address, or to none a person can read. */
const REFUSED: ReadonlyArray<readonly [string, string]> = [
  ['a list', 'victim@x.com, attacker@evil.example'],
  ['a list without a space', 'victim@x.com,attacker@evil.example'],
  ['a semicolon list', 'victim@x.com;attacker@evil.example'],
  ['a trailing comma', 'a@x.com,'],
  ['a display form', '"x" <a@x.com>'],
  ['an angle address', '<a@x.com>'],
  ['a display name', 'Jane Doe <jane@x.com>'],
  ['a comment', 'jane@x.com (Jane)'],
  ['a tab inside', 'a@x.com\tb@y.com'],
  ['a space inside', 'a@x.com b@y.com'],
  ['a line feed inside', 'a@x.com\nb@y.com'],
  ['a CRLF inside', 'a@x.com\r\nBcc: b@y.com'],
  ['two at signs', 'a@b@x.com'],
  ['no at sign', 'jane.x.com'],
  ['no local part', '@x.com'],
  ['no domain', 'jane@'],
  ['a quoted local part', '"a b"@x.com'],
  ['an IP literal', 'a@[10.0.0.1]'],
  ['an empty string', ''],
  ['a blank string', '   ']
]

describe('assertSingleMailbox', () => {
  it.each(REFUSED)('should refuse %s', (_name, recipient) => {
    expect(() => assertSingleMailbox(recipient)).toThrow(NotificationException)
    expect(() => assertSingleMailbox(recipient)).toThrow(
      expect.objectContaining({ code: 'notification.email_invalid_recipient' })
    )
  })

  // The reason is what a consumer branches on, and it is the only context the refusal carries.
  it('should name a fixed reason in the response details', () => {
    let caught: unknown
    try {
      assertSingleMailbox('a@x.com,b@y.com')
    } catch (error) {
      caught = error
    }

    expect((caught as NotificationException).getResponse()).toMatchObject({
      error: { details: { reason: 'not_a_single_mailbox' } }
    })
  })

  // The refusal is serialized into the HTTP response, and the recipient is what must not be in it.
  it('should never echo the value it refused', () => {
    const secret = 'victim-9f3a@x.com,attacker@evil.example'
    let caught: unknown
    try {
      assertSingleMailbox(secret)
    } catch (error) {
      caught = error
    }

    expect(JSON.stringify(caught)).not.toContain('victim-9f3a')
    expect(String((caught as Error).message)).not.toContain('evil.example')
    expect(JSON.stringify((caught as NotificationException).getResponse())).not.toContain(
      'evil.example'
    )
  })

  it('should refuse an address of 255 characters and accept 254', () => {
    const domain = '@x.com'
    const longest = `${'a'.repeat(254 - domain.length)}${domain}`

    expect(() => assertSingleMailbox(longest)).not.toThrow()
    expect(() => assertSingleMailbox(`a${longest}`)).toThrow(NotificationException)
  })

  // The rule must not lock out a real user.
  it.each([
    ['a plain address', 'jane@acme.com'],
    ['a one-character local part', 'a@x.com'],
    ['surrounding whitespace', '  jane@acme.com  '],
    ['a plus tag', 'jane+otp@acme.com'],
    ['special atext characters', "o'brien_{x}!#$%&*/=?^`|~-@acme.co.uk"],
    ['a non-ASCII local part', 'jürgen@acme.de'],
    ['an internationalized domain', 'jane@bücher.example'],
    ['a non-Latin local part and domain', '用户@例子.广告']
  ])('should accept %s', (_name, recipient) => {
    expect(() => assertSingleMailbox(recipient)).not.toThrow()
  })
})

describe('countRecipients', () => {
  it('should count an address, a list and every segment of a delimited string', () => {
    expect(countRecipients('a@x.com')).toBe(1)
    expect(countRecipients(['a@x.com', 'b@x.com'])).toBe(2)
    expect(countRecipients('a@x.com, b@x.com;c@x.com')).toBe(3)
    expect(countRecipients(['a@x.com,b@x.com', 'c@x.com'])).toBe(3)
  })

  it('should ignore empty segments and an absent field', () => {
    expect(countRecipients(undefined)).toBe(0)
    expect(countRecipients('a@x.com,')).toBe(1)
    expect(countRecipients(['', ' ', ';'])).toBe(0)
  })
})
