/**
 * @fileoverview Specifies how `OtpService` stores and checks a code under `otp.codeSecret`:
 * the store holds a keyed digest and never the code, a correct code still verifies, an
 * entry written in plaintext before the secret was configured still verifies until it
 * expires, and a digest that can no longer be recomputed never verifies.
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

  // The digest must still let the right code in, and keep the wrong one out.
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

  // Upgrade path: an entry written in plaintext before the secret was configured still
  // verifies until it expires, so no live code is invalidated by turning the option on.
  it('should still verify a legacy plaintext entry', async () => {
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

  // Without a secret the stored value is the code, as before: the option is opt-in.
  it('should store the plaintext code when no secret is configured', async () => {
    const service = new OtpService(makeOptions({}), storage, audit, emailServiceStub)

    const delivered = await issue(service)
    const stored = await storage.get('acme', ref.recipient, ref.purpose)

    expect(stored?.code).toBe(delivered)
  })
})
