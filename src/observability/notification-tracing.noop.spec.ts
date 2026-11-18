/**
 * @fileoverview Holds the tracing adapter to costing nothing when no OpenTelemetry SDK is
 * registered: the API's own tracer does nothing, and the operation runs and settles as it would
 * without a span.
 * @layer observability
 */

import { NotificationException } from '../server/errors/notification-exception'

import { NotificationTracing } from './notification-tracing'

describe('NotificationTracing without an SDK', () => {
  it('should return what the operation returns', async () => {
    await expect(
      new NotificationTracing().span('notification.send', { channel: 'email' }, async () => 42)
    ).resolves.toBe(42)
  })

  it('should rethrow what the operation throws', async () => {
    const failure = new NotificationException('EMAIL_SEND_FAILED')

    await expect(
      new NotificationTracing().span('notification.send', { channel: 'email' }, async () => {
        throw failure
      })
    ).rejects.toBe(failure)
  })
})
