import { resolveOptions } from '../config/resolved-options'
import type { ResolvedNotificationOptions } from '../config/resolved-options'
import type {
  AuditOptions,
  OtpChannelOptions
} from '../interfaces/notification-module-options.interface'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import type { EmailService } from './email.service'
import { OtpService } from './otp.service'

const dummyRepo = { name: 'x', create: async (): Promise<void> => undefined } as INotificationLogRepository

const makeOptions = (
  otp: Partial<OtpChannelOptions> | null = {},
  audit: Partial<AuditOptions> = {}
): ResolvedNotificationOptions =>
  resolveOptions({
    ...(otp ? { otp: { storage: InMemoryOtpStorage, ...otp } } : {}),
    audit: { repository: dummyRepo, ...audit }
  })

const makeAudit = (): jest.Mocked<INotificationLogRepository> => ({
  name: 'audit',
  create: jest.fn(async (_entry: NotificationLogEntry): Promise<void> => undefined)
})

const emailSendTemplate = jest.fn()
const emailServiceStub = { sendTemplate: emailSendTemplate } as unknown as EmailService

const ref = { tenantId: 'tenant_a', recipient: 'jane@acme.com', purpose: 'email_verification' }

describe('OtpService.generate', () => {
  let storage: InMemoryOtpStorage
  let audit: jest.Mocked<INotificationLogRepository>

  beforeEach(() => {
    storage = new InMemoryOtpStorage()
    audit = makeAudit()
    emailSendTemplate.mockResolvedValue({ messageId: 'm1' })
  })

  // The cooldown must be claimed atomically BEFORE the OTP is persisted.
  it('should claim the cooldown before persisting and return expiry + cooldown', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    const acquireSpy = jest.spyOn(storage, 'tryAcquireCooldown')
    const setSpy = jest.spyOn(storage, 'set')

    const result = await service.generate({ ...ref, deliverVia: 'manual' })

    expect(setSpy.mock.invocationCallOrder[0]).toBeGreaterThan(
      acquireSpy.mock.invocationCallOrder[0] as number
    )
    expect(result.cooldownSeconds).toBe(60)
    expect((await storage.get(ref.tenantId, ref.recipient, ref.purpose))?.attempts).toBe(0)
  })

  // A second generate inside the cooldown window is rejected with retry hints.
  it('should throw OTP_COOLDOWN_ACTIVE on a second call in the window', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await service.generate({ ...ref, deliverVia: 'manual' })

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).rejects.toMatchObject({
      code: 'notification.otp_cooldown_active'
    })
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ verb: 'cooldown_blocked' }))
  })

  // Email delivery renders the otp_code template with the auto-injected data.
  it('should deliver via email with auto-injected code/expiresInMinutes/purpose', async () => {
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    await service.generate({ ...ref, deliverVia: 'email', emailData: { name: 'Jane' }, locale: 'en', userId: 'u1' })

    expect(emailSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'otp_code',
        locale: 'en',
        userId: 'u1',
        data: expect.objectContaining({ name: 'Jane', expiresInMinutes: 10, purpose: 'email_verification' })
      })
    )
    const code = emailSendTemplate.mock.calls[0]?.[0].data.code
    expect(code).toMatch(/^\d{6}$/)
  })

  // With no email channel, default delivery resolves to manual (no throw, no email).
  it('should default to manual delivery when no email service is present', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    await service.generate(ref)

    expect(emailSendTemplate).not.toHaveBeenCalled()
    expect(await storage.getCooldown(ref.tenantId, ref.recipient, ref.purpose)).toBeGreaterThan(0)
  })

  // With an email channel, default delivery resolves to email.
  it('should default to email delivery when an email service is present', async () => {
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    await service.generate(ref)

    expect(emailSendTemplate).toHaveBeenCalledTimes(1)
  })

  // Requesting email delivery without an email channel fails and cleans up.
  it('should throw OTP_EMAIL_DELIVERY_NOT_CONFIGURED and clean up when email is absent', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    await expect(service.generate({ ...ref, deliverVia: 'email' })).rejects.toMatchObject({
      code: 'notification.otp_email_delivery_not_configured'
    })
    expect(await storage.get(ref.tenantId, ref.recipient, ref.purpose)).toBeNull()
    expect(await storage.getCooldown(ref.tenantId, ref.recipient, ref.purpose)).toBe(0)
  })

  // A persistence failure (storage.set rejects) must release the cooldown so the
  // recipient is never locked out behind a cooldown with no live OTP, then rethrow.
  it('should release the cooldown and propagate the error when persistence fails', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    jest.spyOn(storage, 'set').mockRejectedValue(new Error('redis set failed'))

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).rejects.toThrow(
      'redis set failed'
    )
    expect(await storage.get(ref.tenantId, ref.recipient, ref.purpose)).toBeNull()
    expect(await storage.getCooldown(ref.tenantId, ref.recipient, ref.purpose)).toBe(0)
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'failed', metadata: { errorMessage: 'redis set failed' } })
    )
  })

  // A delivery failure releases the cooldown and deletes the orphan, then rethrows.
  it('should release the cooldown and delete the OTP on delivery failure', async () => {
    emailSendTemplate.mockRejectedValue(new Error('smtp down'))
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    await expect(service.generate({ ...ref, deliverVia: 'email' })).rejects.toThrow('smtp down')
    expect(await storage.get(ref.tenantId, ref.recipient, ref.purpose)).toBeNull()
    expect(await storage.getCooldown(ref.tenantId, ref.recipient, ref.purpose)).toBe(0)
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'failed', metadata: { errorMessage: 'smtp down' } })
    )
  })

  // A non-Error delivery rejection is stringified for the audit and rethrown as-is.
  it('should stringify a non-Error delivery rejection', async () => {
    emailSendTemplate.mockRejectedValue('boom')
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    await expect(service.generate({ ...ref, deliverVia: 'email' })).rejects.toBe('boom')
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { errorMessage: 'boom' } })
    )
  })

  // SECURITY: the plaintext code must never appear in any audit entry.
  it('should never place the code in audit metadata', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    await service.generate({ ...ref, deliverVia: 'manual' })
    const realCode = (await storage.get(ref.tenantId, ref.recipient, ref.purpose))?.code as string

    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(realCode)).toBe(false)
    }
  })

  // Audit failures are swallowed by default so generate still succeeds.
  it('should swallow audit failures by default', async () => {
    audit.create.mockRejectedValue(new Error('db down'))
    const service = new OtpService(makeOptions(), storage, audit)

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).resolves.toMatchObject({
      cooldownSeconds: 60
    })
  })

  // Per-purpose overrides must drive length, ttl, maxAttempts, and cooldown.
  it('should honour perPurpose overrides', async () => {
    const options = makeOptions({
      perPurpose: {
        password_reset: {
          length: 8,
          codeType: 'alphanumeric',
          ttlSeconds: 300,
          maxAttempts: 3,
          resendCooldownSeconds: 30
        }
      }
    })
    const service = new OtpService(options, storage, audit)

    const result = await service.generate({ ...ref, purpose: 'password_reset', deliverVia: 'manual' })
    const entry = await storage.get(ref.tenantId, ref.recipient, 'password_reset')

    expect(result.cooldownSeconds).toBe(30)
    expect(entry?.maxAttempts).toBe(3)
    expect(entry?.code).toHaveLength(8)
  })
})

