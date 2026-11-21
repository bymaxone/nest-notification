/**
 * @fileoverview Holds `outgoingError` to removing a value from what it is given, and to leaving the
 * library's own words in a library error when it is asked to.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'
import { outgoingError } from './outgoing-error'

// A value that no code or message of the library contains, so it can only be scrubbed or kept by the rule.
const VALUE = 'Stryker was here!'

describe('outgoingError', () => {
  it('should scrub a value from a library error when it is not asked to keep the library words', () => {
    const error = new NotificationException('OTP_STORAGE_FAILED', undefined, {
      cause: new Error(`echo ${VALUE}`)
    })

    const out = outgoingError(error, [VALUE]) as NotificationException

    expect((out.cause as Error).message).not.toContain(VALUE)
  })

  it("should scrub a value that is not the library error's own text when it is asked to keep it", () => {
    const error = new NotificationException('OTP_STORAGE_FAILED', undefined, {
      cause: new Error(`echo ${VALUE}`)
    })

    const out = outgoingError(error, [VALUE], true) as NotificationException

    expect((out.cause as Error).message).not.toContain(VALUE)
  })

  it('should scrub a value from a library error whose body cannot be read, keeping the rest', () => {
    const error = new NotificationException('OTP_STORAGE_FAILED', undefined, {
      cause: new Error(`echo ${VALUE}`)
    })
    error.getResponse = () => {
      throw new Error('getResponse of the host')
    }

    const out = outgoingError(error, [VALUE], true) as NotificationException

    expect((out.cause as Error).message).not.toContain(VALUE)
  })

  it("should keep a value that is a stretch of the library error's own code", () => {
    const error = new NotificationException('OTP_STORAGE_FAILED')

    const out = outgoingError(error, ['otp'], true) as NotificationException

    expect(out.code).toBe('notification.otp_storage_failed')
  })

  it('should flatten a thrown string and remove the value', () => {
    expect(outgoingError(`bad ${VALUE}`, [VALUE])).toBe('bad [redacted]')
  })
})
