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

/**
 * Runs `action` with a standard key of the root changed, restores it, and returns what `check`
 * threw: restoring first keeps the test runner's own use of the root away from the change.
 */
function withChangedKey(
  name: string,
  change: (current: PropertyDescriptor) => PropertyDescriptor
): unknown {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, name) as PropertyDescriptor
  Object.defineProperty(Object.prototype, name, change(original))
  let caught: unknown
  try {
    assertStandardRealmRoot('Owner')
  } catch (error) {
    caught = error
  } finally {
    Object.defineProperty(Object.prototype, name, original)
  }
  return caught
}

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

  it('should name the root and the owner in the refusal', () => {
    plant('extra', 1)

    const response = (() => {
      try {
        assertStandardRealmRoot('Owner')
      } catch (error) {
        return (error as { getResponse(): unknown }).getResponse()
      }
      return undefined
    })()

    expect(response).toMatchObject({
      error: { details: { boundary: 'Owner', parameter: 'Object.prototype' } }
    })
  })

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

describe('a standard key that was overwritten, redefined or removed', () => {
  it.each(['hasOwnProperty', 'toString', 'constructor', 'valueOf', 'isPrototypeOf'])(
    'should refuse when %s is overwritten with a value',
    (name) => {
      const caught = withChangedKey(name, (current) => ({ ...current, value: 1 }))

      expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
    }
  )

  it('should refuse when a standard accessor is replaced', () => {
    const caught = withChangedKey('__proto__', (current) => ({ ...current, get: () => null }))

    expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })

  it('should refuse when a flag of a standard key is changed, with the same value', () => {
    const caught = withChangedKey('toString', (current) => ({ ...current, enumerable: true }))

    expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })

  it('should refuse when a standard key is removed', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'valueOf'
    ) as PropertyDescriptor
    Reflect.deleteProperty(Object.prototype, 'valueOf')
    let caught: unknown
    try {
      assertStandardRealmRoot('Owner')
    } catch (error) {
      caught = error
    } finally {
      Object.defineProperty(Object.prototype, 'valueOf', original)
    }

    expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })

  it('should count the changed key with the others and report nothing else', () => {
    plant('extra', 'secretValue')
    const caught = withChangedKey('hasOwnProperty', (current) => ({
      ...current,
      value: 'secretOver'
    })) as { getResponse(): unknown }

    const published = JSON.stringify(caught.getResponse())
    expect(published).toContain('holds 2 key(s)')
    expect(published).not.toMatch(/hasOwnProperty|secretOver|secretValue|extra/u)
  })

  it('should answer the same again once the key is restored', () => {
    withChangedKey('toString', (current) => ({ ...current, value: 1 }))

    expect(() => assertStandardRealmRoot('Owner')).not.toThrow()
  })
})