describe('OtpService.verify', () => {
  let storage: InMemoryOtpStorage
  let audit: jest.Mocked<INotificationLogRepository>

  beforeEach(() => {
    storage = new InMemoryOtpStorage()
    audit = makeAudit()
  })

  const seed = async (overrides = {}): Promise<void> => {
    await storage.set(ref.tenantId, ref.recipient, ref.purpose, {
      code: '123456',
      expiresAt: Date.now() + 600_000,
      attempts: 0,
      maxAttempts: 5,
      ...overrides
    })
  }

  // A correct code validates and (by default) marks the entry validated.
  it('should validate a correct code and mark it validated by default', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await seed()

    expect(await service.verify({ ...ref, code: '123456' })).toEqual({ valid: true })
    const status = await service.getStatus(ref)
    expect(status.validated).toBe(true)
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ verb: 'verified' }))
  })

  // A missing entry verifies as not_found.
  it('should return not_found when there is no entry', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    expect(await service.verify({ ...ref, code: '000000' })).toEqual({
      valid: false,
      reason: 'not_found'
    })
  })

  // At the attempt ceiling the storage reports max_attempts.
  it('should return max_attempts at the ceiling', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await seed({ attempts: 5, maxAttempts: 5 })

    expect(await service.verify({ ...ref, code: '123456' })).toEqual({
      valid: false,
      reason: 'max_attempts'
    })
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'max_attempts_exceeded' })
    )
  })

  // A wrong code consumes an attempt and reports the remaining count.
  it('should return invalid_code with remainingAttempts on a wrong guess', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await seed()
    const consumeSpy = jest.spyOn(storage, 'consumeAttempt')

    const result = await service.verify({ ...ref, code: '999999' })

    expect(result).toEqual({ valid: false, reason: 'invalid_code', remainingAttempts: 4 })
    expect(consumeSpy).toHaveBeenCalledTimes(1)
    expect((await storage.get(ref.tenantId, ref.recipient, ref.purpose))?.attempts).toBe(1)
  })

  // With consumeOnVerify the entry and its cooldown are removed on success.
  it('should delete the entry and clear cooldown when consumeOnVerify is true', async () => {
    const service = new OtpService(makeOptions({ consumeOnVerify: true }), storage, audit)
    await storage.tryAcquireCooldown(ref.tenantId, ref.recipient, ref.purpose, 60)
    await seed()

    expect(await service.verify({ ...ref, code: '123456' })).toEqual({ valid: true })
    expect(await storage.get(ref.tenantId, ref.recipient, ref.purpose)).toBeNull()
    expect(await storage.getCooldown(ref.tenantId, ref.recipient, ref.purpose)).toBe(0)
  })
})

