/**
 * @fileoverview The %Promise% the realm root pins is the engine's own: a `constructor` slot of
 * `Promise.prototype` replaced before the module loads is refused at load, not taken as the baseline.
 * @layer utils
 */

export {}

const SLOT = Object.getOwnPropertyDescriptor(Promise.prototype, 'constructor') as PropertyDescriptor
const ASYNC_PROTOTYPE = Object.getPrototypeOf((async () => undefined)()) as object

function loadWithSlot(replacement: unknown): () => unknown {
  return () => {
    Object.defineProperty(Promise.prototype, 'constructor', { ...SLOT, value: replacement })
    try {
      jest.isolateModules(() => {
        require('./realm-root')
      })
    } finally {
      Object.defineProperty(Promise.prototype, 'constructor', SLOT)
    }
  }
}

describe('the realm root at load', () => {
  it('should refuse a JavaScript function in the slot, even with the right prototype', () => {
    const Fake = function Promise() {
      /* never constructed */
    }
    Fake.prototype = ASYNC_PROTOTYPE

    expect(loadWithSlot(Fake)).toThrow('not the engine Promise')
  })

  it('should refuse a native function whose prototype is not the promise prototype', () => {
    expect(loadWithSlot(Map)).toThrow('not the engine Promise')
  })

  it('should load when the slot holds the engine Promise', () => {
    expect(loadWithSlot(Promise)).not.toThrow()
  })
})