describe('a realm that was polluted before the library loaded', () => {
  /** Loads a fresh copy of the module while `change` has altered the root, and returns what a use does. */
  function useAfterLoadingWith(name: string, value: unknown): unknown {
    const original = Object.getOwnPropertyDescriptor(Object.prototype, name) as PropertyDescriptor
    let caught: unknown
    jest.isolateModules(() => {
      Object.defineProperty(Object.prototype, name, { ...original, value })
      try {
        const loaded = require('./realm-root') as typeof import('./realm-root')
        loaded.assertStandardRealmRoot('Owner')
      } catch (error) {
        caught = error
      } finally {
        Object.defineProperty(Object.prototype, name, original)
      }
    })
    return caught
  }

  it.each([
    [
      'hasOwnProperty',
      function evil(this: object, key: string) {
        return Object.hasOwn(this, key)
      }
    ],
    ['toString', 'x'],
    ['constructor', function Evil() {}],
    ['valueOf', () => 1]
  ])('should refuse on every use when %s was not what it must be at load', (name, value) => {
    expect(useAfterLoadingWith(name, value)).toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
  })

  it.each(['toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'])(
    'should refuse when %s was replaced at load by a function that carries the same name',
    (name) => {
      // hasOwnProperty must still answer truthfully, or the module loader in this test breaks.
      const spoof =
        name === 'hasOwnProperty'
          ? function hasOwnProperty(this: object, key: string): boolean {
              return Object.hasOwn(this, key)
            }
          : ({ [name]: () => 'spoofed' }[name] as unknown)

      expect(useAfterLoadingWith(name, spoof)).toMatchObject({
        code: 'notification.invalid_scope_identifier'
      })
    }
  )

  it.each(['toString', 'valueOf', 'hasOwnProperty'])(
    'should refuse when %s was replaced at load by a Proxy that reads native',
    (name) => {
      const original = Object.getOwnPropertyDescriptor(Object.prototype, name)?.value as (
        ...args: unknown[]
      ) => unknown
      // A Proxy of a native answers as the native does, so this is the form that looks the same.
      const ofNative = new Proxy(original, {})
      // A Proxy of a JavaScript function with the same name reads `[native code]` too.
      const ofScript = new Proxy(
        {
          [name]: function (this: object, key: string) {
            return Object.hasOwn(this, key)
          }
        }[name] as (...args: unknown[]) => unknown,
        {}
      )

      expect(useAfterLoadingWith(name, ofNative)).toMatchObject({
        code: 'notification.invalid_scope_identifier'
      })
      expect(useAfterLoadingWith(name, ofScript)).toMatchObject({
        code: 'notification.invalid_scope_identifier'
      })
    }
  )

  it('should refuse when the __proto__ accessor was replaced at load by functions of JavaScript', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__proto__'
    ) as PropertyDescriptor
    let caught: unknown
    jest.isolateModules(() => {
      Object.defineProperty(Object.prototype, '__proto__', {
        get: function () {
          return null
        },
        set: function (_value: unknown): void {
          // ignored
        },
        configurable: true
      })
      try {
        ;(require('./realm-root') as typeof import('./realm-root')).assertStandardRealmRoot('Owner')
      } catch (error) {
        caught = error
      } finally {
        Object.defineProperty(Object.prototype, '__proto__', original)
      }
    })

    expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })

  it('should refuse when the __proto__ accessor was replaced at load by Proxies of its native functions', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__proto__'
    ) as PropertyDescriptor
    let caught: unknown
    jest.isolateModules(() => {
      Object.defineProperty(Object.prototype, '__proto__', {
        get: new Proxy(original.get as () => unknown, {}),
        set: new Proxy(original.set as (value: unknown) => void, {}),
        configurable: true
      })
      try {
        ;(require('./realm-root') as typeof import('./realm-root')).assertStandardRealmRoot('Owner')
      } catch (error) {
        caught = error
      } finally {
        Object.defineProperty(Object.prototype, '__proto__', original)
      }
    })

    expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })

  it('should refuse when __proto__ was not an accessor at load', () => {
    const caught = ((): unknown => {
      const original = Object.getOwnPropertyDescriptor(
        Object.prototype,
        '__proto__'
      ) as PropertyDescriptor
      let result: unknown
      jest.isolateModules(() => {
        Object.defineProperty(Object.prototype, '__proto__', {
          value: 1,
          configurable: true,
          writable: true
        })
        try {
          ;(require('./realm-root') as typeof import('./realm-root')).assertStandardRealmRoot(
            'Owner'
          )
        } catch (error) {
          result = error
        } finally {
          Object.defineProperty(Object.prototype, '__proto__', original)
        }
      })
      return result
    })()

    expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })

  it.each([
    ['the setter', true],
    ['the getter', false]
  ])(
    'should refuse when only %s of __proto__ was written in JavaScript at load',
    (_name, setterIsScript) => {
      const original = Object.getOwnPropertyDescriptor(
        Object.prototype,
        '__proto__'
      ) as PropertyDescriptor
      let caught: unknown
      jest.isolateModules(() => {
        Object.defineProperty(Object.prototype, '__proto__', {
          get: setterIsScript
            ? (original.get as () => unknown)
            : function (this: unknown) {
                return Object.getPrototypeOf(this)
              },
          set: setterIsScript
            ? function (_value: unknown): void {
                // ignored
              }
            : (original.set as (value: unknown) => void),
          configurable: true
        })
        try {
          ;(require('./realm-root') as typeof import('./realm-root')).assertStandardRealmRoot(
            'Owner'
          )
        } catch (error) {
          caught = error
        } finally {
          Object.defineProperty(Object.prototype, '__proto__', original)
        }
      })

      expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
    }
  )

  it.each([
    ['toString', Array.prototype.join],
    ['valueOf', Array.prototype.slice],
    ['constructor', Array]
  ])('should refuse when %s was a native function of another name at load', (name, native) => {
    expect(useAfterLoadingWith(name, native)).toMatchObject({
      code: 'notification.invalid_scope_identifier'
    })
  })

  it('should refuse when a standard key was missing at load', () => {
    const original = Object.getOwnPropertyDescriptor(
      Object.prototype,
      '__lookupGetter__'
    ) as PropertyDescriptor
    let caught: unknown
    jest.isolateModules(() => {
      Reflect.deleteProperty(Object.prototype, '__lookupGetter__')
      try {
        ;(require('./realm-root') as typeof import('./realm-root')).assertStandardRealmRoot('Owner')
      } catch (error) {
        caught = error
      } finally {
        Object.defineProperty(Object.prototype, '__lookupGetter__', original)
      }
    })

    expect(caught).toMatchObject({ code: 'notification.invalid_scope_identifier' })
    // One key is missing, and it counts once: not as missing at load and again as changed since.
    expect(JSON.stringify((caught as { getResponse(): unknown }).getResponse())).toContain(
      'holds 1 key(s)'
    )
  })

  it('should load without throwing, and answer clean once the realm is clean', () => {
    let loaded: typeof import('./realm-root') | undefined
    jest.isolateModules(() => {
      loaded = require('./realm-root') as typeof import('./realm-root')
    })

    expect(() => loaded?.assertStandardRealmRoot('Owner')).not.toThrow()
  })
})

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

