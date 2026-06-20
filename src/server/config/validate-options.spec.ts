import { NotificationException } from '../errors/notification-exception'
import type {
  BymaxNotificationModuleOptions,
  IEmailProvider,
  INotificationLogRepository,
  IOtpStorage
} from '../interfaces'

import { validateOptions } from './validate-options'

const emailProvider = {} as IEmailProvider
const otpStorage = {} as IOtpStorage
const auditRepository = {} as INotificationLogRepository

const validEmail = { provider: emailProvider, defaultFrom: 'noreply@example.com' }

describe('validateOptions', () => {
  // The happy path: a minimal email-only config must pass without throwing.
  it('should accept minimal email-only options', () => {
    expect(() => validateOptions({ email: validEmail })).not.toThrow()
  })

  // A fully-specified OTP config exercises the "provided and valid" branch of
  // every optional OTP check at once.
  it('should accept a fully specified valid configuration', () => {
    const options: BymaxNotificationModuleOptions = {
      email: { ...validEmail, defaultFromName: 'App' },
      otp: {
        storage: otpStorage,
        defaultLength: 6,
        defaultCodeType: 'alphanumeric',
        defaultTtlSeconds: 600,
        defaultMaxAttempts: 5,
        resendCooldownSeconds: 0
      },
      audit: { repository: auditRepository }
    }
    expect(() => validateOptions(options)).not.toThrow()
  })

  // At least one delivery channel is mandatory; an empty config is a programmer error.
  it('should reject options with no channels', () => {
    expect(() => validateOptions({})).toThrow('At least one channel must be configured')
  })

  // Email needs a provider to send through.
  it('should reject an email config missing provider', () => {
    expect(() => validateOptions({ email: { defaultFrom: 'a@b.com' } as never })).toThrow(
      'options.email.provider is required'
    )
  })

  // Email needs a non-empty from address.
  it('should reject an email config with a blank defaultFrom', () => {
    expect(() =>
      validateOptions({ email: { provider: emailProvider, defaultFrom: '   ' } })
    ).toThrow('options.email.defaultFrom must be a non-empty string')
  })

  // A from address without "@" is almost certainly a misconfiguration.
  it('should reject an email config with a malformed defaultFrom', () => {
    expect(() =>
      validateOptions({ email: { provider: emailProvider, defaultFrom: 'noreply' } })
    ).toThrow('does not look like an email')
  })

  // OTP needs a storage backend.
  it('should reject an otp config missing storage', () => {
    expect(() => validateOptions({ otp: {} as never })).toThrow('options.otp.storage is required')
  })

  // A non-integer length is invalid and must raise the typed OTP_INVALID_LENGTH error.
  it('should reject a non-integer otp defaultLength with NotificationException', () => {
    expect(() => validateOptions({ otp: { storage: otpStorage, defaultLength: 6.5 } })).toThrow(
      NotificationException
    )
  })

  // Length below the minimum is rejected.
  it('should reject an otp defaultLength below 1', () => {
    expect(() => validateOptions({ otp: { storage: otpStorage, defaultLength: 0 } })).toThrow(
      NotificationException
    )
  })

  // Length above the maximum is rejected.
  it('should reject an otp defaultLength above 32', () => {
    expect(() => validateOptions({ otp: { storage: otpStorage, defaultLength: 33 } })).toThrow(
      NotificationException
    )
  })

  // Only the three documented charsets are valid.
  it('should reject an invalid otp defaultCodeType', () => {
    expect(() =>
      validateOptions({ otp: { storage: otpStorage, defaultCodeType: 'binary' as never } })
    ).toThrow('options.otp.defaultCodeType must be one of')
  })

  // A non-positive TTL would expire instantly.
  it('should reject an otp defaultTtlSeconds of zero or less', () => {
    expect(() => validateOptions({ otp: { storage: otpStorage, defaultTtlSeconds: 0 } })).toThrow(
      'defaultTtlSeconds must be greater than 0'
    )
  })

  // Fewer than one attempt would lock every user out immediately.
  it('should reject an otp defaultMaxAttempts below 1', () => {
    expect(() => validateOptions({ otp: { storage: otpStorage, defaultMaxAttempts: 0 } })).toThrow(
      'defaultMaxAttempts must be at least 1'
    )
  })

  // A negative cooldown is meaningless.
  it('should reject a negative otp resendCooldownSeconds', () => {
    expect(() =>
      validateOptions({ otp: { storage: otpStorage, resendCooldownSeconds: -1 } })
    ).toThrow('resendCooldownSeconds must be 0 or greater')
  })

  // SMS is declared but not implemented in v0.1 — running with it would silently fail.
  it('should reject an sms channel in v0.1', () => {
    expect(() => validateOptions({ sms: { provider: {} as never } })).toThrow(
      'SMS channel is not yet implemented'
    )
  })

  // Push is declared but not implemented in v0.1.
  it('should reject a push channel in v0.1', () => {
    expect(() => validateOptions({ push: { provider: {} as never } })).toThrow(
      'Push channel is not yet implemented'
    )
  })

  // Audit, when present, needs a repository to write to.
  it('should reject an audit config missing repository', () => {
    expect(() => validateOptions({ email: validEmail, audit: {} as never })).toThrow(
      'options.audit.repository is required'
    )
  })
})
