import type { NotificationLogEntry } from '../interfaces/notification-log-repository.interface'

import { NoOpNotificationLogRepository } from './no-op-notification-log.repository'

const entry: NotificationLogEntry = {
  timestamp: Date.now(),
  tenantId: 'tenant-a',
  channel: 'otp',
  verb: 'generated',
  recipient: 'jane@acme.com',
  providerName: 'noop'
}

describe('NoOpNotificationLogRepository', () => {
  // Identity contract: the repository names itself "noop".
  it('should report name "noop"', () => {
    expect(new NoOpNotificationLogRepository().name).toBe('noop')
  })

  // The repository must accept an entry and resolve without side effects, so the
  // audit path stays uniform when no real sink is configured.
  it('should resolve create() without throwing', async () => {
    await expect(new NoOpNotificationLogRepository().create(entry)).resolves.toBeUndefined()
  })
})
