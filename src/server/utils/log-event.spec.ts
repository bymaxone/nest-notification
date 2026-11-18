/**
 * @fileoverview Holds `logEvent` to writing the structured form, `{ event, message }`, through the
 * level it is given and no other.
 * @layer utils
 */

import { Logger } from '@nestjs/common'

import { NOTIFICATION_LOG_EVENTS } from '../constants/log-events.constants'

import { logEvent } from './log-event'

describe('logEvent', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each(['log', 'warn', 'debug'] as const)(
    'should write the event and the text through %s and through no other level',
    (level) => {
      const spies = {
        log: jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
        warn: jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined),
        debug: jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)
      }

      logEvent(new Logger('Test'), level, NOTIFICATION_LOG_EVENTS.BOOTSTRAP_OK, 'the text')

      expect(spies[level]).toHaveBeenCalledTimes(1)
      expect(spies[level]).toHaveBeenCalledWith({
        event: 'NOTIFICATION_BOOTSTRAP_OK',
        message: 'the text'
      })
      for (const other of ['log', 'warn', 'debug'] as const) {
        if (other !== level) {
          expect(spies[other]).not.toHaveBeenCalled()
        }
      }
    }
  )
})
