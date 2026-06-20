/**
 * @fileoverview Audit repository that discards every entry.
 * @layer infrastructure
 *
 * The default `INotificationLogRepository` when the consumer does not configure
 * an audit sink. Keeps the audit code path uniform (always a repository present)
 * without persisting anything.
 */

import { Injectable } from '@nestjs/common'

import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'

/** No-op audit repository: silently discards every entry. */
@Injectable()
export class NoOpNotificationLogRepository implements INotificationLogRepository {
  readonly name = 'noop'

  /**
   * Discards the entry.
   *
   * @param _entry - The audit entry; intentionally ignored.
   */
  async create(_entry: NotificationLogEntry): Promise<void> {
    // Discards silently — no audit sink is configured.
  }
}
