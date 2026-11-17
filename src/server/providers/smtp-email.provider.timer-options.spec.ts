/**
 * @fileoverview Holds every SMTP timeout to the range a timer can hold, at construction. The
 * connection, greeting and socket timeouts are handed to Nodemailer, which arms a timer with each:
 * a value past 2^31 - 1 ms fires at once, and a fraction, a negative or a string either fires at
 * once or is ignored, so a typo in one makes every send fail or hang against a healthy relay.
 * @layer infrastructure
 */

import { SmtpEmailProvider } from './smtp-email.provider'

const OPTIONS = ['sendTimeoutMs', 'connectionTimeout', 'greetingTimeout', 'socketTimeout'] as const

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
