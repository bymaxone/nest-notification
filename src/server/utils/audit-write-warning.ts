/**
 * @fileoverview The warning logged when an audit write fails and `audit.swallowErrors` hides it.
 * @layer utils
 *
 * A swallowed audit failure used to leave nothing at all: sends and verifications kept
 * succeeding while the audit trail, including the entries that record a recipient hitting its
 * attempt ceiling, silently stopped. An outage touches every operation, so a line per failure
 * would be a flood; the warning is rate limited per channel and counts what it suppressed.
 */
import type { Logger } from '@nestjs/common'

import { describeError } from './describe-error'

/** The shortest time between two warnings of one channel. */
export const AUDIT_WARNING_INTERVAL_MS = 60_000

/** The place that swallowed the failure. */
export type AuditChannel = 'otp' | 'email' | 'interceptor'

const WARNING_CODE = 'BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED'

/** Prefix of every code in the library's own error catalog. */
const LIBRARY_CODE_PREFIX = 'notification.'

/**
 * What to tell an operator about the error. A library exception's message is only its class
 * label, so its code is named instead; any other error is described by its message. Reading the
 * code is guarded: the error is consumer code.
 */
function reasonOf(error: unknown): string {
  try {
    const code = (error as { code?: unknown } | null | undefined)?.code
    if (typeof code === 'string' && code.startsWith(LIBRARY_CODE_PREFIX)) {
      return code
    }
  } catch {
    // A hostile `code` getter contributes nothing; the message below still applies.
  }
  return describeError(error)
}

/**
 * Warns, at most once per interval, that an audit entry could not be written.
 *
 * The line carries the channel and the error text only: never the recipient, the entry or a
 * code. There is no timer, so nothing needs clearing at shutdown.
 */
export class AuditWriteWarning {
  private lastLoggedAt: number | undefined
  private suppressed = 0

  /**
   * @param logger - Where the line goes.
   * @param channel - The place that swallows the failure.
   */
  constructor(
    private readonly logger: Logger,
    private readonly channel: AuditChannel
  ) {}

  /**
   * Logs the warning, or counts the failure when one was logged less than an interval ago.
   *
   * @param error - What the audit repository threw; any value, described without throwing.
   */
  warn(error: unknown): void {
    const now = Date.now()
    if (this.lastLoggedAt !== undefined && now - this.lastLoggedAt < AUDIT_WARNING_INTERVAL_MS) {
      this.suppressed += 1
      return
    }
    const similar = this.suppressed > 0 ? `; ${this.suppressed} similar since the last line` : ''
    this.lastLoggedAt = now
    this.suppressed = 0
    this.logger.warn(
      `[${WARNING_CODE}] An audit entry could not be written by the ${this.channel} channel ` +
        `(${reasonOf(error)}${similar}); ` +
        "the operation's result is unaffected because audit.swallowErrors is true."
    )
  }
}
