/**
 * @fileoverview Holds the port guard to a port a socket can open: an integer from 1 to 65535. A
 * port of NaN, zero, past 65535, a fraction or a string such as '587' is a typo that would fail
 * every send, or be coerced into something nobody wrote, so it is refused when the provider is
 * built.
 * @layer utils
 */

import { MAX_PORT, assertPort } from './port-option'

describe('assertPort', () => {
  it('should hold the highest port', () => {
    expect(MAX_PORT).toBe(65_535)
  })

  it.each([1, 25, 465, 587, 2525, 65_535, undefined])('should accept %p', (value) => {
    expect(() => assertPort('Owner', value)).not.toThrow()
  })

  it.each([0, -1, 65_536, 70_000, 587.5, NaN, Infinity, '587', '', null, true, {}, []])(
    'should refuse %p',
    (value) => {
      expect(() => assertPort('Owner', value)).toThrow(
        'Owner: port must be an integer from 1 to 65535'
      )
    }
  )
})
