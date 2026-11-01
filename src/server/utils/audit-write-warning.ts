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

/** The most characters of an error's text the line carries. */
const MAX_REASON_LENGTH = 200

/** Prefix of every code in the library's own error catalog. */
const LIBRARY_CODE_PREFIX = 'notification.'

/**
 * What to tell an operator about the error, as one bounded line. A library exception's message is
 * only its class label, so its code is named instead; any other error is described by its
 * message. Both reach the line through {@link oneLine}: the code is a property of whatever the
 * repository threw, so nothing makes it a short catalog string. Reading the code is guarded: the
 * error is consumer code.
 */
function reasonOf(error: unknown): string {
  return oneLine(libraryCodeOf(error) ?? describeError(error))
}

/** The error's code when it is a string in the library's catalog namespace, else `undefined`. */
function libraryCodeOf(error: unknown): string | undefined {
  try {
    const code = (error as { code?: unknown } | null | undefined)?.code
    return typeof code === 'string' && code.startsWith(LIBRARY_CODE_PREFIX) ? code : undefined
  } catch {
    // A hostile `code` getter contributes nothing; the message still applies.
    return undefined
  }
}

/**
 * Replaces every control character, line breaks included, and every run of whitespace with one
 * space, and cuts the text at the limit without splitting an astral character. A repository error
 * can quote the entry it failed to write over many lines and at any length; the line stays one
 * line and bounded, so it can neither flood the log, forge a second line in it, nor send a
 * terminal an escape sequence.
 */
function oneLine(text: string): string {
  const flat = text.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ').trim()
  if (flat.length <= MAX_REASON_LENGTH) {
    return flat
  }
  const cut = flat.slice(0, MAX_REASON_LENGTH)
  const last = cut.charCodeAt(cut.length - 1)
  const whole = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut
  return `${whole}…`
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
   * @param error - What the audit repository threw; any value, described without throwing.
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
