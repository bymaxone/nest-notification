import type {
  IEmailProvider,
  INotificationLogRepository,
  IOtpStorage
} from '../interfaces'

import { resolveOptions } from './resolved-options'

const emailProvider = {} as IEmailProvider
const otpStorage = {} as IOtpStorage
const auditRepository = {} as INotificationLogRepository
const validEmail = { provider: emailProvider, defaultFrom: 'noreply@example.com' }

describe('resolveOptions', () => {
  // With no global section the resolver must seed the documented namespace and
  // locale and leave the tenant resolver unset.
  it('should apply global defaults and omit an unset tenant resolver', () => {
    const resolved = resolveOptions({ email: validEmail })

    expect(resolved.global.redisNamespace).toBe('notification')
    expect(resolved.global.defaultLocale).toBe('en')
    expect(resolved.global.tenantIdResolver).toBeUndefined()
  })

  // Consumer global overrides — including a tenant resolver — must be preserved.
  it('should preserve global overrides including the tenant resolver', () => {
    const tenantIdResolver = (): string => 'tenant-a'
    const resolved = resolveOptions({
      email: validEmail,
      global: { redisNamespace: 'custom', defaultLocale: 'pt-BR', tenantIdResolver }
    })

    expect(resolved.global.redisNamespace).toBe('custom')
    expect(resolved.global.defaultLocale).toBe('pt-BR')
    expect(resolved.global.tenantIdResolver).toBe(tenantIdResolver)
  })

  // Channels the consumer did not configure must be absent so `if (resolved.otp)`
  // narrows correctly downstream.
  it('should omit channel sections that were not configured', () => {
    const resolved = resolveOptions({ email: validEmail })

    expect(resolved.otp).toBeUndefined()
  })

  it('should omit the email section when only otp is configured', () => {
    const resolved = resolveOptions({ otp: { storage: otpStorage } })

    expect(resolved.email).toBeUndefined()
  })

  // Email defaults: empty tags and the 10 MiB attachment ceiling; optional name
  // and reply-to stay absent when not supplied.
  it('should apply email defaults and omit unset optional fields', () => {
    const resolved = resolveOptions({ email: validEmail })

    expect(resolved.email).toEqual({
      defaultFrom: 'noreply@example.com',
      defaultTags: [],
      maxAttachmentBytes: 10_485_760
    })
  })

  // Email overrides for name, reply-to, tags, and attachment ceiling must pass through.
  it('should preserve email overrides', () => {
    const resolved = resolveOptions({
      email: {
        ...validEmail,
        defaultFromName: 'App',
        defaultReplyTo: 'reply@example.com',
        defaultTags: [{ name: 'env', value: 'test' }],
        maxAttachmentBytes: 1024
      }
    })

    expect(resolved.email).toEqual({
      defaultFrom: 'noreply@example.com',
      defaultFromName: 'App',
      defaultReplyTo: 'reply@example.com',
      defaultTags: [{ name: 'env', value: 'test' }],
      maxAttachmentBytes: 1024
    })
  })

  // OTP defaults must match the documented values, with consumeOnVerify false.
  it('should apply OTP defaults', () => {
    const resolved = resolveOptions({ otp: { storage: otpStorage } })

    expect(resolved.otp).toMatchObject({
      defaultLength: 6,
      defaultCodeType: 'numeric',
      defaultTtlSeconds: 600,
      defaultMaxAttempts: 5,
      resendCooldownSeconds: 60,
      consumeOnVerify: false,
      perPurpose: {}
    })
  })

  // A per-purpose override must be merged over the OTP defaults into a complete
  // config, and `resolveForPurpose` must return it for the known purpose.
  it('should resolve per-purpose overrides over the OTP defaults', () => {
    const resolved = resolveOptions({
      otp: { storage: otpStorage, perPurpose: { email_verification: { ttlSeconds: 3600 } } }
    })

    expect(resolved.otp?.perPurpose['email_verification']).toEqual({
      length: 6,
      codeType: 'numeric',
      ttlSeconds: 3600,
      maxAttempts: 5,
      resendCooldownSeconds: 60
    })
    expect(resolved.otp?.resolveForPurpose('email_verification').ttlSeconds).toBe(3600)
  })

  // For a purpose with no override, `resolveForPurpose` must fall back to the
  // plain OTP defaults.
  it('should fall back to OTP defaults for an unknown purpose', () => {
    const resolved = resolveOptions({ otp: { storage: otpStorage } })

    expect(resolved.otp?.resolveForPurpose('unknown')).toEqual({
      length: 6,
      codeType: 'numeric',
      ttlSeconds: 600,
      maxAttempts: 5,
      resendCooldownSeconds: 60
    })
  })

  // Audit is always present; with no audit config it defaults to swallowing
  // errors and an identity recipient mask.
  it('should always resolve an audit section with defaults', () => {
    const resolved = resolveOptions({ email: validEmail })

    expect(resolved.audit.swallowErrors).toBe(true)
    expect(resolved.audit.maskRecipient('jane@acme.com')).toBe('jane@acme.com')
  })

  // Audit overrides — a recipient mask and swallowErrors=false — must pass through.
  it('should preserve audit overrides', () => {
    const maskRecipient = (recipient: string): string => `***${recipient.slice(-4)}`
    const resolved = resolveOptions({
      email: validEmail,
      audit: { repository: auditRepository, swallowErrors: false, maskRecipient }
    })

    expect(resolved.audit.swallowErrors).toBe(false)
    expect(resolved.audit.maskRecipient('jane@acme.com')).toBe('***.com')
  })

  // The resolved object must be deeply frozen so a service cannot mutate shared
  // config at runtime (strict mode turns the write into a TypeError).
  it('should deep-freeze the resolved options', () => {
    const resolved = resolveOptions({
      email: validEmail,
      otp: { storage: otpStorage, perPurpose: { mfa_oob: { length: 8 } } }
    })

    expect(() => {
      ;(resolved as { global: { redisNamespace: string } }).global.redisNamespace = 'x'
    }).toThrow(TypeError)
    expect(Object.isFrozen(resolved.otp?.perPurpose['mfa_oob'])).toBe(true)
  })
})
