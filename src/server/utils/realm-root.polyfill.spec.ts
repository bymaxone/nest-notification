/**
 * @fileoverview The realm-root check loads when a polyfill replaced the global `Promise` before it:
 * an `await` reads the prototype of the promise of an async function, so that is the baseline.
 * @layer utils
 */

describe('realm-root when the global Promise was polyfilled before it loads', () => {
  it('should load, and still pin a promise', () => {
    const REAL = globalThis.Promise
    function Polyfill(executor: never): Promise<unknown> {
      return new REAL(executor)
    }
    Polyfill.prototype = Object.create(REAL.prototype, { constructor: { value: Polyfill } })
    globalThis.Promise = Polyfill as never
    let loaded: typeof import('./realm-root') | undefined
    try {
      jest.isolateModules(() => {
        loaded = require('./realm-root')
      })
    } finally {
      globalThis.Promise = REAL
    }

    const pinned = loaded?.own(REAL.resolve(1))

    expect(pinned).toBeInstanceOf(REAL)
    expect(Object.getOwnPropertyDescriptor(pinned, 'constructor')?.value).toBe(REAL)
  })
})
