/**
 * @fileoverview Specifies how `OtpService` stores and checks a code under `otp.codeSecret`:
 * the store holds a keyed digest and never the code, a correct code verifies, an entry
 * written in plaintext while no secret was set verifies until it expires, and a digest
 * that cannot be recomputed never verifies.
 * @layer domain
 */
import type { INotificationLogRepository } from '../interfaces/notification-log-repository.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { CODE_DIGEST_PREFIX } from '../utils/code-digest'

import {
  emailSendTemplate,
  emailServiceStub,
  makeAudit,
  makeOptions,
  ref
} from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

const SECRET = 'a-secret-of-at-least-thirty-two-bytes!'
const base = { ...ref, tenantId: 'acme' }

describe('OtpService with otp.codeSecret', () => {
  let storage: InMemoryOtpStorage
  let audit: jest.Mocked<INotificationLogRepository>

  beforeEach(() => {
    storage = new InMemoryOtpStorage()
    audit = makeAudit()
    emailSendTemplate.mockReset()
    emailSendTemplate.mockResolvedValue({ messageId: 'm1' })
  })

  /** Issues a code through the email path and returns the plaintext the recipient received. */
  const issue = async (service: OtpService): Promise<string> => {
    await service.generate({ ...base })
    const sent = emailSendTemplate.mock.calls.at(-1)?.[0] as { data: { code: string } }
    return sent.data.code
  }

  // The point of the option: a reader of the store sees a digest, not a code.
  it('should store a keyed digest and deliver the plaintext code', async () => {
    const service = new OtpService(
      makeOptions({ codeSecret: SECRET }),
      storage,
      audit,
      emailServiceStub
    )

    const delivered = await issue(service)
    const stored = await storage.get('acme', ref.recipient, ref.purpose)

    expect(stored?.code.startsWith(CODE_DIGEST_PREFIX)).toBe(true)
    expect(stored?.code).not.toContain(delivered)
    expect(JSON.stringify(stored)).not.toContain(delivered)
  })

  // The digest lets the right code in and keeps the wrong one out.
  it('should verify the delivered code and refuse a wrong one', async () => {
    const service = new OtpService(
      makeOptions({ codeSecret: SECRET }),
      storage,
      audit,
      emailServiceStub
    )
    const delivered = await issue(service)
    const wrong = delivered === '000000' ? '000001' : '000000'

    expect(await service.verify({ ...base, code: wrong })).toMatchObject({
      valid: false,
      reason: 'invalid_code'
    })
    expect(await service.verify({ ...base, code: delivered })).toEqual({ valid: true })
  })

  // The verified entry keeps its digest (it is marked validated, not rewritten in plaintext).
  it('should keep the digest after a successful verify', async () => {
    const service = new OtpService(
      makeOptions({ codeSecret: SECRET }),
      storage,
      audit,
      emailServiceStub
    )
    const delivered = await issue(service)

    await service.verify({ ...base, code: delivered })
    const stored = await storage.get('acme', ref.recipient, ref.purpose)

    expect(stored?.code.startsWith(CODE_DIGEST_PREFIX)).toBe(true)
    expect(stored?.validated).toBe(true)
  })

  // No code or digest may reach an audit entry.
  it('should write neither the code nor the digest to the audit entries', async () => {
    const service = new OtpService(
      makeOptions({ codeSecret: SECRET }),
      storage,
      audit,
      emailServiceStub
    )
    const delivered = await issue(service)
    await service.verify({ ...base, code: delivered })
    const stored = await storage.get('acme', ref.recipient, ref.purpose)

    const serialized = JSON.stringify(audit.create.mock.calls)
    expect(serialized).not.toContain(stored?.code ?? 'x')
    expect(serialized.replaceAll('12345', '')).not.toContain(delivered)
  })

  // An entry written in plaintext while no secret was set verifies until it expires, so
  // no live code is invalidated by turning the option on.
  it('should verify a legacy plaintext entry', async () => {
    await storage.set('acme', ref.recipient, ref.purpose, {
      code: '654321',
      expiresAt: Date.now() + 60_000,
      attempts: 0,
      maxAttempts: 3
    })
    const service = new OtpService(makeOptions({ codeSecret: SECRET }), storage, audit)

    expect(await service.verify({ ...base, code: '000000' })).toMatchObject({ valid: false })
    expect(await service.verify({ ...base, code: '654321' })).toEqual({ valid: true })
  })

  // Rotation or removal: a digest that cannot be recomputed (another secret, or none) never
  // verifies, and in particular the digest string itself is not accepted as the code.
  it.each([
    ['a different secret', 'a-different-secret-of-thirty-two-bytes!!'],
    ['no secret', undefined]
  ])('should never verify a stored digest under %s', async (_label, secret) => {
    const issuing = new OtpService(
      makeOptions({ codeSecret: SECRET }),
      storage,
      audit,
      emailServiceStub
    )
    const delivered = await issue(issuing)
    const stored = await storage.get('acme', ref.recipient, ref.purpose)
    const verifying = new OtpService(
      makeOptions(secret === undefined ? {} : { codeSecret: secret }),
      storage,
      audit
    )

    expect(await verifying.verify({ ...base, code: delivered })).toMatchObject({ valid: false })
    expect(await verifying.verify({ ...base, code: stored?.code ?? '' })).toMatchObject({
      valid: false
    })
  })

  // Omitting the secret stores the plaintext code: the option is opt-in.
  it('should store the plaintext code when no secret is configured', async () => {
    const service = new OtpService(makeOptions({}), storage, audit, emailServiceStub)

    const delivered = await issue(service)
    const stored = await storage.get('acme', ref.recipient, ref.purpose)

    expect(stored?.code).toBe(delivered)
  })

  // A digest cannot be handed to a person, and `generate` never returns the code, so a manual
  // delivery under a secret would succeed with nothing deliverable. It is refused before the
  // cooldown is taken or anything is stored.
  describe('manual delivery', () => {
    const manualCases: ReadonlyArray<
      [string, () => OtpService, Partial<{ deliverVia: 'manual' }>]
    > = [
      [
        'an explicit manual delivery',
        () => new OtpService(makeOptions({ codeSecret: SECRET }), storage, audit, emailServiceStub),
        { deliverVia: 'manual' }
      ],
      [
        'the default delivery when no email channel is configured',
        () => new OtpService(makeOptions({ codeSecret: SECRET }), storage, audit),
        {}
      ]
    ]

    it.each(manualCases)('should refuse %s under a secret', async (_label, build, input) => {
      const service = build()

      await expect(service.generate({ ...base, ...input })).rejects.toMatchObject({
        code: 'notification.otp_manual_delivery_unavailable',
        response: {
          error: expect.objectContaining({
            details: expect.objectContaining({ remedy: expect.stringContaining('otp.codeSecret') })
          })
        }
      })
    })

    it.each(manualCases)(
      'should store nothing and take no cooldown for %s',
      async (_label, build, input) => {
        const service = build()
        await service.generate({ ...base, ...input }).catch(() => undefined)

        expect(storage.size()).toEqual({ otps: 0, cooldowns: 0 })
        expect(audit.create).not.toHaveBeenCalled()
      }
    )

    // The refusal names both ways out.
    it('should name the remedy in the message and the details', async () => {
      const service = new OtpService(makeOptions({ codeSecret: SECRET }), storage, audit)
      const error = await service
        .generate({ ...base, deliverVia: 'manual' })
        .catch((e: unknown) => e)
      const body = (
        error as { getResponse: () => { error: { message: string; details: { remedy: string } } } }
      ).getResponse()

      expect(body.error.message).toContain('manual')
      expect(body.error.details.remedy).toContain('unset otp.codeSecret')
      expect(body.error.details.remedy).toContain('email channel')
    })

    // Without a secret the manual flow is the plaintext flow: the caller reads the code from the store.
    it('should keep manual delivery working without a secret', async () => {
      const service = new OtpService(makeOptions({}), storage, audit)

      await expect(service.generate({ ...base, deliverVia: 'manual' })).resolves.toMatchObject({
        cooldownSeconds: 60
      })
      expect((await storage.get('acme', ref.recipient, ref.purpose))?.code).toMatch(/^\d{6}$/)
    })

    // Email delivery under a secret is the supported path and is unaffected.
    it('should deliver by email under a secret', async () => {
      const service = new OtpService(
        makeOptions({ codeSecret: SECRET }),
        storage,
        audit,
        emailServiceStub
      )

      await expect(service.generate({ ...base, deliverVia: 'email' })).resolves.toBeDefined()
      expect(emailSendTemplate).toHaveBeenCalledTimes(1)
    })
  })
})
