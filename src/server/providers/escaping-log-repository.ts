/**
 * @fileoverview Audit sink that escapes every entry before the host's repository stores it.
 * @layer infrastructure
 */

import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import { escapeAuditEntry } from '../utils/audit-escape'
import { readHostName } from '../utils/host-name'

/**
 * Wraps the host's {@link INotificationLogRepository} so that every entry written through it is
 * passed through `escapeAuditEntry` first. The host's own instance is left untouched.
 */
export class EscapingLogRepository implements INotificationLogRepository {
  /** The wrapped repository's name. */
  readonly name: string

  /** @param inner - The host's repository that receives the escaped entries. */
  constructor(private readonly inner: INotificationLogRepository) {
    this.name = readHostName(() => inner.name)
  }

  /** Writes `entry` to the wrapped repository with its strings escaped. */
  async create(entry: NotificationLogEntry): Promise<void> {
    await this.inner.create(escapeAuditEntry(entry))
  }
}
