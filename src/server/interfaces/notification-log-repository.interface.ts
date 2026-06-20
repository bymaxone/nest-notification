/**
 * @fileoverview Audit-log repository contract (`INotificationLogRepository`).
 * @layer domain
 *
 * Optional compliance/audit sink. The consumer owns persistence (Postgres, Mongo,
 * ClickHouse, BigQuery, …); the library only describes the entry shape.
 */

import type { NotificationChannel } from '../../shared/types/notification-channel.types'

/** Event verb recorded on a {@link NotificationLogEntry}. */
export type NotificationLogVerb =
  | 'sent'
  | 'generated'
  | 'verified'
  | 'failed'
  | 'cooldown_blocked'
  | 'max_attempts_exceeded'

/** A single audit-log entry. */
export interface NotificationLogEntry {
  /** Event time as a Unix timestamp in milliseconds. */
  timestamp: number
  /** Tenant the event belongs to. */
  tenantId: string
  /** Channel the event occurred on. */
  channel: NotificationChannel
  /** What happened. */
  verb: NotificationLogVerb
  /** Recipient identifier (email/phone/userId) — masked when the consumer configures a masker. */
  recipient: string
  /** OTP purpose, or the email template name. */
  purpose?: string
  /** Provider name used (`resend`, `twilio`, `fcm`, …). */
  providerName: string
  /** Provider-returned message id, for correlation. */
  messageId?: string
  /** Failure message only — NEVER a stack trace (avoids PII / vulnerability leakage). */
  errorMessage?: string
  /** Associated user id, when known. */
  userId?: string
  /** Arbitrary caller metadata. */
  metadata?: Record<string, unknown>
}

/**
 * Notification audit-log repository.
 *
 * Records successful send/generate/verify calls and failures. Writes are
 * fire-and-forget — gated by the channel's `audit.swallowErrors` setting.
 */
export interface INotificationLogRepository {
  /**
   * Persists one audit entry.
   *
   * @param entry - The entry to record.
   */
  create(entry: NotificationLogEntry): Promise<void>

  /** Repository name (e.g. `'prisma'`, `'noop'`). */
  readonly name: string
}
