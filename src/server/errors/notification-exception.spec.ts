import { HttpStatus } from '@nestjs/common'

import { NOTIFICATION_ERROR_CODES } from '../../shared/constants/error-codes'

import {
  NOTIFICATION_ERROR_DEFINITIONS,
  NOTIFICATION_ERROR_CODES as RE_EXPORTED_ERROR_CODES,
  type NotificationErrorKey
} from './notification-error-codes'
import { NotificationException } from './notification-exception'

describe('NotificationException', () => {
  // The exception must surface the catalog code and HTTP status so the NestJS
  // exception filter responds with the right contract.
  it('should expose the code and HTTP status from the definition', () => {
    const exception = new NotificationException('OTP_INVALID_CODE')

    expect(exception.code).toBe(NOTIFICATION_ERROR_CODES.OTP_INVALID_CODE)
    expect(exception.getStatus()).toBe(HttpStatus.UNAUTHORIZED)
  })

  // Structured context handed in must land under `error.details` so callers can
  // read machine-readable failure data.
  it('should embed details in the response body shape', () => {
    const exception = new NotificationException('OTP_INVALID_LENGTH', { provided: 0, allowed: '1-32' })

    expect(exception.getResponse()).toEqual({
      error: {
        code: NOTIFICATION_ERROR_CODES.OTP_INVALID_LENGTH,
        message: 'Invalid OTP length config',
        details: { provided: 0, allowed: '1-32' }
      }
    })
  })

  // When no details are supplied, `error.details` must default to null rather
  // than be omitted — the shape is a stable contract.
  it('should default details to null when not provided', () => {
    const response = new NotificationException('EMAIL_SEND_FAILED').getResponse() as {
      error: { details: unknown }
    }

    expect(response.error.details).toBeNull()
  })

  // A caller may need a different status (e.g. 403 vs 401); the override must win.
  it('should allow overriding the HTTP status', () => {
    const exception = new NotificationException('OTP_INVALID_CODE', undefined, HttpStatus.FORBIDDEN)

    expect(exception.getStatus()).toBe(HttpStatus.FORBIDDEN)
  })

  // A caller may need a custom message; the override must replace the default.
  it('should allow overriding the message', () => {
    const exception = new NotificationException(
      'OTP_INVALID_CODE',
      undefined,
      undefined,
      'Custom message'
    )
    const response = exception.getResponse() as { error: { message: string } }

    expect(response.error.message).toBe('Custom message')
  })

  // Every catalog key must produce a well-formed exception — guards against a
  // definition with a missing code/status/message.
  it('should build a valid exception for every catalog key', () => {
    for (const key of Object.keys(NOTIFICATION_ERROR_DEFINITIONS) as NotificationErrorKey[]) {
      const exception = new NotificationException(key)
      const response = exception.getResponse() as { error: { code: string } }

      expect(response.error.code).toBe(NOTIFICATION_ERROR_DEFINITIONS[key].code)
      expect(typeof exception.getStatus()).toBe('number')
    }
  })

  // Defensive path: an untyped caller passing an unknown key must still get a
  // well-formed 500 envelope, never a raw TypeError.
  it('should fall back to a generic 500 for an unknown key', () => {
    const exception = new NotificationException('NOT_A_REAL_KEY' as NotificationErrorKey)
    const response = exception.getResponse() as { error: { code: string; message: string } }

    expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(response.error.code).toBe('notification.unknown_error')
    // Pin the fallback message string literal too.
    expect(response.error.message).toBe('Unknown notification error')
  })
})

describe('NOTIFICATION_ERROR_DEFINITIONS', () => {
  // The server catalog and the shared code list are intentionally duplicated;
  // they must stay byte-for-byte identical so a frontend matching on a shared
  // code always finds the server's response code.
  it('should match the shared NOTIFICATION_ERROR_CODES byte-for-byte', () => {
    const serverCodes = Object.values(NOTIFICATION_ERROR_DEFINITIONS)
      .map((definition) => definition.code)
      .sort()
    const sharedCodes = Object.values(NOTIFICATION_ERROR_CODES).sort()

    expect(serverCodes).toEqual(sharedCodes)
  })

  // The catalog module re-exports the shared codes for convenience; that
  // re-export must point at the exact same object the shared subpath publishes.
  it('should re-export the shared NOTIFICATION_ERROR_CODES unchanged', () => {
    expect(RE_EXPORTED_ERROR_CODES).toBe(NOTIFICATION_ERROR_CODES)
  })
})
