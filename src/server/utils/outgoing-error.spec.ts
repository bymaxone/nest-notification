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

  it('should scrub a value from a library error whose body cannot be read', () => {
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

  it('should scrub a guess that appears only in the details a store put in its library error', () => {
    const error = new NotificationException(
      'OTP_STORAGE_FAILED',
      { providerName: 'store-123456' },
      { cause: new Error('backend quoted 123456') }
    )

    const out = outgoingError(error, ['123456'], true) as NotificationException

    expect(JSON.stringify(out.getResponse())).not.toContain('123456')
    expect((out.cause as Error).message).not.toContain('123456')
  })

  it('should scrub a guess that appears only in a message a store put in its library error', () => {
    const error = new NotificationException('OTP_STORAGE_FAILED', undefined, {
      message: 'store rejected 123456',
      cause: new Error('backend quoted 123456')
    })

    const out = outgoingError(error, ['123456'], true) as NotificationException

    expect(JSON.stringify(out.getResponse())).not.toContain('123456')
    expect((out.cause as Error).message).not.toContain('123456')
  })

  it("should keep a guess that is a stretch of the catalog's own message", () => {
    const error = new NotificationException('OTP_STORAGE_FAILED')

    const out = outgoingError(error, ['store'], true) as NotificationException

    expect(out.getResponse()).toStrictEqual(
      new NotificationException('OTP_STORAGE_FAILED').getResponse()
    )
  })

  it('should keep no message for a library error whose code is not in the catalog', () => {
    const error = new NotificationException('OTP_STORAGE_FAILED', undefined, {
      cause: new Error(`quoted ${VALUE}`)
    })
    Object.defineProperty(error, 'code', { value: 'notification.somewhere_else' })

    const out = outgoingError(error, [VALUE], true) as NotificationException

    expect((out.cause as Error).message).not.toContain(VALUE)
  })

  it('should scrub a value from a library error whose code cannot be read', () => {
    const error = new NotificationException('OTP_STORAGE_FAILED', undefined, {
      cause: new Error(`quoted ${VALUE}`)
    })
    Object.defineProperty(error, 'code', {
      get: () => {
        throw new Error('code getter of the host')
      }
    })

    const out = outgoingError(error, [VALUE], true) as NotificationException

    expect((out.cause as Error).message).not.toContain(VALUE)
  })

  it('should flatten a thrown string and remove the value', () => {
    expect(outgoingError(`bad ${VALUE}`, [VALUE])).toBe('bad [redacted]')
  })
})
