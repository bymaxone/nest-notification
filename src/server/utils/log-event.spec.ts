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

  // `toHaveBeenCalledWith` treats a key whose value is undefined as absent, so the keys are read.
  it('should write no err key at all when there is no error', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    logEvent(new Logger('Test'), 'warn', NOTIFICATION_LOG_EVENTS.BOOTSTRAP_OK, 'the text')

    expect(Object.keys(warn.mock.calls[0]?.[0] as object)).toEqual(['event', 'message'])
  })

  it('should write the error under err when there is one', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const failure = new Error('relay said no')

    logEvent(
      new Logger('Test'),
      'warn',
      NOTIFICATION_LOG_EVENTS.SMTP_SEND_FAILED,
      'the text',
      failure
    )

    const entry = warn.mock.calls[0]?.[0] as { event: string; message: string; err: Error }
    expect(Object.keys(entry)).toEqual(['err', 'event', 'message'])
    expect(entry.err).toBe(failure)
  })

  describe('a host logger that throws', () => {
    afterEach(() => {
      Logger.overrideLogger(['log', 'warn', 'error', 'debug'])
    })

    it.each(['log', 'warn', 'debug'] as const)(
      'should absorb a synchronous throw at %s through a real Nest Logger',
      (level) => {
        const calls: string[] = []
        Logger.overrideLogger({
          log: () => {
            calls.push('log')
            throw new Error('log sink down')
          },
          warn: () => {
            calls.push('warn')
            throw new Error('warn sink down')
          },
          debug: () => {
            calls.push('debug')
            throw new Error('debug sink down')
          },
          error: () => undefined
        })

        expect(() =>
          logEvent(new Logger('Test'), level, NOTIFICATION_LOG_EVENTS.BOOTSTRAP_OK, 'the text')
        ).not.toThrow()
        expect(calls).toEqual([level])
      }
    )
  })
})
