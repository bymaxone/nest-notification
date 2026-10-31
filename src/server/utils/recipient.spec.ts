import { normalizeRecipient } from './recipient'

describe('normalizeRecipient', () => {
  // The scope key must not depend on how a user typed the address: surrounding
  // whitespace and letter case describe the same mailbox for every mail provider
  // in practice, and two keys for one mailbox multiply the issue and attempt limits.
  it.each([
    ['Jane@Acme.com', 'jane@acme.com'],
    ['JANE@ACME.COM', 'jane@acme.com'],
    [' jane@acme.com', 'jane@acme.com'],
    ['jane@acme.com ', 'jane@acme.com'],
    ['\tJane@Acme.com\n', 'jane@acme.com'],
    ['jane@acme.com', 'jane@acme.com']
  ])('should fold the email %j to %j', (input, expected) => {
    expect(normalizeRecipient(input)).toBe(expected)
  })

  // A recipient that is not an email (a phone number, a device id) can be case
  // sensitive; only its surrounding whitespace is not part of the identifier.
  it.each([
    ['  +5511999990000 ', '+5511999990000'],
    ['Device-ABC', 'Device-ABC']
  ])('should only trim the non-email %j', (input, expected) => {
    expect(normalizeRecipient(input)).toBe(expected)
  })

  // Turkish dotted/dotless i must not make the fold depend on the process locale.
  it('should fold without consulting the locale', () => {
    expect(normalizeRecipient('I@Acme.com')).toBe('i@acme.com')
  })
})
