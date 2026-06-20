import { DEFAULT_TTLS } from './default-ttls'
import { NOTIFICATION_ERROR_CODES } from './error-codes'

describe('NOTIFICATION_ERROR_CODES', () => {
  // The catalog is a fixed public contract; a count drift means a code was
  // added/removed without updating the server definitions or this gate.
  it('should declare exactly 21 error codes', () => {
    expect(Object.keys(NOTIFICATION_ERROR_CODES)).toHaveLength(21)
  })

  // Every value must be namespaced under `notification.` so consumer code can
  // safely route any notification error by prefix without collisions.
  it('should namespace every code under "notification."', () => {
    for (const code of Object.values(NOTIFICATION_ERROR_CODES)) {
      expect(code).toMatch(/^notification\.[a-z_]+$/)
    }
  })

  // Codes are used as map keys and switch discriminants; duplicates would make
  // two symbolic names collapse to one runtime value.
  it('should have unique code values', () => {
    const values = Object.values(NOTIFICATION_ERROR_CODES)
    expect(new Set(values).size).toBe(values.length)
  })

  // This code is the one added specifically for "OTP email delivery requested
  // but the email channel is not configured" — it must be present.
  it('should include OTP_EMAIL_DELIVERY_NOT_CONFIGURED', () => {
    expect(NOTIFICATION_ERROR_CODES.OTP_EMAIL_DELIVERY_NOT_CONFIGURED).toBe(
      'notification.otp_email_delivery_not_configured'
    )
  })
})

describe('DEFAULT_TTLS', () => {
  // The recommended TTLs are documented constants; each must stay a positive
  // integer number of seconds so it can be used directly as a Redis EX value.
  it('should expose positive integer second values', () => {
    for (const ttl of Object.values(DEFAULT_TTLS)) {
      expect(Number.isInteger(ttl)).toBe(true)
      expect(ttl).toBeGreaterThan(0)
    }
  })

  // Spot-check the headline values that callers rely on (email verification 1h,
  // resend cooldown 60s) to catch an accidental edit of the rationale table.
  it('should keep the documented headline TTLs', () => {
    expect(DEFAULT_TTLS.OTP_EMAIL_VERIFICATION_SECONDS).toBe(3600)
    expect(DEFAULT_TTLS.RESEND_COOLDOWN_SECONDS).toBe(60)
  })
})
