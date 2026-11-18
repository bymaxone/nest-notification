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
 * @param message - The human text. It never carries a value a host supplied that is not escaped.
 */
export function logEvent(
  logger: Logger,
  level: LogEventLevel,
  event: NotificationLogEvent,
  message: string
): void {
  const entry = { event, message }
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
