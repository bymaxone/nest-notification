/**
 * @fileoverview Holds the realm-root check to its contract: it refuses while `Object.prototype`
 * holds any string key outside the runtime's standard set, reports a count and never a key or a
 * value, and answers the same for a clean root.
 * @layer infrastructure
 */

import { assertStandardRealmRoot, STANDARD_ROOT_KEYS } from './realm-root'

let planted: string[] = []

function plant(name: string, value: unknown): void {
  Object.defineProperty(Object.prototype, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: false
  })
  planted.push(name)
}

afterEach(() => {
  for (const name of planted) {
    Reflect.deleteProperty(Object.prototype, name)
  }
  planted = []
})

describe('the standard set', () => {
  it('should be exactly the string keys Object.prototype has in this runtime', () => {
    expect([...STANDARD_ROOT_KEYS].sort()).toStrictEqual(
      Object.getOwnPropertyNames(Object.prototype).sort()
    )
  })
})

describe('assertStandardRealmRoot', () => {
  it('should return for a root that holds only the standard keys', () => {
    expect(() => assertStandardRealmRoot('Owner')).not.toThrow()
  })

  it.each(['getSocket', 'raw', 'timeout', 'anything-else', 'ünicode', '0'])(
    'should refuse while %s is planted',
    (name) => {
      plant(name, 'planted-value-abc')

      expect(() => assertStandardRealmRoot('Owner')).toThrow(
        expect.objectContaining({ code: 'notification.invalid_scope_identifier' })
      )
    }
  )

  it('should report a count and never a key or a value', () => {
    plant('secretKeyName', 'secretValue')
    plant('another', 'secretValue2')

    const error = (() => {
      try {
        assertStandardRealmRoot('Owner')
      } catch (caught) {
        return caught as { message: string; getResponse(): unknown }
      }
      return undefined
    })()

    const published = JSON.stringify(error?.getResponse()) + String(error?.message)
    expect(published).toContain('holds 2 key(s)')
    expect(published).not.toMatch(/secretKeyName|another|secretValue/u)
  })

  it('should ignore a symbol key, which no transport reads by name', () => {
    const symbol = Symbol('s')
    Object.defineProperty(Object.prototype, symbol, { value: 1, configurable: true })

    try {
      expect(() => assertStandardRealmRoot('Owner')).not.toThrow()
    } finally {
      Reflect.deleteProperty(Object.prototype, symbol)
    }
  })

  it('should answer for the root as it is now, not as it was when the module loaded', () => {
    expect(() => assertStandardRealmRoot('Owner')).not.toThrow()
    plant('late', 1)

    expect(() => assertStandardRealmRoot('Owner')).toThrow()
  })
})
