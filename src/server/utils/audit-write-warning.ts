/**
 * @fileoverview The warning logged when an audit write fails and `audit.swallowErrors` hides it.
 * @layer utils
 *
 * A failure the caller never sees must still be visible to the operator. With
 * `audit.swallowErrors` set, sends and verifications keep succeeding when the audit repository
 * fails, so this warning is the only sign that the trail, including the entries that record a
 * recipient reaching its attempt ceiling, has stopped. An outage touches every operation, so a
 * line per failure would be a flood: the warning is rate limited per channel and counts what it
 * suppressed. The entry the repository rejected holds personal data, and a repository error can
 * quote it in any form, so the line never carries the error's message: only the library's code,
 * or the error's name and code when each is a short token. The cause is in the repository's own
 * logs.
 */
import type { Logger } from '@nestjs/common'

/** The shortest time between two warnings of one channel. */
export const AUDIT_WARNING_INTERVAL_MS = 60_000

/** The place that swallowed the failure. */
export type AuditChannel = 'otp' | 'email' | 'interceptor'

const WARNING_CODE = 'BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED'

/** What a name or a code must look like to be named: a short token, never free text. */
const TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/

/** Prefix of every code in the library's own error catalog. */
const LIBRARY_CODE_PREFIX = 'notification.'

/** The value when it is a string that is a short token, else `undefined`. */
function tokenOf(value: unknown): string | undefined {
  return typeof value === 'string' && TOKEN.test(value) ? value : undefined
}

/**
 * What to tell an operator about the error, without any text the repository wrote. The message is
 * never read: a repository error can quote the entry it rejected, the recipient or the user id,
 * in any form. The library's own code is named when there is one; otherwise the error's name and
 * code, each only when it is a short token, since a custom name or code can carry text too.
 * Reading is guarded: the error is consumer code, and each property is read once.
 */
function reasonOf(error: unknown): string {
  try {
    const source = error as { name?: unknown; code?: unknown } | null | undefined
    const code = tokenOf(source?.code)
    if (code?.startsWith(LIBRARY_CODE_PREFIX)) {
      return code
    }
    const name = tokenOf(source?.name) ?? 'Error'
    return code === undefined ? name : `${name} ${code}`
  } catch {
    return 'Error'
  }
}

/**
 * Warns, at most once per interval, that an audit entry could not be written.
 *
 * The line carries the channel and the error's class or code only; it holds no message, no
 * recipient, no user id and no OTP code. There is no timer, so
 * nothing needs clearing at shutdown.
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
   * Whether `elapsed` milliseconds since the last line is still inside the interval.
   *
   * @internal
   */
  private within(elapsed: number): boolean {
    return elapsed >= 0 && elapsed < AUDIT_WARNING_INTERVAL_MS
  }

  /**
   * Logs the warning, or counts the failure when one was logged less than an interval ago.
   *
   * @param error - What the audit repository threw; any value, named without throwing.
   */
  warn(error: unknown): void {
    const now = Date.now()
    // A wall clock that stepped backward gives a negative elapsed time; that counts as the
    // interval having passed, so the warning is not silenced until the clock catches up.
    if (this.lastLoggedAt !== undefined && this.within(now - this.lastLoggedAt)) {
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
