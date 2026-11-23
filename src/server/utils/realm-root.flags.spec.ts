/**
 * @fileoverview Holds the realm-root check to how it reads the flags of a standard key, and to what it
 * does with a built-in that was missing at load or a key that was not there then: a flag that only
 * turned off is hardening, every other difference is pollution, and a runtime that lacks a member the
 * baseline lists is a standard one. The last row makes a key non-configurable for good, so it stays last.
 * @layer infrastructure
 */

import { assertStandardRealmRoot, BASELINE_MEMBERS } from './realm-root'

type Loaded = typeof import('./realm-root')

const REFUSAL = { code: 'notification.invalid_scope_identifier' }

/** Loads a fresh copy of the module inside `isolated`, and returns it. */
function loadFresh(isolated: () => void): Loaded {
  let loaded: Loaded | undefined
  jest.isolateModules(() => {
    isolated()
    loaded = require('./realm-root') as Loaded
  })
  return loaded as Loaded
}

/** What `check` threw, or `undefined`. */
function thrown(check: () => void): unknown {
  try {
    check()
  } catch (error) {
    return error
  }
  return undefined
}

describe('the flags of a standard key', () => {
  it('should accept a key that only became read-only, with the same value', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'valueOf'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, 'valueOf', { writable: false })
    const caught = thrown(() => assertStandardRealmRoot('Owner'))
    Object.defineProperty(Object.prototype, 'valueOf', original)

    expect(caught).toBeUndefined()
  })

  it('should refuse a key overwritten with false, which is not a flag turning off', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'valueOf'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, 'valueOf', { ...original, value: false })
    const caught = thrown(() => assertStandardRealmRoot('Owner'))
    Object.defineProperty(Object.prototype, 'valueOf', original)

    expect(caught).toMatchObject(REFUSAL)
  })

  it('should refuse a key that was enumerable at load and is not now', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'isPrototypeOf'
    ) as PropertyDescriptor
    let loaded: Loaded | undefined
    try {
      loaded = loadFresh(() =>
        Object.defineProperty(Object.prototype, 'isPrototypeOf', { enumerable: true })
      )
    } finally {
      Object.defineProperty(Object.prototype, 'isPrototypeOf', original)
    }

    expect(thrown(() => (loaded as Loaded).assertStandardRealmRoot('Owner'))).toMatchObject(REFUSAL)
  })
})

describe('a key that was read-only at load', () => {
  it('should be refused when it became writable again, which is not hardening', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'valueOf'
    ) as PropertyDescriptor
    let loaded: Loaded | undefined
    try {
      loaded = loadFresh(() =>
        Object.defineProperty(Object.prototype, 'valueOf', { writable: false })
      )
    } finally {
      Object.defineProperty(Object.prototype, 'valueOf', original)
    }

    expect(thrown(() => (loaded as Loaded).assertStandardRealmRoot('Owner'))).toMatchObject(REFUSAL)
  })
})

describe('a key that was not there when the module loaded', () => {
  it('should count it twice when it came back: missing at load, and changed since', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__lookupGetter__'
    ) as PropertyDescriptor
    let loaded: Loaded | undefined
    try {
      loaded = loadFresh(() => Reflect.deleteProperty(Object.prototype, '__lookupGetter__'))
    } finally {
      Object.defineProperty(Object.prototype, '__lookupGetter__', original)
    }

    const caught = thrown(() => (loaded as Loaded).assertStandardRealmRoot('Owner')) as {
      getResponse(): unknown
    }

    expect(JSON.stringify(caught.getResponse())).toContain('holds 2 key(s)')
  })

  it('should accept a runtime without __proto__ as the standard one it is', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__proto__'
    ) as PropertyDescriptor
    let caught: unknown
    try {
      const loaded = loadFresh(() => Reflect.deleteProperty(Object.prototype, '__proto__'))
      caught = thrown(() => loaded.assertStandardRealmRoot('Owner'))
    } finally {
      Object.defineProperty(Object.prototype, '__proto__', original)
    }

    expect(caught).toBeUndefined()
  })
})

describe('a built-in the runtime does not have', () => {
  it.each([
    ['missing', undefined],
    ['present and undefined', { value: undefined, configurable: true, writable: true }]
  ])(
    'should be left out of the baseline, and not refused, when it is %s at load',
    (_name, define) => {
      const original = Object.getOwnPropertyDescriptor(
        String,
        'fromCodePoint'
      ) as PropertyDescriptor
      let loaded: Loaded | undefined
      try {
        loaded = loadFresh(() => {
          if (define === undefined) {
            Reflect.deleteProperty(String, 'fromCodePoint')
          } else {
            Object.defineProperty(String, 'fromCodePoint', define)
          }
        })
      } finally {
        Object.defineProperty(String, 'fromCodePoint', original)
      }

      expect(
        loaded.BASELINE_MEMBERS.some(
          ([holder, name]) => holder === String && name === 'fromCodePoint'
        )
      ).toBe(false)
      expect(thrown(() => loaded?.assertStandardRealmRoot('Owner'))).toBeUndefined()
    }
  )
})

describe('a name planted on Object.prototype before the module loads', () => {
  const PLANTS: ReadonlyArray<readonly [string, PropertyDescriptor]> = [
    ['a data property called value', { value: 'planted', configurable: true }],
    [
      'a getter called value that throws',
      {
        get: () => {
          throw new Error('planted getter ran')
        },
        configurable: true
      }
    ]
  ]

  it.each(PLANTS)(
    'should not change the baseline when it is %s, once the name is removed',
    (_name, plant) => {
      let loaded: Loaded | undefined
      jest.isolateModules(() => {
        // The module's own imports load first: a planted name would break the libraries they pull in.
        require('./bounded-list')
        require('./captured-crypto')
        try {
          Object.defineProperty(Object.prototype, 'value', plant)
          loaded = require('./realm-root') as Loaded
        } finally {
          Reflect.deleteProperty(Object.prototype, 'value')
        }
      })

      expect(thrown(() => loaded?.assertStandardRealmRoot('Owner'))).toBeUndefined()
      expect(loaded?.BASELINE_MEMBERS.length).toBe(BASELINE_MEMBERS.length)
    }
  )
})

describe('a key that became non-configurable', () => {
  // Irreversible in this file: no row after this one may use the key.
  it('should be accepted, with the same value, as hardening', () => {
    Object.defineProperty(Object.prototype, 'hasOwnProperty', { configurable: false })

    expect(thrown(() => assertStandardRealmRoot('Owner'))).toBeUndefined()
  })
})
