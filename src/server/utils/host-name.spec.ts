/**
 * @fileoverview Holds `textOfHostName` to its contract: a name the host supplied reaches log and
 * error text bounded to 200 characters and with every control, format and line-separator character
 * written as a visible sequence.
 * @layer utils
 */

import { textOfHostName } from './host-name'

describe('textOfHostName', () => {
  it('should return an ordinary name unchanged', () => {
    expect(textOfHostName('redis-main')).toBe('redis-main')
  })

  it.each([
    ['a line feed', 'a\nb', 'a\\u000ab'],
    ['a carriage return', 'a\rb', 'a\\u000db'],
    ['an escape', 'a\u001bb', 'a\\u001bb'],
    ['a C1 control', 'a\u0085b', 'a\\u0085b'],
    ['a zero-width space', 'a\u200bb', 'a\\u200bb'],
    ['a byte order mark', 'a\ufeffb', 'a\\ufeffb'],
    ['a bidi override', 'a\u202eb', 'a\\u202eb'],
    ['a bidi isolate', 'a\u2066b', 'a\\u2066b'],
    ['a line separator', 'a\u2028b', 'a\\u2028b'],
    ['a paragraph separator', 'a\u2029b', 'a\\u2029b']
  ])('should write %s as a visible sequence', (_label, input, expected) => {
    expect(textOfHostName(input)).toBe(expected)
  })

  it('should write a format character beyond U+FFFF in the braced form', () => {
    // U+E0041 is a tag letter; it is a format character and invisible.
    expect(textOfHostName('a\u{e0041}b')).toBe('a\\u{e0041}b')
  })

  it('should keep a printable character beyond U+FFFF', () => {
    expect(textOfHostName('a\u{1f600}b')).toBe('a\u{1f600}b')
  })

  it('should cut a long name at 200 characters and mark the cut', () => {
    const cut = textOfHostName('x'.repeat(5000))

    expect(cut).toBe(`${'x'.repeat(200)}…`)
  })

  it('should not cut a name of exactly 200 characters', () => {
    expect(textOfHostName('x'.repeat(200))).toBe('x'.repeat(200))
  })

  it('should cut by character, not through a surrogate pair', () => {
    const cut = textOfHostName('\u{1f600}'.repeat(300))

    expect(cut).toBe(`${'\u{1f600}'.repeat(200)}…`)
  })

  it('should count an escaped character once toward the 200', () => {
    const cut = textOfHostName('\n'.repeat(5000))

    expect(cut).toBe(`${'\\u000a'.repeat(200)}…`)
  })

  it.each([[undefined], [null], [42], [{}], [Symbol('s')]])(
    'should name a value that is not a string as unreadable: %p',
    (value) => {
      expect(textOfHostName(value)).toBe('[unreadable]')
    }
  )
})
