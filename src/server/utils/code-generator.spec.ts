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

  // The alpha charset is letters only — no digits. This pins the `type === 'alpha'`
  // branch: if it fell through to the alphanumeric charset, digits (2-9) would appear.
  it('should never include a digit in an alpha code', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtpCode(12, 'alpha')).toMatch(/^[A-Z]{12}$/)
    }
  })

  // The alphanumeric charset excludes 0, 1, I, and O.
  it('should never include 0, 1, I, or O in an alphanumeric code', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateOtpCode(10, 'alphanumeric')).not.toMatch(/[01IO]/)
    }
  })

  // The alphanumeric charset DOES include digits (2-9). This pins the `type === 'alpha'`
  // branch: if it returned the alpha (letters-only) charset for alphanumeric, no code
  // would ever contain a digit across many long samples.
  it('should include at least one digit across many alphanumeric codes', () => {
    let sawDigit = false
    for (let i = 0; i < 200 && !sawDigit; i++) {
      if (/[2-9]/.test(generateOtpCode(16, 'alphanumeric'))) {
        sawDigit = true
      }
    }
    expect(sawDigit).toBe(true)
  })

  // A non-integer length is invalid configuration.
  it('should throw OTP_INVALID_LENGTH for a non-integer length', () => {
    expect(() => generateOtpCode(6.5, 'numeric')).toThrow(NotificationException)
  })

  // Length below the minimum is rejected.
  it('should throw OTP_INVALID_LENGTH for length below 1', () => {
    expect(() => generateOtpCode(0, 'numeric')).toThrow(NotificationException)
  })

  // The minimum length (1) is accepted — pins the `< MIN_LENGTH` boundary so a
  // `<= MIN_LENGTH` mutant (which would reject length 1) is caught.
  it('should accept the minimum length of 1', () => {
    expect(generateOtpCode(1, 'numeric')).toMatch(/^\d$/)
  })

  // Length above the maximum is rejected.
  it('should throw OTP_INVALID_LENGTH for length above 32', () => {
    expect(() => generateOtpCode(33, 'numeric')).toThrow(NotificationException)
  })

  // The maximum length (32) is accepted — pins the `> MAX_LENGTH` boundary so a
  // `>= MAX_LENGTH` mutant (which would reject length 32) is caught.
  it('should accept the maximum length of 32', () => {
    expect(generateOtpCode(32, 'numeric')).toMatch(/^\d{32}$/)
  })

  // The invalid-length exception carries the offending value and allowed range in
  // its details — pins the `{ provided, allowed }` object and the range string.
  it('should include provided length and allowed range in the exception details', () => {
    try {
      generateOtpCode(99, 'numeric')
      throw new Error('expected generateOtpCode to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationException)
      const response = (error as NotificationException).getResponse() as {
        error: { details: { provided: number; allowed: string } }
      }
      expect(response.error.details.provided).toBe(99)
      expect(response.error.details.allowed).toBe('1-32')
    }
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
