/**
 * @fileoverview Holds `isLibraryError` to answering yes for the library's own errors and no for
 * everything else, including a value whose class check throws.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'

import { isLibraryError } from './is-library-error'

describe('isLibraryError', () => {
  it('should say yes for a NotificationException', () => {
    expect(isLibraryError(new NotificationException('EMAIL_SEND_FAILED'))).toBe(true)
  })

  it.each([
    ['an Error', new Error('x')],
    ['a string', 'x'],
    ['undefined', undefined],
    ['null', null]
  ])('should say no for %s', (_label, value) => {
    expect(isLibraryError(value)).toBe(false)
  })

  it('should say no, not throw, for a value whose class check throws', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const trapped = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('getPrototypeOf trap of the host object')
        }
      }
    )

    expect(isLibraryError(proxy)).toBe(false)
    expect(isLibraryError(trapped)).toBe(false)
  })
})
