/**
 * @fileoverview Placeholder.
 * @layer infrastructure
 */

import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import { escapeAuditEntry } from '../utils/audit-escape'

export class EscapingLogRepository implements INotificationLogRepository {
  readonly name: string

  constructor(private readonly inner: INotificationLogRepository) {
    this.name = inner.name
  }

  async create(entry: NotificationLogEntry): Promise<void> {
    await this.inner.create(escapeAuditEntry(entry))
  }
}
