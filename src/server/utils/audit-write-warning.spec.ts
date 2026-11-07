/**
 * @fileoverview Specifies the warning logged when an audit write fails and is swallowed: the
 * exact line, that the first failure always logs, that repeats inside the interval are counted
 * instead of logged, and that no text the repository supplied reaches the line. Only the library's
 * own error code, or the error's name and code when each is a short token, is ever named.
 * @layer utils
 */
import { Logger } from '@nestjs/common'
import * as vm from 'node:vm'

import { NotificationException } from '../errors/notification-exception'

import { AUDIT_WARNING_INTERVAL_MS, AuditWriteWarning } from './audit-write-warning'

const CODE = 'BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED'

/** The line for a given reason, as the warning writes it. */
const lineFor = (channel: string, reason: string): string =>
  `[${CODE}] An audit entry could not be written by the ${channel} channel (${reason}); ` +
  "the operation's result is unaffected because audit.swallowErrors is true."

describe('AuditWriteWarning', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(1_000_000)
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  const lines = (): string[] => warn.mock.calls.map((call) => String(call[0]))

  /** Warns once about `error` on a fresh instance and returns the line. */
  const warnAbout = (error: unknown, channel: 'otp' | 'email' | 'interceptor' = 'otp'): string => {
    warn.mockClear()
    new AuditWriteWarning(new Logger('Test'), channel).warn(error)
    return lines()[0] ?? ''
  }

  describe('the line', () => {
    it('should log the documented line for the first failure', () => {
      expect(warnAbout(new Error('store down'))).toBe(lineFor('otp', 'Error'))
    })

    it('should name the channel that failed', () => {
      expect(warnAbout(new Error('x'), 'interceptor')).toBe(lineFor('interceptor', 'Error'))
    })

    it('should name the error class and a short code', () => {
      const driver = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
        code: 'ECONNREFUSED'
      })

      expect(warnAbout(driver)).toBe(lineFor('otp', 'Error ECONNREFUSED'))
    })

    it('should name a driver error class and its code', () => {
      class PrismaClientKnownRequestError extends Error {
        override readonly name = 'PrismaClientKnownRequestError'
        readonly code = 'P2002'
      }

      expect(warnAbout(new PrismaClientKnownRequestError('Unique constraint failed'))).toBe(
        lineFor('otp', 'PrismaClientKnownRequestError P2002')
      )
    })

    it('should name the code of a library exception and nothing else', () => {
      expect(warnAbout(new NotificationException('INVALID_SCOPE_IDENTIFIER'))).toBe(
        lineFor('interceptor', 'notification.invalid_scope_identifier').replace(
          'interceptor',
          'otp'
        )
      )
    })
  })

  // No text the repository supplied reaches the line, whatever form it takes. A repository error
  // can quote the entry it rejected (the recipient, the user id) in any transformed form, so the
  // message is never printed: the line is the same for all of them.
  describe('no message text', () => {
    const recipient = 'jane@acme.com'
    const quoted: ReadonlyArray<readonly [string, string]> = [
      ['the address as it is', `Invalid recipient: ${recipient}`],
      ['the address in JSON', JSON.stringify({ to: 'a\\b@x.com' })],
      ['an HTML-escaped address', 'a&amp;amp;b@x.com'],
      ['a re-cased address', 'rejected JANE@ACME.COM'],
      ['a percent-encoded address', 'bad jane%40acme.com'],
      ['a full-width address', 'x ｊａｎｅ＠acme.com'],
      ['an IDN address', 'x jane@xn--bcher-kva.de'],
      ['the local part alone', 'mailbox jane unavailable'],
      ['the domain alone', 'domain acme.com refused'],
      ['a comma list without a space', 'jane@acme.com,maria@acme.com refused'],
      ['a semicolon list', 'jane@acme.com;maria@acme.com refused'],
      ['an address in angle brackets', 'Jane Doe <jane@acme.com> refused'],
      ['a user id split over lines', 'fk user\\n42 missing'],
      ['a re-cased user id', 'fk userabc123'],
      ['a normalised user id', 'x josé-1'],
      ['a long message', `${'m'.repeat(5000)}`],
      ['a message with control characters', 'a\\u001b[2Jb\\u0007c\\r\\nforged line']
    ]

    it.each(quoted)('should not print %s', (_label, message) => {
      expect(warnAbout(new Error(message))).toBe(lineFor('otp', 'Error'))
    })

    it.each(quoted)('should not print %s from a plain object', (_label, message) => {
      expect(warnAbout({ message })).toBe(lineFor('otp', 'Error'))
    })

    it.each(quoted)('should not print %s from a thrown string', (_label, message) => {
      expect(warnAbout(message)).toBe(lineFor('otp', 'Error'))
    })

    it('should not print the message of an error from another realm', () => {
      const foreign: unknown = vm.runInNewContext('new Error("jane@acme.com")')

      expect(warnAbout(foreign)).toBe(lineFor('otp', 'Error'))
    })
  })

  // A custom name or code is text the repository supplied too, so it is accepted only when it
  // is a short token; anything else becomes the generic name.
  describe('the name and the code', () => {
    const named = (name: unknown, code?: unknown): Error =>
      Object.assign(new Error('m'), { name }, code === undefined ? {} : { code })

    it.each([
      ['an address as the name', 'jane@acme.com'],
      ['a name with a space', 'Connection Error'],
      ['a name with a newline', 'Err\\nor'],
      ['a name of 65 characters', 'N'.repeat(65)],
      ['an empty name', ''],
      ['a non-string name', 42]
    ])('should replace %s by Error', (_label, name) => {
      expect(warnAbout(named(name))).toBe(lineFor('otp', 'Error'))
    })

    it('should accept a name of exactly 64 characters', () => {
      expect(warnAbout(named('N'.repeat(64)))).toBe(lineFor('otp', 'N'.repeat(64)))
    })

    it.each(['A', 'a-b_c.d:e', 'P2002', 'ECONNREFUSED'])(
      'should accept the token %s as a code',
      (code) => {
        expect(warnAbout(named('Error', code))).toBe(lineFor('otp', `Error ${code}`))
      }
    )

    it.each([
      ['an address as the code', 'jane@acme.com'],
      ['a code with a space', 'jane unavailable'],
      ['a code of 65 characters', 'C'.repeat(65)],
      ['an empty code', ''],
      ['a numeric code', 11000],
      ['an object as the code', { text: 'jane@acme.com' }]
    ])('should drop %s', (_label, code) => {
      expect(warnAbout(named('Error', code))).toBe(lineFor('otp', 'Error'))
    })

    it('should accept a code of exactly 64 characters', () => {
      expect(warnAbout(named('Error', 'C'.repeat(64)))).toBe(
        lineFor('otp', `Error ${'C'.repeat(64)}`)
      )
    })

    // A library code is trusted only when it is a short token as well.
    it('should not name a library code that carries text', () => {
      expect(warnAbout({ code: 'notification.jane@acme.com' })).toBe(lineFor('otp', 'Error'))
    })

    it('should not name a library code that is too long', () => {
      expect(warnAbout({ code: `notification.${'c'.repeat(60)}` })).toBe(lineFor('otp', 'Error'))
    })

    it('should name a library code', () => {
      expect(warnAbout({ code: 'notification.audit_log_failed' })).toBe(
        lineFor('otp', 'notification.audit_log_failed')
      )
    })

    it('should name a library code before the error class', () => {
      expect(warnAbout(named('TypeError', 'notification.template_not_found'))).toBe(
        lineFor('otp', 'notification.template_not_found')
      )
    })
  })

  // The error is consumer code: any value can be thrown, a getter can throw, and the warning must
  // never throw.
  describe('a hostile value', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['a number', 42],
      ['a symbol', Symbol('s')],
      ['an object with no prototype', Object.create(null) as unknown]
    ])('should describe %s as Error without throwing', (_label, error) => {
      expect(() => warnAbout(error)).not.toThrow()
      expect(warnAbout(error)).toBe(lineFor('otp', 'Error'))
    })

    it('should survive a name getter that throws', () => {
      const hostile = {
        get name(): string {
          throw new Error('getter')
        }
      }

      expect(warnAbout(hostile)).toBe(lineFor('otp', 'Error'))
    })

    it('should survive a code getter that throws', () => {
      const hostile = new Error('driver down')
      Object.defineProperty(hostile, 'code', {
        get: (): never => {
          throw new Error('getter')
        }
      })

      expect(warnAbout(hostile)).toBe(lineFor('otp', 'Error'))
    })

    it('should survive a Proxy whose traps throw', () => {
      const proxy = new Proxy(
        {},
        {
          get: (): never => {
            throw new Error('trap')
          }
        }
      )

      expect(warnAbout(proxy)).toBe(lineFor('otp', 'Error'))
    })

    it('should read each property once', () => {
      let reads = 0
      const flipping = {
        get name(): string {
          reads += 1
          return reads === 1 ? 'Fine' : 'jane@acme.com'
        }
      }

      expect(warnAbout(flipping)).toBe(lineFor('otp', 'Fine'))
    })
  })

  describe('the rate limit', () => {
    // An outage hits every operation, so repeats inside the interval are counted, not logged.
    it('should not log a repeat inside the interval and should count it', () => {
      const warning = new AuditWriteWarning(new Logger('Test'), 'email')

      warning.warn(new Error('down'))
      jest.advanceTimersByTime(AUDIT_WARNING_INTERVAL_MS - 1)
      warning.warn(new Error('down'))
      warning.warn(new Error('down'))

      expect(lines()).toHaveLength(1)
    })

    it('should log again when the interval has passed and report how many were suppressed', () => {
      const warning = new AuditWriteWarning(new Logger('Test'), 'email')
      warning.warn(new Error('down'))
      warning.warn(new Error('down'))
      warning.warn(new Error('down'))

      jest.advanceTimersByTime(AUDIT_WARNING_INTERVAL_MS)
      warning.warn(new Error('still down'))

      expect(lines()).toHaveLength(2)
      expect(lines()[1]).toBe(lineFor('email', 'Error; 2 similar since the last line'))
    })

    it('should start a new count after each line', () => {
      const warning = new AuditWriteWarning(new Logger('Test'), 'otp')
      warning.warn(new Error('a'))
      warning.warn(new Error('a'))
      jest.advanceTimersByTime(AUDIT_WARNING_INTERVAL_MS)
      warning.warn(new Error('b'))
      jest.advanceTimersByTime(AUDIT_WARNING_INTERVAL_MS)
      warning.warn(new Error('c'))

      expect(lines()[2]).toBe(lineFor('otp', 'Error'))
    })

    // Each channel has its own clock: one channel's line must not silence another's.
    it('should keep the interval per instance', () => {
      const otp = new AuditWriteWarning(new Logger('Test'), 'otp')
      const email = new AuditWriteWarning(new Logger('Test'), 'email')

      otp.warn(new Error('down'))
      email.warn(new Error('down'))

      expect(lines()).toHaveLength(2)
    })

    it('should use a sixty-second interval', () => {
      expect(AUDIT_WARNING_INTERVAL_MS).toBe(60_000)
    })

    // The wall clock can step backward (NTP, a resumed VM). A negative elapsed time must not
    // silence the warning until the clock catches up.
    it('should log again after the clock steps backward', () => {
      const warning = new AuditWriteWarning(new Logger('Test'), 'otp')
      warning.warn(new Error('a'))

      jest.setSystemTime(1_000_000 - 3_600_000)
      warning.warn(new Error('b'))

      expect(lines()).toHaveLength(2)
    })

    it('should log exactly at the interval', () => {
      const warning = new AuditWriteWarning(new Logger('Test'), 'otp')
      warning.warn(new Error('a'))

      jest.advanceTimersByTime(AUDIT_WARNING_INTERVAL_MS)
      warning.warn(new Error('b'))

      expect(lines()).toHaveLength(2)
    })
  })
})
