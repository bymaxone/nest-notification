import {
  DEFAULT_AUDIT_OPTIONS,
  DEFAULT_EMAIL_OPTIONS,
  DEFAULT_GLOBAL_OPTIONS,
  DEFAULT_MAX_ATTACHMENT_BYTES,
  DEFAULT_OTP_OPTIONS
} from './default-options.constants'

describe('default option constants', () => {
  // Global defaults seed the always-present resolved section; the namespace and
  // locale must be the documented values.
  it('should default the global namespace and locale', () => {
    expect(DEFAULT_GLOBAL_OPTIONS).toEqual({ redisNamespace: 'notification', defaultLocale: 'en' })
  })

  // OTP defaults gate code length, attempts, and the consume-on-verify behavior;
  // consumeOnVerify must default to false so callers consume explicitly.
  it('should carry the OTP defaults including consumeOnVerify=false', () => {
    expect(DEFAULT_OTP_OPTIONS.defaultLength).toBe(6)
    expect(DEFAULT_OTP_OPTIONS.defaultCodeType).toBe('numeric')
    expect(DEFAULT_OTP_OPTIONS.defaultTtlSeconds).toBe(600)
    expect(DEFAULT_OTP_OPTIONS.defaultMaxAttempts).toBe(5)
    expect(DEFAULT_OTP_OPTIONS.resendCooldownSeconds).toBe(60)
    expect(DEFAULT_OTP_OPTIONS.consumeOnVerify).toBe(false)
    expect(DEFAULT_OTP_OPTIONS.perPurpose).toEqual({})
  })

  // The email default attachment ceiling protects providers from oversized
  // payloads; it must be 10 MiB.
  it('should default the email attachment ceiling to 10 MiB', () => {
    expect(DEFAULT_MAX_ATTACHMENT_BYTES).toBe(10_485_760)
    expect(DEFAULT_EMAIL_OPTIONS.maxAttachmentBytes).toBe(10_485_760)
    expect(DEFAULT_EMAIL_OPTIONS.defaultTags).toEqual([])
  })

  // Audit writes are fire-and-forget by default so a failing audit sink never
  // breaks the primary notification flow.
  it('should default audit swallowErrors to true', () => {
    expect(DEFAULT_AUDIT_OPTIONS.swallowErrors).toBe(true)
  })
})
