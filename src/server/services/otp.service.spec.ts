import { resolveOptions } from '../config/resolved-options'
import type { ResolvedNotificationOptions } from '../config/resolved-options'
import { NotificationException } from '../errors/notification-exception'
import type {
  AuditOptions,
  OtpChannelOptions
} from '../interfaces/notification-module-options.interface'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import type {
  EmailSendOptions,
  EmailSendResult,
  IEmailProvider
} from '../interfaces/email-provider.interface'
import type {
  IEmailTemplateRenderer,
  RenderedEmail
} from '../interfaces/email-template-renderer.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { toRetryAfterHeader } from '../utils/cooldown-helpers'

import { EmailService } from './email.service'
import { OtpService } from './otp.service'

const dummyRepo = {
  name: 'x',
  create: async (): Promise<void> => undefined
} as INotificationLogRepository

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

/**
 * Serializes an error the way a cause-walking log serializer would: message,
 * stack, enumerable own properties, HTTP response body, and every nested
 * `cause`, recursively.
 */
const serializeErrorChain = (error: unknown): string => {
  if (error === null || typeof error !== 'object') {
    return String(error)
  }
  const chained = error as Error & { cause?: unknown; getResponse?: () => unknown }
  return [
    chained.name,
    chained.message,
    chained.stack ?? '',
    JSON.stringify({ ...chained }),
    typeof chained.getResponse === 'function' ? JSON.stringify(chained.getResponse()) : '',
    'cause' in chained ? serializeErrorChain(chained.cause) : ''
  ].join('\n')
}

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

  // `expiresAt` is `now + ttlSeconds * 1000`, and only the ORDER of magnitude was ever checked
  // (that it lies in the future). Divide instead of multiply and a 300-second code expires
  // 0.3 milliseconds after it is minted — every verification fails, every retry mints another,
  // and the flow looks like a delivery problem rather than an arithmetic one. The window is
  // asserted against the configured TTL, with a second of slack for the clock.
  it('should set the expiry a full TTL ahead, in milliseconds', async () => {
    const service = new OtpService(
      makeOptions({
        perPurpose: {
          [ref.purpose]: {
            length: 6,
            codeType: 'numeric',
            ttlSeconds: 300,
            maxAttempts: 5,
            resendCooldownSeconds: 60
          }
        }
      }),
      storage,
      audit
    )
    const before = Date.now()

    const result = await service.generate({ ...ref, deliverVia: 'manual' })

    expect(result.expiresAt).toBeGreaterThanOrEqual(before + 300_000)
    expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 300_000 + 1_000)
  })

  // A second generate inside the cooldown window is rejected with retry hints.
  it('should throw OTP_COOLDOWN_ACTIVE on a second call in the window', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await service.generate({ ...ref, deliverVia: 'manual' })

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).rejects.toMatchObject({
      code: 'notification.otp_cooldown_active'
    })
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        verb: 'cooldown_blocked',
        metadata: { remainingSeconds: expect.any(Number) }
      })
    )
  })

  // The cooldown exception must carry retry hints a consumer can turn into a
  // `Retry-After` header / countdown: remainingSeconds, retryAfter, expiresAt.
  it('should enrich OTP_COOLDOWN_ACTIVE with remainingSeconds, retryAfter, and expiresAt', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await service.generate({ ...ref, deliverVia: 'manual' })

    expect.assertions(5)
    try {
      await service.generate({ ...ref, deliverVia: 'manual' })
    } catch (error) {
      const body = (
        error as { getResponse: () => { error: { details: Record<string, unknown> } } }
      ).getResponse()
      const details = body.error.details
      expect(typeof details.remainingSeconds).toBe('number')
      expect(details.remainingSeconds as number).toBeGreaterThan(0)
      expect(details.retryAfter).toBe(toRetryAfterHeader(details.remainingSeconds as number))
      expect(typeof details.expiresAt).toBe('number')
      expect(details.expiresAt as number).toBeGreaterThan(Date.now())
    }
  })

  // The `Retry-After` hint is derived through `toRetryAfterHeader`, which rounds a
  // fractional remaining cooldown UP and clamps it — never the raw `String(...)`
  // of the value. A mocked fractional remainder proves the rounding path.
  it('should derive retryAfter from a fractional remainingSeconds via toRetryAfterHeader', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await service.generate({ ...ref, deliverVia: 'manual' })
    jest.spyOn(storage, 'getCooldown').mockResolvedValue(30.4)

    expect.assertions(3)
    try {
      await service.generate({ ...ref, deliverVia: 'manual' })
    } catch (error) {
      const details = (
        error as { getResponse: () => { error: { details: Record<string, unknown> } } }
      ).getResponse().error.details
      expect(details.remainingSeconds).toBe(30.4)
      expect(details.retryAfter).toBe(toRetryAfterHeader(30.4))
      expect(details.retryAfter).toBe('31')
    }
  })

  // Email delivery renders the otp_code template with the auto-injected data.
  it('should deliver via email with auto-injected code/expiresInMinutes/purpose', async () => {
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    await service.generate({
      ...ref,
      deliverVia: 'email',
      emailData: { name: 'Jane' },
      locale: 'en',
      userId: 'u1'
    })

    expect(emailSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        template: 'otp_code',
        locale: 'en',
        userId: 'u1',
        data: expect.objectContaining({
          name: 'Jane',
          expiresInMinutes: 10,
          purpose: 'email_verification'
        })
      })
    )
    const code = emailSendTemplate.mock.calls[0]?.[0].data.code
    expect(code).toMatch(/^\d{6}$/)
  })

  // Email delivery without locale/userId must NOT inject those keys into the email
  // input — pins the omission side of the buildOtpEmail conditional spreads against
  // the always-add mutant that would set `locale: undefined` / `userId: undefined`.
  it('should omit locale and userId from the OTP email when not supplied', async () => {
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    await service.generate({ ...ref, deliverVia: 'email' })

    const sent = emailSendTemplate.mock.calls[0]?.[0] as Record<string, unknown>
    expect('locale' in sent).toBe(false)
    expect('userId' in sent).toBe(false)
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

  // SECURITY (regression): a renderer/provider that echoes its template data —
  // which carries the plaintext code — in a thrown error must have the code
  // scrubbed from the audit errorMessage AND from every level of the rethrown
  // chain (message + stack) before anything leaves the service.
  it('should scrub the code from a delivery error chain and the audit entry', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      const inner = new Error(`socket wrote body code=${input.data.code}`)
      const outer = new Error(`render failed for ${input.data.code}`, { cause: inner })
      // Materialize the lazy V8 stacks NOW, while the message still carries the
      // code — the header line freezes on first read, so a pre-read stack is
      // exactly what the stack scrub exists to clean.
      void inner.stack
      void outer.stack
      return Promise.reject(outer)
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(leakedCode).not.toBe('')
    const chain = serializeErrorChain(caught)
    expect(chain.includes(leakedCode)).toBe(false)
    expect(chain).toContain('[redacted]')
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(leakedCode)).toBe(false)
    }
  })

  // The scrub traversal is identity-based, so a chain deeper than any fixed
  // bound is scrubbed in full — no unscrubbed tail a cause-walking serializer
  // could still print (regression for the old depth cap).
  it('should scrub every link of a deep delivery-error chain', async () => {
    let leakedCode = ''
    const nodes: Error[] = []
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      for (let level = 0; level < 12; level += 1) {
        const node = new Error(`level ${level} code=${input.data.code}`)
        delete node.stack
        nodes.push(node)
      }
      nodes.reduce((parent, node) => {
        parent.cause = node
        return node
      })
      return Promise.reject(nodes[0])
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    await service.generate({ ...ref, deliverVia: 'email' }).catch(() => undefined)

    for (const node of nodes) {
      expect(node.message.includes(leakedCode)).toBe(false)
    }
  })

  // A custom storage or provider may reject with a raw OBJECT that carries the
  // plaintext entry in its properties; every non-Error rejection is flattened
  // to a redacted string so nothing serializable retains the code.
  it('should flatten an object rejection to a redacted string', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      return Promise.reject({ entry: { code: input.data.code } })
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(caught).toBe('[object Object]')
    expect(JSON.stringify(audit.create.mock.calls).includes(leakedCode)).toBe(false)
  })

  // Real-path regression (no EmailService stub): a provider failure that echoes
  // the rendered OTP body must leave the code out of BOTH audit entries — the
  // EmailService 'failed' entry (redacted via `auditRedactValues`) and the
  // OtpService 'failed' entry (scrubbed) — and out of the rethrown chain.
  it('should keep the code out of both audit entries on a real email delivery failure', async () => {
    let realCode = ''
    const echoingProvider: IEmailProvider = {
      name: 'echoing',
      isConfigured: (): boolean => true,
      send: async (sendOptions: EmailSendOptions): Promise<EmailSendResult> => {
        // Echo the OTP-bearing body through every serializer-visible surface:
        // message, name, and a PRIMITIVE nested cause (which the log-safe copy
        // preserves verbatim and only the scrub can clean).
        const providerError = new Error(`provider rejected payload: ${sendOptions.html}`, {
          cause: `wire dump: ${sendOptions.html}`
        })
        providerError.name = `REJECT_${sendOptions.html}`
        throw providerError
      }
    }
    const renderer: IEmailTemplateRenderer = {
      name: 'capturing',
      hasTemplate: async (): Promise<boolean> => true,
      render: async (
        _template: string,
        data: Record<string, unknown>,
        _locale: string
      ): Promise<RenderedEmail> => {
        realCode = String(data.code)
        return { subject: 'Your code', html: `<p>Your code is ${realCode}</p>` }
      }
    }
    const options: ResolvedNotificationOptions = {
      ...makeOptions(),
      email: { defaultFrom: 'noreply@acme.com', defaultTags: [], maxAttachmentBytes: 1_000_000 }
    }
    const emailService = new EmailService(options, echoingProvider, renderer, audit)
    const service = new OtpService(options, storage, audit, emailService)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(realCode.length).toBeGreaterThan(0)
    expect(serializeErrorChain(caught).includes(realCode)).toBe(false)
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(realCode)).toBe(false)
    }
  })

  // A STRING rejection cannot be mutated in place, so a scrubbed copy must be
  // rethrown and the audit errorMessage must carry the scrubbed form.
  it('should rethrow a scrubbed copy of a string rejection', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      return Promise.reject(`string failure code=${input.data.code}`)
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(caught).toBe(`string failure code=[redacted]`)
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { errorMessage: 'string failure code=[redacted]' } })
    )
    expect(JSON.stringify(audit.create.mock.calls).includes(leakedCode)).toBe(false)
  })

  // SECURITY (regression): a failed cleanup used to escape the catch block
  // BEFORE the scrub ran — the cleanup error must supersede the delivery error
  // (the cooldown/OTP may be orphaned), carry it as `cause`, and still pass
  // through the scrub and the audit like any outgoing delivery failure.
  it('should scrub a cleanup failure and attach the delivery error as its cause', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      return Promise.reject(new Error(`delivery failed for ${input.data.code}`))
    })
    jest.spyOn(storage, 'clearCooldown').mockImplementation(async () => {
      throw new Error(`cleanup failed while holding ${leakedCode}`)
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('cleanup failed while holding [redacted]')
    expect(((caught as Error).cause as Error).message).toBe('delivery failed for [redacted]')
    expect(serializeErrorChain(caught).includes(leakedCode)).toBe(false)
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(leakedCode)).toBe(false)
    }
  })

  // A cleanup error that already carries its own cause must keep it — the
  // delivery error is only attached when the slot is genuinely free.
  it('should not overwrite an existing cause on a cleanup failure', async () => {
    emailSendTemplate.mockRejectedValue(new Error('delivery failed'))
    const ownCause = new Error('disk full')
    jest
      .spyOn(storage, 'clearCooldown')
      .mockRejectedValue(new Error('cleanup failed', { cause: ownCause }))
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect((caught as Error).cause).toBe(ownCause)
  })

  // A non-Error cleanup rejection takes the same flattening path as any other
  // non-Error outgoing failure.
  it('should flatten a non-Error cleanup rejection to a redacted string', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      return Promise.reject(new Error('delivery failed'))
    })
    jest
      .spyOn(storage, 'clearCooldown')
      .mockImplementation(() => Promise.reject(`cleanup dump ${leakedCode}`))
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(caught).toBe('cleanup dump [redacted]')
  })

  // SECURITY (regression): a custom storage may reject `set()` with the entry
  // attached as an enumerable property — the code inside it must not survive
  // into the rethrown error or any audit entry.
  it('should strip a storage rejection that retains the entry', async () => {
    let leakedCode = ''
    jest
      .spyOn(storage, 'set')
      .mockImplementation(async (_tenantId, _recipient, _purpose, entry) => {
        leakedCode = entry.code
        throw Object.assign(new Error('write failed'), { entry })
      })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'manual' })
      .catch((error: unknown) => error)

    expect(leakedCode).not.toBe('')
    expect(caught).toBeInstanceOf(Error)
    expect(Object.keys(caught as Error)).toEqual([])
    expect(serializeErrorChain(caught).includes(leakedCode)).toBe(false)
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(leakedCode)).toBe(false)
    }
  })

  // SECURITY (regression): a custom storage may reject with its OWN
  // NotificationException carrying the code in caller-supplied details — the
  // instance is preserved (consumers branch on it) but its response body is
  // deep-redacted before the rethrow.
  it('should redact a consumer NotificationException rejection from storage', async () => {
    let leakedCode = ''
    jest
      .spyOn(storage, 'set')
      .mockImplementation(async (_tenantId, _recipient, _purpose, entry) => {
        leakedCode = entry.code
        throw new NotificationException('OTP_STORAGE_NOT_CONFIGURED', { code: entry.code })
      })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'manual' })
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(NotificationException)
    expect(serializeErrorChain(caught).includes(leakedCode)).toBe(false)
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(leakedCode)).toBe(false)
    }
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

  // With swallowErrors:false an audit failure surfaces as AUDIT_LOG_FAILED carrying
  // the underlying error as `Error.cause` — while `details` stays null, because the
  // details object is serialized into the HTTP response and must never expose
  // internal error text to clients.
  it('should rethrow AUDIT_LOG_FAILED with the cause when swallowErrors is false', async () => {
    const auditError = new Error('db down')
    audit.create.mockRejectedValue(auditError)
    const service = new OtpService(makeOptions({}, { swallowErrors: false }), storage, audit)

    expect.assertions(3)
    try {
      await service.generate({ ...ref, deliverVia: 'manual' })
    } catch (error) {
      expect((error as NotificationException).code).toBe('notification.audit_log_failed')
      expect((error as NotificationException).cause).toMatchObject({ message: 'db down' })
      const response = (
        error as { getResponse: () => { error: { details: unknown } } }
      ).getResponse()
      expect(response.error.details).toBeNull()
    }
  })

  // SECURITY: with swallowErrors:false the AUDIT_LOG_FAILED chain — message, stack,
  // response body, and every nested cause — must never carry the plaintext code.
  // The cause chain is exactly what cause-walking log serializers now print.
  it('should keep the code out of the full AUDIT_LOG_FAILED error chain', async () => {
    audit.create.mockRejectedValue(new Error('db down'))
    const service = new OtpService(makeOptions({}, { swallowErrors: false }), storage, audit)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'manual' })
      .catch((error: unknown) => error)
    const realCode = (await storage.get(ref.tenantId, ref.recipient, ref.purpose))?.code as string

    expect(caught).toBeInstanceOf(NotificationException)
    expect(serializeErrorChain(caught).includes(realCode)).toBe(false)
  })

  // userId is forwarded into the audit entry when present — pins the conditional
  // `userId` spread in the audit-entry builder.
  it('should include userId in the audit entry when provided', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    await service.generate({ ...ref, deliverVia: 'manual', userId: 'user-42' })

    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-42' }))
  })

  // Without userId the audit entry omits the key entirely (no `userId: undefined`).
  it('should omit userId from the audit entry when absent', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    await service.generate({ ...ref, deliverVia: 'manual' })

    const entry = audit.create.mock.calls[0]?.[0] as NotificationLogEntry
    expect('userId' in entry).toBe(false)
  })

  // With no deliverVia and no email service the default resolves to 'manual':
  // the code persists but no email is attempted (no throw for missing email channel).
  it('should default deliverVia to manual when no email service is configured', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    await expect(service.generate(ref)).resolves.toMatchObject({ cooldownSeconds: 60 })
    expect(await storage.get(ref.tenantId, ref.recipient, ref.purpose)).not.toBeNull()
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

    const result = await service.generate({
      ...ref,
      purpose: 'password_reset',
      deliverVia: 'manual'
    })
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

  // A missing entry verifies as not_found and audits the reason in metadata.
  it('should return not_found when there is no entry', async () => {
    const service = new OtpService(makeOptions(), storage, audit)

    expect(await service.verify({ ...ref, code: '000000' })).toEqual({
      valid: false,
      reason: 'not_found'
    })
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'failed', metadata: { reason: 'not_found' } })
    )
  })

  // At the attempt ceiling the storage reports max_attempts and audits the reason.
  it('should return max_attempts at the ceiling', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await seed({ attempts: 5, maxAttempts: 5 })

    expect(await service.verify({ ...ref, code: '123456' })).toEqual({
      valid: false,
      reason: 'max_attempts'
    })
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        verb: 'max_attempts_exceeded',
        metadata: { reason: 'max_attempts' }
      })
    )
  })

  // A wrong code consumes an attempt, reports the remaining count, and audits the reason.
  it('should return invalid_code with remainingAttempts on a wrong guess', async () => {
    const service = new OtpService(makeOptions(), storage, audit)
    await seed()
    const consumeSpy = jest.spyOn(storage, 'consumeAttempt')

    const result = await service.verify({ ...ref, code: '999999' })

    expect(result).toEqual({ valid: false, reason: 'invalid_code', remainingAttempts: 4 })
    expect(consumeSpy).toHaveBeenCalledTimes(1)
    expect((await storage.get(ref.tenantId, ref.recipient, ref.purpose))?.attempts).toBe(1)
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'failed', metadata: { reason: 'invalid_code' } })
    )
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

  // A non-Error audit rejection rides as-is on the AUDIT_LOG_FAILED `cause`.
  it('should carry a non-Error audit rejection as the cause when not swallowing', async () => {
    const audit = makeAudit()
    audit.create.mockRejectedValue('weird')
    const service = new OtpService(makeOptions({}, { swallowErrors: false }), storage, audit)

    await expect(service.generate({ ...ref, deliverVia: 'manual' })).rejects.toMatchObject({
      code: 'notification.audit_log_failed',
      cause: 'weird'
    })
  })
})
