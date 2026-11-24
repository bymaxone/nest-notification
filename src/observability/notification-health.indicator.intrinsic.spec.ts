/**
 * @fileoverview The readiness check takes %Promise% from the engine, not from whatever the
 * `constructor` slot of `Promise.prototype` held when the module loaded.
 * @layer observability
 */

export {}

const SLOT = Object.getOwnPropertyDescriptor(Promise.prototype, 'constructor') as PropertyDescriptor
const ASYNC_PROTOTYPE = Object.getPrototypeOf((async () => undefined)()) as object

function loadWithSlot(replacement: unknown): () => unknown {
  return () => {
    Object.defineProperty(Promise.prototype, 'constructor', { ...SLOT, value: replacement })
    try {
      jest.isolateModules(() => {
        // The server entry has its own load-time check of the same slot; keep it out of this one.
        jest.doMock('@bymax-one/nest-notification', () => ({
          BYMAX_NOTIFICATION_EMAIL_PROVIDER: Symbol('provider')
        }))
        require('./notification-health.indicator')
      })
    } finally {
      Object.defineProperty(Promise.prototype, 'constructor', SLOT)
    }
  }
}

describe('NotificationHealthIndicator at load', () => {
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
})
