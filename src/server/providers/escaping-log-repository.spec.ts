/**
 * @fileoverview Specifies `EscapingLogRepository`: a decorator that hands the repository it wraps
 * an escaped copy of every entry, and is otherwise transparent: the name, the outcome and the
 * error of the repository it wraps pass through unchanged.
 * @layer infrastructure
 */

import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'

import { EscapingLogRepository } from './escaping-log-repository'

const entry: NotificationLogEntry = {
  timestamp: 1,
  tenantId: 'tenant_a',
  channel: 'otp',
  verb: 'failed',
  recipient: 'a@x.com\nforged',
  providerName: 'memory',
  userId: 'u\r',
  errorMessage: 'boom next'
}

function inner(): { repository: INotificationLogRepository; received: NotificationLogEntry[] } {
  const received: NotificationLogEntry[] = []
  const repository: INotificationLogRepository = {
    name: 'inner-sink',
    create: jest.fn(async (written: NotificationLogEntry): Promise<void> => {
      received.push(written)
    })
  }
  return { repository, received }
}

describe('EscapingLogRepository', () => {
  it('should hand the wrapped repository an escaped copy', async () => {
    const { repository, received } = inner()

    await new EscapingLogRepository(repository).create(entry)

    expect(received).toEqual([
      {
        ...entry,
        recipient: 'a@x.com\\nforged',
        userId: 'u\\r',
        errorMessage: 'boom\\u2028next'
      }
    ])
  })

  it('should not change the entry it is given', async () => {
    const { repository } = inner()
    const given = { ...entry }

    await new EscapingLogRepository(repository).create(given)

    expect(given).toEqual(entry)
  })

  it('should call the wrapped repository once per entry', async () => {
    const { repository } = inner()

    await new EscapingLogRepository(repository).create(entry)

    expect(repository.create).toHaveBeenCalledTimes(1)
  })

  it('should carry the name of the wrapped repository', () => {
    expect(new EscapingLogRepository(inner().repository).name).toBe('inner-sink')
  })

  it('should reject with the very error the wrapped repository rejected with', async () => {
    const failure = new Error('sink is down')
    const repository: INotificationLogRepository = {
      name: 'broken',
      create: async () => {
        throw failure
      }
    }

    await expect(new EscapingLogRepository(repository).create(entry)).rejects.toBe(failure)
  })

  it('should wait for the wrapped repository before it resolves', async () => {
    let finished = false
    const repository: INotificationLogRepository = {
      name: 'slow',
      create: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        finished = true
      }
    }

    await new EscapingLogRepository(repository).create(entry)

    expect(finished).toBe(true)
  })

  it('should leave an entry with nothing to escape as it is', async () => {
    const { repository, received } = inner()
    const plain: NotificationLogEntry = {
      ...entry,
      recipient: 'a@x.com',
      userId: 'u1',
      errorMessage: 'boom'
    }

    await new EscapingLogRepository(repository).create(plain)

    expect(received[0]).toEqual(plain)
  })
})
