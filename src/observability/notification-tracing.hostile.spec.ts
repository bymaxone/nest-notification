/**
 * @fileoverview Holds the tracing adapter to rethrowing exactly what the operation threw, even when
 * the class check on that value throws: a hostile object must not replace itself with the trap's
 * error, and the span must still end.
 * @layer observability
 */

import { NotificationTracing } from './notification-tracing'

const TRAP = 'getPrototypeOf trap of the host object'

describe('NotificationTracing with a hostile failure', () => {
  it('should rethrow the object the operation threw, not the error of its class check', async () => {
    const thrown = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(TRAP)
        }
      }
    )

    const running = new NotificationTracing().span(
      'notification.send',
      { channel: 'email' },
      async () => {
        throw thrown
      }
    )

    await expect(running).rejects.toBe(thrown)
  })
})