describe('OtpService consume / resend / getStatus / isConfigured', () => {
  let storage: InMemoryOtpStorage
  let audit: jest.Mocked<INotificationLogRepository>

  beforeEach(() => {
    storage = new InMemoryOtpStorage()
    audit = makeAudit()
    emailSendTemplate.mockResolvedValue({ messageId: 'm1' })
  })

  // consume removes the entry and cooldown and is idempotent.
  it('should delete the entry and clear cooldown, idempotently', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await service.generate({ ...ref, deliverVia: 'manual' })

    await service.consume(ref)
    await service.consume(ref) // idempotent — must not throw

    expect(await storage.get(ref.tenantId, ref.recipient, ref.purpose)).toBeNull()
    expect(await storage.getCooldown(ref.tenantId, ref.recipient, ref.purpose)).toBe(0)
  })

  // resend behaves exactly like generate, issuing a fresh code.
  it('should alias generate from resend', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    const result = await service.resend({ ...ref, deliverVia: 'manual' })

    expect(result.cooldownSeconds).toBe(60)
    expect(await storage.get(ref.tenantId, ref.recipient, ref.purpose)).not.toBeNull()
  })

  // getStatus reports non-existence with the current cooldown.
  it('should report exists:false when there is no entry', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    expect(await service.getStatus(ref)).toEqual({ exists: false, cooldownSeconds: 0 })
  })

  // getStatus returns counters but NEVER the plaintext code.
  it('should return a truncated status without the code', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await service.generate({ ...ref, deliverVia: 'manual' })

    const status = await service.getStatus(ref)

    expect(status).toMatchObject({ exists: true, attempts: 0, maxAttempts: 5 })
    expect(status).not.toHaveProperty('code')
    expect(status).not.toHaveProperty('validated')
  })

  // isConfigured reflects both channel presence and storage readiness.
  it('should reflect channel presence and storage readiness', () => {
    expect(new OtpService(makeOptions(), storage, audit).isConfigured()).toBe(true)
    expect(new OtpService(makeOptions(null), storage, audit).isConfigured()).toBe(false)

    jest.spyOn(storage, 'isConfigured').mockReturnValue(false)
    expect(new OtpService(makeOptions(), storage, audit).isConfigured()).toBe(false)
  })
})

describe('OtpService not-configured + audit propagation', () => {
  let storage: InMemoryOtpStorage

  beforeEach(() => {
    storage = new InMemoryOtpStorage()
  })

  // Every mutating op fails closed when the OTP channel is absent.
  it('should throw OTP_STORAGE_NOT_CONFIGURED across generate/verify/consume', async () => {
    const service = new OtpService(makeOptions(null), storage, makeAudit())

    await expect(service.generate(ref)).rejects.toMatchObject({
      code: 'notification.otp_storage_not_configured'
    })
    await expect(service.verify({ ...ref, code: '1' })).rejects.toMatchObject({
      code: 'notification.otp_storage_not_configured'
    })
    await expect(service.consume(ref)).rejects.toMatchObject({
      code: 'notification.otp_storage_not_configured'
    })
  })

  // With swallowErrors false an audit failure surfaces as AUDIT_LOG_FAILED.
  it('should propagate AUDIT_LOG_FAILED when not swallowing', async () => {
    const audit = makeAudit()
    audit.create.mockRejectedValue(new Error('db down'))
    const service = new OtpService(makeOptions({}, { swallowErrors: false }), storage, audit)

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).rejects.toMatchObject({
      code: 'notification.audit_log_failed'
    })
  })

  // A non-Error audit rejection is stringified into the AUDIT_LOG_FAILED cause.
  it('should stringify a non-Error audit rejection when not swallowing', async () => {
    const audit = makeAudit()
    audit.create.mockRejectedValue('weird')
    const service = new OtpService(makeOptions({}, { swallowErrors: false }), storage, audit)

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).rejects.toMatchObject({
      code: 'notification.audit_log_failed'
    })
  })
})
