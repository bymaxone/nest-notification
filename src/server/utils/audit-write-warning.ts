/**
 * @fileoverview The warning logged when an audit write fails and `audit.swallowErrors` hides it.
 * @layer utils
 *
 * A failure the caller never sees must still be visible to the operator. With
 * `audit.swallowErrors` set, sends and verifications keep succeeding when the audit repository
 * fails, so this warning is the only sign that the trail, including the entries that record a
 * recipient reaching its attempt ceiling, has stopped. An outage touches every operation, so a
 * line per failure would be a flood: the warning is rate limited per channel and counts what it
 * suppressed. The entry the repository rejected holds personal data, its recipient and user id,
 * and `maskRecipient` defaults to the identity function, so the reason has verbatim copies of
 * both removed before it is bounded. The tenant id, purpose, provider name and metadata are the
 * operator's own keys, labels and library-generated reasons, and stay readable so the cause of an
 * outage can be told.
 */
import type { Logger } from '@nestjs/common'

import { describeError } from './describe-error'
import { redactValues } from './redact'
import type { NotificationLogEntry } from '../interfaces/notification-log-repository.interface'

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
 * What to tell an operator about the error, as one bounded line without the identity of the
 * entry that was being written. A library exception's message is
 * only its class label, so its code is named instead; any other error is described by its
 * message. Both reach the line through {@link oneLine}: the code is a property of whatever the
 * repository threw, so nothing makes it a short catalog string. Reading the code is guarded: the
 * error is consumer code.
 */
function reasonOf(error: unknown, identity: readonly string[]): string {
  return oneLine(redactValues(libraryCodeOf(error) ?? describeError(error), identity))
}

/**
 * An address-like token of a recipient: a run of characters that is not whitespace, a list
 * separator, a bracket or a quote. However a recipient list is written (joined by `EmailService`,
 * or typed by the caller with commas, semicolons, tabs or newlines, padded, wrapped in angle
 * brackets or quotes, behind a display name), each address is one such token.
 */
const ADDRESS_TOKEN = /[^\s,;<>"'()]+/g

/**
 * The strings by which an entry identifies who it is about: every address-like token of its
 * recipient, because a repository names the one address it rejected and not the list, and its
 * user id. A token can only remove more, never less: a display-name word is removed too.
 */
function identityOf(
  entry: Pick<NotificationLogEntry, 'recipient' | 'userId'> | undefined
): string[] {
  const recipient = entry?.recipient
  const addresses = typeof recipient === 'string' ? (recipient.match(ADDRESS_TOKEN) ?? []) : []
  return [...addresses, entry?.userId].filter((value): value is string => typeof value === 'string')
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
 * The line carries the channel and the error text only, with the entry's recipient and user id
 * removed where the error quotes them verbatim; it holds no OTP code. There is no timer, so
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
   * @param error - What the audit repository threw; any value, described without throwing.
   * @param entry - The entry that could not be written, when the caller has it: its recipient and
   *   user id are removed from the reason wherever the error quotes them verbatim; a re-cased or
   *   re-encoded copy is not recognised, and an empty value names nothing.
   */
  warn(error: unknown, entry?: Pick<NotificationLogEntry, 'recipient' | 'userId'>): void {
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
        `(${reasonOf(error, identityOf(entry))}${similar}); ` +
        "the operation's result is unaffected because audit.swallowErrors is true."
    )
  }
}
