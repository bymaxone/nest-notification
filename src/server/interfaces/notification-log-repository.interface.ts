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
  'sent' | 'generated' | 'verified' | 'failed' | 'cooldown_blocked' | 'max_attempts_exceeded'

/** A single audit-log entry. */
export interface NotificationLogEntry {
  /** Event time as a Unix timestamp in milliseconds. */
  timestamp: number
  /**
   * Basic SMTP reply code of a failed delivery, when the provider's answer
   * carried exactly one. Recorded for sends that withhold the provider's text:
   * the code is independent of the message body, so it diagnoses the failure
   * without disclosing anything the body held.
   */
  deliveryStatus?: number
  /**
   * RFC 3463 enhanced status code (`5.7.1`, `5.2.2`, …) of a failed delivery,
   * when the provider's answer carried exactly one. Distinguishes failures a
   * basic `550` cannot — a content rejection from a blocked sender.
   */
  deliveryEnhancedStatus?: string
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
