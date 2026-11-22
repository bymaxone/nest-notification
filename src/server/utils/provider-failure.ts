/**
 * @fileoverview The failure of a send whose provider text is published, built in one place.
 * @layer utils
 *
 * A provider's error can quote the address it refused (`550 <bob@x.com>: Recipient rejected`), and
 * the adapter writes it twice: into the error it throws and into a log line. Every adapter builds
 * that failure here, so the address is masked in both and a new adapter cannot forget to.
 */

import type { Logger } from '@nestjs/common'

import type { NotificationLogEvent } from '../constants/log-events.constants'
import { logEvent } from './log-event'
import { loggableError } from './loggable-error'
import { maskAddresses } from './mask-in-text'

/**
 * Builds `<label> send failed: <reason>` with every address-shaped token of the reason masked,
 * logs it as a warning, and returns it for the caller to throw.
 *
 * @param logger - The adapter's logger.
 * @param event - The log event of the adapter's failed send.
 * @param notice - The fixed message of the log line.
 * @param label - The adapter's name as the thrown message words it.
 * @param reason - The provider's text, with secrets already removed.
 * @param code - The provider's own code, when it has one.
 * @returns The `Error` to throw.
 */
export function publishedFailure(
  logger: Logger,
  event: NotificationLogEvent,
  notice: string,
  label: string,
  reason: string,
  code: string | undefined
): Error {
  const failure = Object.assign(
    new Error(`${label} send failed: ${maskAddresses(reason)}`),
    code === undefined ? {} : { code }
  )
  logEvent(logger, 'warn', event, notice, loggableError(failure))
  return failure
}
