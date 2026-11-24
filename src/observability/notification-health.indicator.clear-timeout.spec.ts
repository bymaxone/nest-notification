/**
 * @fileoverview The readiness answer is never `up` because a timer function the host replaced
 * planted a `then` after the last check: the answer is checked right before it is returned.
 * @layer observability
 */

import { NotificationHealthIndicator } from './notification-health.indicator'

describe('NotificationHealthIndicator when clearTimeout plants a then after the verification', () => {
  it('should report down for a relay that is down', async () => {
    const realClear = globalThis.clearTimeout
    globalThis.clearTimeout = ((handle: NodeJS.Timeout) => {
      Object.defineProperty(Object.prototype, 'then', {
        configurable: true,
        writable: true,
        value: function then(onFulfilled: (value: unknown) => unknown) {
          delete (Object.prototype as unknown as Record<string, unknown>).then
          onFulfilled({ status: 'up' })
        }
      })
      realClear(handle)
    }) as typeof clearTimeout
    const provider = {
      name: 'smtp',
      isConfigured: () => true,
      verify: () => Promise.reject(new Error('ECONNREFUSED')),
      send: () => {
        throw new Error('unused')
      }
    }

    let status: unknown
    try {
      status = (await new NotificationHealthIndicator(provider as never).check()).status
    } finally {
      globalThis.clearTimeout = realClear
      delete (Object.prototype as unknown as Record<string, unknown>).then
    }

    expect(status).toBe('down')
  })
})

describe('NotificationHealthIndicator after a check refused on a changed realm', () => {
  it('should verify again on the next check instead of sharing the abandoned one', async () => {
    let calls = 0
    const provider = {
      name: 'smtp',
      isConfigured: () => true,
      verify: () => {
        calls += 1
        return new Promise<void>((resolve) => setTimeout(resolve, 30))
      },
      send: () => {
        throw new Error('unused')
      }
    }
    const indicator = new NotificationHealthIndicator(provider as never, { timeoutMs: 500 })
    const realThen = Object.getOwnPropertyDescriptor(
      Promise.prototype,
      'then'
    ) as PropertyDescriptor
    Object.defineProperty(Object.prototype, 'then', { configurable: true, value: undefined })

    let first: unknown
    try {
      first = (await indicator.check()).status
    } finally {
      delete (Object.prototype as unknown as Record<string, unknown>).then
      Object.defineProperty(Promise.prototype, 'then', realThen)
    }
    const second = (await indicator.check()).status

    expect(first).toBe('down')
    expect(second).toBe('up')
    expect(calls).toBe(2)
  })
})
