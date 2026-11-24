/**
 * @fileoverview The readiness answer follows what the relay did, whatever the host's promise carries,
 * and the module loads when a polyfill replaced the global `Promise` before it.
 * @layer observability
 */

import { NotificationHealthIndicator } from './notification-health.indicator'

function provider(verify: () => unknown): never {
  return {
    isConfigured: () => true,
    verify,
    send: () => {
      throw new Error('unused')
    }
  } as never
}

describe('NotificationHealthIndicator against a verification promise with its own then', () => {
  it('should report down, not up, when the failed verification carries a then that resolves', async () => {
    const indicator = new NotificationHealthIndicator(
      provider(() => {
        const failed = Promise.reject(new Error('relay down'))
        // An own constructor that is not %Promise% sends the await through `then`.
        Object.defineProperty(failed, 'constructor', { value: Object })
        Object.defineProperty(failed, 'then', { value: (ok: () => void) => ok() })
        return failed
      })
    )

    const result = await indicator.check()

    expect(result.status).toBe('down')
  })

  it('should leave no rejection unhandled when the promise carries a then that never listens', async () => {
    const unhandled: unknown[] = []
    const record = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const saved = process.listeners('unhandledRejection')
    process.removeAllListeners('unhandledRejection')
    process.on('unhandledRejection', record)
    try {
      const indicator = new NotificationHealthIndicator(
        provider(() => {
          const failed = Promise.reject(new Error('relay down'))
          Object.defineProperty(failed, 'constructor', { value: Object })
          Object.defineProperty(failed, 'then', { value: () => undefined })
          return failed
        }),
        { timeoutMs: 50 }
      )
      await indicator.check()
      await new Promise((resolve) => setTimeout(resolve, 60))
    } finally {
      process.removeListener('unhandledRejection', record)
      for (const listener of saved) {
        process.on('unhandledRejection', listener)
      }
    }

    expect(unhandled).toStrictEqual([])
  })
})

describe('NotificationHealthIndicator against a rejected verification whose constructor cannot be a species', () => {
  it.each([1, null])(
    'should leave no rejection unhandled when the own constructor is %p',
    async (constructorValue) => {
      const unhandled: unknown[] = []
      const record = (reason: unknown): void => {
        unhandled.push(reason)
      }
      const saved = process.listeners('unhandledRejection')
      process.removeAllListeners('unhandledRejection')
      process.on('unhandledRejection', record)
      let status: string
      try {
        const indicator = new NotificationHealthIndicator(
          provider(() => {
            const failed = Promise.reject(new Error('relay down'))
            Object.defineProperty(failed, 'constructor', {
              value: constructorValue,
              configurable: true
            })
            return failed
          }),
          { timeoutMs: 50 }
        )
        status = (await indicator.check()).status
        await new Promise((resolve) => setTimeout(resolve, 60))
      } finally {
        process.removeListener('unhandledRejection', record)
        for (const listener of saved) {
          process.on('unhandledRejection', listener)
        }
      }

      expect(status).toBe('down')
      expect(unhandled).toStrictEqual([])
    }
  )
})

describe('NotificationHealthIndicator against a verification that is not a promise', () => {
  it('should report up when verify returns a plain value', async () => {
    const indicator = new NotificationHealthIndicator(provider(() => undefined))

    const result = await indicator.check()

    expect(result.status).toBe('up')
  })

  it('should report down when verify throws', async () => {
    const indicator = new NotificationHealthIndicator(
      provider(() => {
        throw new Error('relay down')
      })
    )

    const result = await indicator.check()

    expect(result.status).toBe('down')
  })
})

describe('NotificationHealthIndicator when the global Promise was polyfilled before it loads', () => {
  it('should load, since an await reads the prototype of the async function promise', () => {
    const REAL = globalThis.Promise
    function Polyfill(executor: never): Promise<unknown> {
      return new REAL(executor)
    }
    Polyfill.prototype = Object.create(REAL.prototype, { constructor: { value: Polyfill } })
    globalThis.Promise = Polyfill as never
    try {
      expect(() => {
        jest.isolateModules(() => {
          jest.doMock('@bymax-one/nest-notification', () => ({
            BYMAX_NOTIFICATION_EMAIL_PROVIDER: Symbol('provider')
          }))
          require('./notification-health.indicator')
        })
      }).not.toThrow()
    } finally {
      globalThis.Promise = REAL
    }
  })
})
