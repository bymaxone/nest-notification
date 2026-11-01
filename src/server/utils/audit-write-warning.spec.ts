/**
 * @fileoverview Specifies the warning logged when an audit write fails and is swallowed: the
 * exact line, that the first failure always logs, that repeats inside the interval are counted
 * instead of logged, and that a hostile error value never throws.
 * @layer utils
 */
import { Logger } from '@nestjs/common'
import * as vm from 'node:vm'

import { NotificationException } from '../errors/notification-exception'

import { AUDIT_WARNING_INTERVAL_MS, AuditWriteWarning } from './audit-write-warning'

const CODE = 'BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED'

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

  // The line a host reads when its audit store is down. Pinned by value.
  it('should log the documented line for the first failure', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'otp')

    warning.warn(new Error('store down'))

    expect(lines()).toEqual([
      `[${CODE}] An audit entry could not be written by the otp channel (store down); ` +
        "the operation's result is unaffected because audit.swallowErrors is true."
    ])
  })

  it('should name the channel that failed', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'interceptor')

    warning.warn(new Error('x'))

    expect(lines()[0]).toContain('written by the interceptor channel (x)')
  })

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
    expect(lines()[1]).toBe(
      `[${CODE}] An audit entry could not be written by the email channel ` +
        '(still down; 2 similar since the last line); ' +
        "the operation's result is unaffected because audit.swallowErrors is true."
    )
  })

  it('should start a new count after each line', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'otp')
    warning.warn(new Error('a'))
    warning.warn(new Error('a'))
    jest.advanceTimersByTime(AUDIT_WARNING_INTERVAL_MS)
    warning.warn(new Error('b'))
    jest.advanceTimersByTime(AUDIT_WARNING_INTERVAL_MS)
    warning.warn(new Error('c'))

    expect(lines()[2]).toContain('(c)')
    expect(lines()[2]).not.toContain('similar')
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

  // A repository's error can quote the entry it failed to write, over many lines and at any
  // length. The line stays one line and bounded, so it cannot flood or forge log lines.
  it('should log one line of bounded length for a long multi-line error', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'otp')

    warning.warn(new Error(`Invalid create():\n  recipient: 'j***@acme.com'\n${'x'.repeat(2000)}`))

    const line = lines()[0] ?? ''
    expect(line).not.toContain('\n')
    expect(line).toContain("(Invalid create(): recipient: 'j***@acme.com' xxx")
    expect(line).toContain('…)')
    expect(line.length).toBeLessThan(500)
  })

  it('should leave a short error as it is', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'otp')

    warning.warn(new Error('x'.repeat(200)))

    expect(lines()[0]).toContain(`(${'x'.repeat(200)})`)
  })

  it('should cut an error one character over the limit', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'otp')

    warning.warn(new Error('y'.repeat(201)))

    expect(lines()[0]).toContain(`(${'y'.repeat(200)}…)`)
  })

  // The wall clock can step backward (NTP, a resumed VM). A negative elapsed time must not
  // silence the warning until the clock catches up.
  it('should log again after the clock steps backward', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'otp')
    warning.warn(new Error('a'))

    jest.setSystemTime(1_000_000 - 3_600_000)
    warning.warn(new Error('b'))

    expect(lines()).toHaveLength(2)
    expect(lines()[1]).toContain('(b)')
  })

  // Every reason reaches the line through the same bound, whichever path produced it: the
  // library's code, the error's message, or the string form of a value. The code is a property
  // of whatever the repository threw, so nothing makes it a short catalog string.
  describe('the bound on a reason', () => {
    const reasonOfLine = (): string => {
      const line = lines()[0] ?? ''
      return line.slice(line.indexOf('channel (') + 'channel ('.length, line.indexOf('); the'))
    }
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ['the message of an Error', new Error('m'.repeat(500))],
      ['a string value', 's'.repeat(500)],
      ['a plain { message } object', { message: 'p'.repeat(500) }],
      ['a library code', { code: `notification.${'c'.repeat(500)}` }]
    ]

    it.each(cases)('should cut %s at 200 characters', (_label, error) => {
      new AuditWriteWarning(new Logger('Test'), 'otp').warn(error)

      expect(reasonOfLine()).toHaveLength(201)
      expect(reasonOfLine().endsWith('…')).toBe(true)
    })

    it.each([
      ['the message of an Error', new Error('a\nb\r\nc\u2028d')],
      ['a library code', { code: 'notification.a\nb' }]
    ])('should keep %s on one line', (_label, error) => {
      new AuditWriteWarning(new Logger('Test'), 'otp').warn(error)

      expect(lines()[0]).not.toMatch(/[\n\r\u2028\u2029]/)
    })

    // A terminal escape in a repository error must not reach a terminal through the log.
    it.each([
      ['the message of an Error', new Error('a\u001b[2Jb\u0007c')],
      ['a library code', { code: 'notification.a\u001b[2Jb' }]
    ])('should replace control characters in %s', (_label, error) => {
      new AuditWriteWarning(new Logger('Test'), 'otp').warn(error)

      expect(lines()[0]).not.toMatch(/\p{Cc}/u)
    })

    // The cut counts code units; it must not leave half of an astral character before the dots.
    it('should not cut inside a surrogate pair', () => {
      new AuditWriteWarning(new Logger('Test'), 'otp').warn(new Error(`${'x'.repeat(199)}😀tail`))

      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(reasonOfLine())).toBe(false)
      expect(reasonOfLine()).toBe(`${'x'.repeat(199)}…`)
    })
  })

  // A NotificationException's message is only its class label; its code is what tells an
  // operator what was refused, so the line carries the code.
  it('should name the code of a NotificationException instead of its class label', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'interceptor')

    warning.warn(new NotificationException('INVALID_SCOPE_IDENTIFIER'))

    expect(lines()[0]).toContain('(notification.invalid_scope_identifier)')
    expect(lines()[0]).not.toContain('Notification Exception')
  })

  it('should fall back to the message when the code cannot be read', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'otp')
    const hostile = new Error('driver down')
    Object.defineProperty(hostile, 'code', {
      get: (): never => {
        throw new Error('getter')
      }
    })

    expect(() => warning.warn(hostile)).not.toThrow()

    expect(lines()[0]).toContain('(driver down)')
  })

  // Only the library's own codes are named; a driver's code (ECONNREFUSED) says less than its text.
  it('should keep the message of an error whose code is not one of the library', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'otp')
    const driver = Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), {
      code: 'ECONNREFUSED'
    })

    warning.warn(driver)

    expect(lines()[0]).toContain('(connect ECONNREFUSED 10.0.0.1:5432)')
  })

  // The error is consumer code: it can be anything, and the warning must never throw.
  it.each([
    ['a string', 'plain text', 'plain text'],
    ['a plain { message } object', { message: 'from a driver' }, 'from a driver'],
    [
      'an Error from another realm',
      vm.runInNewContext('new Error("foreign")') as unknown,
      'foreign'
    ],
    ['an object with no prototype', Object.create(null) as unknown, 'unprintable error'],
    ['undefined', undefined, 'undefined']
  ])('should describe %s without throwing', (_label, error, reason) => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'otp')

    expect(() => warning.warn(error)).not.toThrow()

    expect(lines()[0]).toContain(`(${reason})`)
  })
})
