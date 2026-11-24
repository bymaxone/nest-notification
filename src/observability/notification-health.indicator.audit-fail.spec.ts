/**
 * @fileoverview The readiness check is never `up` because a provider changed the realm while it ran
 * its own methods: a swapped global `Promise`, a descriptor read through `Object.prototype.value`, or
 * a promise no handler can be attached to.
 * @layer observability
 */

import { NotificationHealthIndicator } from './notification-health.indicator'

const REAL_PROMISE = Promise
const PROTOTYPE = Object.getPrototypeOf((async (): Promise<void> => undefined)()) as object
const THEN = Object.getOwnPropertyDescriptor(PROTOTYPE, 'then') as PropertyDescriptor
const CONSTRUCTOR = Object.getOwnPropertyDescriptor(PROTOTYPE, 'constructor') as PropertyDescriptor
const bare = (descriptor: object): PropertyDescriptor =>
  Object.assign(Object.create(null) as object, descriptor)

function restore(): void {
  Object.defineProperty(globalThis, 'Promise', {
    value: REAL_PROMISE,
    configurable: true,
    writable: true
  })
  Object.defineProperty(PROTOTYPE, 'then', THEN)
  Object.defineProperty(PROTOTYPE, 'constructor', CONSTRUCTOR)
  delete (Object.prototype as Record<string, unknown>).value
  delete (Object.prototype as Record<string, unknown>).then
}

afterEach(restore)

describe('NotificationHealthIndicator when isConfigured swaps the global Promise once', () => {
  it('should still run the verification and report the relay as down', async () => {
    let verifyCalls = 0
    const provider = {
      name: 'p',
      isConfigured: (): boolean => {
        Object.defineProperty(globalThis, 'Promise', {
          configurable: true,
          get() {
            Object.defineProperty(globalThis, 'Promise', {
              value: REAL_PROMISE,
              configurable: true,
              writable: true
            })
            return function Fake(): Promise<boolean> {
              return REAL_PROMISE.resolve(true)
            }
          }
        })
        return true
      },
      verify: (): Promise<void> => {
        verifyCalls += 1
        return REAL_PROMISE.reject(new Error('relay down'))
      },
      send: (): never => {
        throw new Error('unused')
      }
    }

    const result = await new NotificationHealthIndicator(provider as never, {}).check()

    expect([verifyCalls, result.status]).toStrictEqual([1, 'down'])
  })
})

/** Plants an accessor `constructor` and `then` read through `Object.prototype.value` on the promise prototype. */
function plantDescriptorForgery(): void {
  let reads = 0
  Object.defineProperty(Object.prototype, 'value', {
    configurable: true,
    get() {
      reads += 1
      return reads % 2 === 1 ? THEN.value : CONSTRUCTOR.value
    }
  })
  Object.defineProperty(
    PROTOTYPE,
    'constructor',
    bare({
      configurable: true,
      get() {
        return Object
      }
    })
  )
  Object.defineProperty(
    PROTOTYPE,
    'then',
    bare({
      configurable: true,
      get() {
        restore()
        return (resolve: (value: boolean) => void): void => {
          resolve(true)
        }
      }
    })
  )
}

describe('NotificationHealthIndicator when a descriptor is read through Object.prototype.value', () => {
  it('should not report up for a failing verification, and keep no forged answer', async () => {
    let verifyCalls = 0
    const provider = {
      name: 'p',
      send: (): never => {
        throw new Error('unused')
      },
      isConfigured: (): boolean => {
        plantDescriptorForgery()
        return true
      },
      verify: (): Promise<void> => {
        verifyCalls += 1
        return REAL_PROMISE.reject(new Error('relay down'))
      }
    }
    const indicator = new NotificationHealthIndicator(provider as never, {})

    const forged = await indicator.check()
    provider.isConfigured = (): boolean => true
    const honest = await indicator.check()

    // The second check verifies again: nothing forged was kept.
    expect([forged.status, honest.status, verifyCalls]).toStrictEqual(['down', 'down', 2])
  })
})

describe('NotificationHealthIndicator when verify returns a frozen promise that rejects later', () => {
  it('should leave no rejection without a handler', async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    const provider = {
      name: 'p',
      isConfigured: (): boolean => true,
      send: (): never => {
        throw new Error('unused')
      },
      verify: (): Promise<void> => {
        const pending = new REAL_PROMISE<void>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('relay down'))
          }, 30)
        })
        Object.freeze(pending)
        Object.defineProperty(Object.prototype, 'then', {
          configurable: true,
          value: undefined,
          writable: true
        })
        return pending
      }
    }

    const result = await new NotificationHealthIndicator(provider as never, {}).check()
    delete (Object.prototype as Record<string, unknown>).then
    await new REAL_PROMISE((resolve) => setTimeout(resolve, 120))
    process.off('unhandledRejection', listener)

    expect([result.status, unhandled]).toStrictEqual(['down', []])
  })
})

describe('NotificationHealthIndicator when a frozen promise cannot be given a handler', () => {
  it('should still absorb its rejection', async () => {
    const unhandled: unknown[] = []
    const listener = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', listener)
    const provider = {
      name: 'p',
      send: (): never => {
        throw new Error('unused')
      },
      isConfigured: (): boolean => {
        // Read once by the handler attached to the frozen promise, which throws; the next read is honest.
        Object.defineProperty(PROTOTYPE, 'constructor', {
          configurable: true,
          get() {
            Object.defineProperty(PROTOTYPE, 'constructor', CONSTRUCTOR)
            throw new Error('species lookup')
          }
        })
        return true
      },
      verify: (): Promise<void> => {
        const pending = new REAL_PROMISE<void>((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('relay down'))
          }, 30)
        })
        return Object.freeze(pending)
      }
    }

    const result = await new NotificationHealthIndicator(provider as never, {}).check()
    await new REAL_PROMISE((resolve) => setTimeout(resolve, 120))
    process.off('unhandledRejection', listener)

    expect([result.status, unhandled]).toStrictEqual(['down', []])
  })
})
