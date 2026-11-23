/**
 * @fileoverview Holds the exception the library throws to what the library gave it: a `status`, a
 * `message`, a `description`, a `value` or an `error` planted on the realm root changes neither its
 * status, its message nor its body.
 * @layer domain
 */

import { NotificationException } from './notification-exception'

const NAMES = ['status', 'message', 'description', 'value', 'error', 'details', 'code', 'response']

/** What an exception holds, as data, for a comparison. */
function observe(): unknown {
  const bare = new NotificationException('EMAIL_PROVIDER_NOT_CONFIGURED')
  const given = new NotificationException(
    'INVALID_SCOPE_IDENTIFIER',
    { boundary: 'b' },
    { message: 'given words' }
  )
  const withStatus = new NotificationException('INVALID_SCOPE_IDENTIFIER', undefined, 404)
  return [bare, given, withStatus].map((error) => ({
    status: error.getStatus(),
    message: error.message,
    body: JSON.stringify(error.getResponse())
  }))
}

describe('a key planted on the realm root under the name of a field of an exception', () => {
  const baseline = observe()

  afterEach(() => {
    for (const name of NAMES) {
      Reflect.deleteProperty(Object.prototype, name)
    }
  })

  it.each(NAMES)('should change nothing the exception holds when %s is planted', (name) => {
    Object.defineProperty(Object.prototype, name, {
      value: name === 'status' ? 418 : 'planted',
      configurable: true,
      writable: true,
      enumerable: true
    })

    expect(observe()).toStrictEqual(baseline)
  })
})
