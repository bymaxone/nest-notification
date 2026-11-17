/**
 * @fileoverview Holds every SMTP timeout to the range a timer can hold, at construction. The
 * connection, greeting and socket timeouts are handed to Nodemailer, which arms a timer with each:
 * a value outside that range, or one that is not a number, can fire the timer at once or leave the
 * phase unbounded, so a typo in one can make every send fail or hang against a healthy relay.
 * @layer infrastructure
 */

import { SmtpEmailProvider } from './smtp-email.provider'

const OPTIONS = ['sendTimeoutMs', 'connectionTimeout', 'greetingTimeout', 'socketTimeout'] as const

describe('SmtpEmailProvider port', () => {
  it.each([1, 25, 465, 587, 65_535])('should accept %p', (port) => {
    expect(() => new SmtpEmailProvider({ host: 'h', port })).not.toThrow()
  })

  it.each([0, -1, 65_536, 70_000, 587.5, NaN, Infinity, '587', null, true])(
    'should refuse %p',
    (port) => {
      expect(() => new SmtpEmailProvider({ host: 'h', port: port as never })).toThrow(
        'SmtpEmailProvider: port must be an integer from 1 to 65535'
      )
    }
  )
})

describe('SmtpEmailProvider timer options', () => {
  describe.each(OPTIONS)('%s', (option) => {
    it.each([1, 10_000, 2_147_483_647])('should accept %p', (value) => {
      expect(() => new SmtpEmailProvider({ host: 'h', [option]: value })).not.toThrow()
    })

    it('should accept an absent option', () => {
      expect(() => new SmtpEmailProvider({ host: 'h' })).not.toThrow()
    })

    it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648, 3_000_000_000, '10s', '5000', null, true])(
      'should refuse %p',
      (value) => {
        expect(() => new SmtpEmailProvider({ host: 'h', [option]: value as never })).toThrow(
          `SmtpEmailProvider: ${option} must be a positive integer of at most 2147483647`
        )
      }
    )
  })
})
