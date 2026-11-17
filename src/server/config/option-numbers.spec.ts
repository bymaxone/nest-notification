/**
 * @fileoverview Holds `received`, the words a refusal uses for what the host gave, to naming every
 * kind of value and showing only those that cannot be a credential: a number, a bigint and a
 * boolean. A string, a symbol, a function (whose source would print), an object and an array are
 * named by kind and never printed.
 * @layer application
 */

import { received } from './option-numbers'

describe('received', () => {
  it.each([
    [NaN, 'NaN'],
    [Infinity, 'Infinity'],
    [-1, '-1'],
    [2.5, '2.5'],
    [451n, '451'],
    [true, 'true'],
    [false, 'false']
  ])('should show %p', (value, expected) => {
    expect(received(value)).toBe(expected)
  })

  it.each([
    ['SENTINEL_9d3a', 'a string'],
    ['', 'a string'],
    [Symbol('SENTINEL_9d3a'), 'a symbol'],
    [() => 'SENTINEL_9d3a', 'a function'],
    [function named() {}, 'a function'],
    [null, 'null'],
    [undefined, 'undefined'],
    [[], 'an array'],
    [['SENTINEL_9d3a'], 'an array'],
    [{}, 'an object'],
    [{ toString: () => 'SENTINEL_9d3a' }, 'an object'],
    [new Date(0), 'an object']
  ])('should name %p by kind', (value, expected) => {
    expect(received(value)).toBe(expected)
  })

  it('should never print a string, a symbol description or a function source', () => {
    for (const value of ['SENTINEL_9d3a', Symbol('SENTINEL_9d3a'), () => 'SENTINEL_9d3a']) {
      expect(received(value)).not.toContain('SENTINEL')
    }
  })
})
