import { NotificationException } from '../errors/notification-exception'

import { generateOtpCode } from './code-generator'

describe('generateOtpCode', () => {
  // A numeric code of the requested length must be exactly that many digits.
  it('should generate a numeric code of the requested length', () => {
    expect(generateOtpCode(6, 'numeric')).toMatch(/^\d{6}$/)
  })

  // Leading zeros must survive: per-digit generation never collapses a code like
  // "001234" to a shorter integer. Property-checked across many iterations.
  it('should preserve leading zeros across 1000 iterations', () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateOtpCode(6, 'numeric')).toHaveLength(6)
    }
  })

  // Regression for the `10 ** length` overflow: a 20-digit numeric code must
  // generate without throwing and stay exactly 20 digits.
  it('should generate a 20-digit numeric code without throwing', () => {
    const code = generateOtpCode(20, 'numeric')

    expect(code).toMatch(/^\d{20}$/)
  })

  // The alpha charset excludes the ambiguous I and O for legibility.
  it('should never include I or O in an alpha code', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtpCode(8, 'alpha')).not.toMatch(/[IO]/)
    }
  })

  // The alphanumeric charset excludes 0, 1, I, and O.
  it('should never include 0, 1, I, or O in an alphanumeric code', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtpCode(10, 'alphanumeric')).not.toMatch(/[01IO]/)
    }
  })

  // A non-integer length is invalid configuration.
  it('should throw OTP_INVALID_LENGTH for a non-integer length', () => {
    expect(() => generateOtpCode(6.5, 'numeric')).toThrow(NotificationException)
  })

  // Length below the minimum is rejected.
  it('should throw OTP_INVALID_LENGTH for length below 1', () => {
    expect(() => generateOtpCode(0, 'numeric')).toThrow(NotificationException)
  })

  // Length above the maximum is rejected.
  it('should throw OTP_INVALID_LENGTH for length above 32', () => {
    expect(() => generateOtpCode(33, 'numeric')).toThrow(NotificationException)
  })

  // Entropy sanity check: 1000 six-digit codes should be overwhelmingly unique
  // (a weak generator would repeat far more often than the birthday bound allows).
  it('should produce high-entropy codes', () => {
    const codes = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      codes.add(generateOtpCode(6, 'numeric'))
    }

    expect(codes.size).toBeGreaterThanOrEqual(995)
  })
})
