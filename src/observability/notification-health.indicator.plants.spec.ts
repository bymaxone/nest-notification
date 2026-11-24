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

    expect(result).toStrictEqual({ status: 'down' })
  })
})