describe('a built-in replaced after the module was imported', () => {
  /** What lies in favour of a clean root, for the built-ins the check could once have called. */
  const LIARS: ReadonlyArray<readonly [string, object, PropertyKey, unknown]> = [
    ['Object.getOwnPropertyNames', Object, 'getOwnPropertyNames', () => []],
    ['Object.hasOwn', Object, 'hasOwn', () => false],
    ['Object.is', Object, 'is', () => true],
    ['Reflect.get', Reflect, 'get', () => undefined],
    ['Set.prototype.has', Set.prototype, 'has', () => true],
    ['Set.prototype[Symbol.iterator]', Set.prototype, Symbol.iterator, function* () {}],
    ['Map.prototype.get', Map.prototype, 'get', () => undefined],
    ['Array.prototype.filter', Array.prototype, 'filter', () => []],
    ['Array.prototype.map', Array.prototype, 'map', () => []],
    ['Array.prototype.some', Array.prototype, 'some', () => false],
    ['Array.prototype.at', Array.prototype, 'at', () => undefined],
    ['Array.prototype[Symbol.iterator]', Array.prototype, Symbol.iterator, function* () {}],
    ['String.prototype.endsWith', String.prototype, 'endsWith', () => true],
    ['String', globalThis, 'String', () => ''],
    ['Function.prototype.call', Function.prototype, 'call', () => true],
    ['Function.prototype.bind', Function.prototype, 'bind', () => () => true],
    [
      'Function.prototype.toString',
      Function.prototype,
      'toString',
      () => 'function () { [native code] }'
    ]
  ]

  /**
   * Runs the check once with `replacement` in place of `target[key]` and the root made unclean: by a
   * key it does not hold (`plant`), or by a standard key overwritten (`overwrite`). It returns what
   * the check did.
   */
  function checkWith(
    target: object,
    key: PropertyKey,
    replacement: unknown,
    how: 'plant' | 'overwrite'
  ): unknown {
    const original = Object.getOwnPropertyDescriptor(target, key) as PropertyDescriptor
    const standard = Object.getOwnPropertyDescriptor(
      Object.prototype,
      'toString'
    ) as PropertyDescriptor
    if (how === 'plant') {
      Object.defineProperty(Object.prototype, 'plantedAfterImport', {
        value: 1,
        configurable: true,
        enumerable: true
      })
    } else {
      Object.defineProperty(Object.prototype, 'toString', {
        ...standard,
        value: () => 'overwritten'
      })
    }
    Object.defineProperty(target, key, { ...original, value: replacement })
    let caught: unknown = 'did not refuse'
    try {
      assertStandardRealmRoot('Owner')
    } catch (error) {
      caught = error
    } finally {
      Object.defineProperty(target, key, original)
      Reflect.deleteProperty(Object.prototype, 'plantedAfterImport')
      Object.defineProperty(Object.prototype, 'toString', standard)
    }
    return caught
  }

  const CASES = LIARS.flatMap(([label, target, key, replacement]) =>
    (['plant', 'overwrite'] as const).map((how) => [label, target, key, replacement, how] as const)
  )

  it.each(CASES)(
    'should still refuse when %s answers that the root is clean: %s',
    (_label, target, key, replacement, how) => {
      const caught = checkWith(target, key, replacement, how)

      // It refuses: the send stops. What the refusal is built from is not the check's, and a built-in
      // the exception uses may change its words, so what is held here is that nothing is let through.
      expect(caught).not.toBe('did not refuse')
    }
  )

  it('should write the count of the refusal without asking the global String', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'String') as PropertyDescriptor
    Object.defineProperty(Object.prototype, 'plantedAfterImport', {
      value: 1,
      configurable: true,
      enumerable: true
    })
    Object.defineProperty(globalThis, 'String', { ...original, value: () => 'replaced' })
    let response: unknown
    try {
      assertStandardRealmRoot('Owner')
    } catch (error) {
      response = (error as { getResponse?: () => unknown }).getResponse?.()
    } finally {
      Object.defineProperty(globalThis, 'String', original)
      Reflect.deleteProperty(Object.prototype, 'plantedAfterImport')
    }

    expect(JSON.stringify(response)).toContain('holds 1 key(s)')
  })
})
