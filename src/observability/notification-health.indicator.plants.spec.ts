/**
 * @fileoverview The readiness answer is never `up` because the realm forged a promise: a `then` that
 * answers for the awaited verification, or a `constructor` that sends the await through it.
 * @layer observability
 */

import { NotificationHealthIndicator } from './notification-health.indicator'

const INTRINSIC_THEN = Promise.prototype.then
const INTRINSIC_CONSTRUCTOR = Object.getOwnPropertyDescriptor(
  Promise.prototype,
  'constructor'
) as PropertyDescriptor

function restore(): void {
  Promise.prototype.then = INTRINSIC_THEN
  Object.defineProperty(Promise.prototype, 'constructor', INTRINSIC_CONSTRUCTOR)
}

/** A provider whose verification fails. */
function failing(): {
  isConfigured: () => boolean
  verify: () => Promise<void>
  send: () => never
} {
  return {
    isConfigured: () => true,
    verify: () => Promise.reject(new Error('down')),
    send: () => {
      throw new Error('unused')
    }
  }
}

describe('NotificationHealthIndicator against a forged promise', () => {
  afterEach(restore)

  it.each(Array.from({ length: 12 }, (_unused, index) => index + 1))(
    'should not report up for a failing verification when constructor read %i answers for the await',
    async (nth) => {
      const indicator = new NotificationHealthIndicator(failing() as never, {
        timeoutMs: 50
      })
      let reads = 0
      let armed = false
      Object.defineProperty(Promise.prototype, 'constructor', {
        configurable: true,
        get() {
          reads += 1
          if (reads === nth) {
            armed = true
            return Object
          }
          return Promise
        }
      })
      Promise.prototype.then = function (
        this: Promise<unknown>,
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) {
        if (armed) {
          armed = false
          return INTRINSIC_THEN.call(
            this,
            () => (onFulfilled ? onFulfilled(undefined) : undefined),
            onRejected
          )
        }
        return INTRINSIC_THEN.call(this, onFulfilled, onRejected)
      } as typeof Promise.prototype.then

      let result: { status?: string } | undefined
      try {
        result = await indicator.check()
      } catch {
        result = { status: 'threw' }
      }
      restore()

      // A read answered for the spec's own await leaves `undefined`: that is the harness, not `up`.
      expect(result?.status).not.toBe('up')
    }
  )
})

describe('NotificationHealthIndicator when the realm changes during a verification', () => {
  afterEach(restore)

  // The refusal path hands the started verification a handler only when it is a promise.
  it.each([
    ['a promise that rejects', () => Promise.reject(new Error('down'))],
    ['a plain value', () => undefined]
  ])('should report down for %s once the promises are replaced', async (_label, verify) => {
    const provider = { isConfigured: () => true, verify, send: () => undefined }
    const indicator = new NotificationHealthIndicator(provider as never, { timeoutMs: 50 })
    Promise.prototype.then = function (
      this: Promise<unknown>,
      onFulfilled?: (value: unknown) => unknown,
      onRejected?: (reason: unknown) => unknown
    ) {
      return INTRINSIC_THEN.call(this, onFulfilled, onRejected)
    } as typeof Promise.prototype.then

    const result = await indicator.check()
    restore()

    expect({ ...result }).toStrictEqual({ status: 'down' })
  })
})

describe('NotificationHealthIndicator when a built-in plants the forgery on its first call', () => {
  afterEach(restore)

  // The timer of the readiness bound and the clock the answer is kept by both run on this path: a
  // hook on either swaps the constructor and plants a `then` that answers `true`, then restores both.
  it.each([
    ['setTimeout', globalThis as unknown as Record<string, unknown>, 'setTimeout'],
    ['clearTimeout', globalThis as unknown as Record<string, unknown>, 'clearTimeout'],
    ['Date.now', Date as unknown as Record<string, unknown>, 'now']
  ])(
    'should not report up for a failing verification when %s plants it',
    async (_label, holder, name) => {
      const original = holder[name] as (...a: unknown[]) => unknown
      let armed = true
      holder[name] = function (this: unknown, ...args: unknown[]) {
        if (armed) {
          armed = false
          Object.defineProperty(Promise.prototype, 'constructor', {
            value: function Fake() {
              /* never constructed */
            },
            writable: true,
            configurable: true
          })
          Promise.prototype.then = function (onFulfilled?: (value: unknown) => unknown) {
            restore()
            return onFulfilled ? onFulfilled(true) : undefined
          } as typeof Promise.prototype.then
        }
        return original.apply(this, args)
      }
      const indicator = new NotificationHealthIndicator(failing() as never, { timeoutMs: 50 })

      // Restored before the spec awaits: a forgery still planted would answer for the spec's own await.
      let status: string
      try {
        const pending = indicator.check()
        holder[name] = original
        restore()
        status = (await pending).status
      } finally {
        holder[name] = original
        restore()
      }

      expect(status).toBe('down')
    }
  )
})
