/**
 * @fileoverview The root check never runs an accessor planted under the name of a descriptor field. Kept in a file of its
 * own: a spec that redefines a global binding on the test realm (even to restore it) makes V8 abort the process when a
 * descriptor of that binding is read while `get` or `set` is planted on `Object.prototype`.
 * @layer infrastructure
 */

import { assertStandardRealmRoot } from './realm-root'

describe('descriptors read while the root holds an accessor named like a descriptor field', () => {
  it.each(['get', 'set', 'value', 'writable', 'enumerable', 'configurable'])(
    'should not run a planted %s while it compares the standard keys',
    (name) => {
      const ran = jest.fn(() => {
        throw new Error('planted accessor ran')
      })
      Object.defineProperty(Object.prototype, name, { get: ran, configurable: true })
      let caught: unknown
      try {
        assertStandardRealmRoot('Owner')
      } catch (error) {
        caught = error
      } finally {
        Reflect.deleteProperty(Object.prototype, name)
      }

      expect(ran).not.toHaveBeenCalled()
      expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
    }
  )
})
