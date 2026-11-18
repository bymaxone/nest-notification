/**
 * @fileoverview Writes a log line as the structured form `nest-logger` reads: an `event` field
 * and the human text in `message`.
 * @layer utils
 */

import type { Logger } from '@nestjs/common'

import type { NotificationLogEvent } from '../constants/log-events.constants'

/** The levels this library writes at. */
export type LogEventLevel = 'log' | 'warn' | 'debug'

/**
 * Writes `{ event, message }` through a Nest `Logger`. With `@bymax-one/nest-logger` the two are
 * fields of the entry; the default Nest logger prints the object. `message` must keep the
 * human-readable text, its bracketed tag included, so a consumer that matches on the text stays
 * compatible with one that matches on `event`.
 *
 * @param logger - The Nest logger of the class that writes the line.
 * @param level - The level to write at.
 * @param event - The event of the line, from the closed set.
 * @param message - The human text of the library. It never carries the text of an error from a
 *   provider or from code the host supplied: that error goes in `err`.
 * @param err - The error behind the line, as an `Error` object for the logger's `err` field, scrubbed
 *   of secrets the way the error the caller receives is.
 */
export function logEvent(
  logger: Logger,
  level: LogEventLevel,
  event: NotificationLogEvent,
  message: string,
  err?: Error
): void {
  const entry = err === undefined ? { event, message } : { event, message, err }
  switch (level) {
    case 'log':
      logger.log(entry)
      break
    case 'warn':
      logger.warn(entry)
      break
    case 'debug':
      logger.debug(entry)
      break
  }
}
