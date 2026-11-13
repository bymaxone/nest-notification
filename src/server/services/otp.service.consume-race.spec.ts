/**
 * @fileoverview Holds `consumeOnVerify` to its name: a code is accepted once, however many
 * verifications of it run at the same time, and a storage that cannot guarantee that is refused
 * when the service is built rather than raced.
 * @layer domain
 */

import type { ConsumeAttemptResult, IOtpStorage } from '../interfaces/otp-storage.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import {
  emailSendTemplate,
  emailServiceStub,
  makeAudit,
  makeOptions,
  ref
} from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

const SECRET = 'k'.repeat(40)
const RACERS = 5

/** Issues a code and returns the plaintext the user would type, read back from a plain store. */
async function issue(service: OtpService, storage: InMemoryOtpStorage): Promise<string> {
  await service.generate({ ...ref, deliverVia: 'manual' })
  const entry = await storage.get(ref.tenantId, ref.recipient, ref.purpose)
  return (entry as { code: string }).code
}

describe('OtpService consumeOnVerify under concurrency', () => {
  it('should accept a code exactly once when several verifications run together', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(makeOptions({ consumeOnVerify: true }), storage, makeAudit())
    const code = await issue(service, storage)

    const results = await Promise.all(
      Array.from({ length: RACERS }, () => service.verify({ ...ref, code }))
    )

    expect(results.filter((result) => result.valid)).toHaveLength(1)
    expect(results.filter((result) => !result.valid)).toEqual(
      Array.from({ length: RACERS - 1 }, () => ({ valid: false, reason: 'not_found' }))
    )
  })

  // With a secret the stored value is a digest: the comparison key is what the service read, and
  // the plaintext the user types is the one the email carried.
  it('should accept a keyed code exactly once as well', async () => {
    const storage = new InMemoryOtpStorage()
    emailSendTemplate.mockReset()
    emailSendTemplate.mockResolvedValue({ messageId: 'm1' })
    const service = new OtpService(
      makeOptions({ consumeOnVerify: true, codeSecret: SECRET }),
      storage,
      makeAudit(),
      emailServiceStub
    )
    await service.generate({ ...ref, recipient: 'jane@acme.com' })
    const code = (emailSendTemplate.mock.calls[0]?.[0] as { data: { code: string } }).data.code
    expect((await storage.get(ref.tenantId, ref.recipient, ref.purpose))?.code).not.toBe(code)

    const results = await Promise.all(
      Array.from({ length: RACERS }, () => service.verify({ ...ref, code }))
    )

    expect(results.filter((result) => result.valid)).toHaveLength(1)
  })

  it('should leave the entry gone once one verification has won', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(makeOptions({ consumeOnVerify: true }), storage, makeAudit())
    const code = await issue(service, storage)

    await Promise.all(Array.from({ length: RACERS }, () => service.verify({ ...ref, code })))

    expect(await storage.get(ref.tenantId, ref.recipient, ref.purpose)).toBeNull()
    expect(await service.verify({ ...ref, code })).toEqual({ valid: false, reason: 'not_found' })
  })

  // A code regenerated between the read and the delete stores another value: the loser must
  // not delete it, and the new code must still verify for its own user.
  it('should not delete a code that was regenerated after it was read', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(makeOptions({ consumeOnVerify: true }), storage, makeAudit())
    const code = await issue(service, storage)
    const realConsume = storage.consumeAttempt.bind(storage)
    jest
      .spyOn(storage, 'consumeAttempt')
      .mockImplementationOnce(async (...args): Promise<ConsumeAttemptResult> => {
        const result = await realConsume(...args)
        // The regenerate lands after the read and before the delete.
        await storage.set(ref.tenantId, ref.recipient, ref.purpose, {
          code: '999999',
          expiresAt: Date.now() + 60_000,
          attempts: 0,
          maxAttempts: 5
        })
        return result
      })

    expect(await service.verify({ ...ref, code })).toEqual({ valid: false, reason: 'not_found' })

    expect(await service.verify({ ...ref, code: '999999' })).toEqual({ valid: true })
  })

  it('should audit the loser as a failure and not clear the winner state twice', async () => {
    const storage = new InMemoryOtpStorage()
    const audit = makeAudit()
    const service = new OtpService(makeOptions({ consumeOnVerify: true }), storage, audit)
    const code = await issue(service, storage)

    await Promise.all([service.verify({ ...ref, code }), service.verify({ ...ref, code })])

    const verbs = audit.create.mock.calls.map(([entry]) => entry.verb)
    expect(verbs.filter((verb) => verb === 'verified')).toHaveLength(1)
    expect(verbs.filter((verb) => verb === 'failed')).toHaveLength(1)
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'failed', metadata: { reason: 'not_found' } })
    )
  })
})

describe('OtpService with a storage that cannot compare-and-delete', () => {
  /** A storage that implements everything but the atomic delete. */
  function storageWithout(): IOtpStorage {
    const inner = new InMemoryOtpStorage()
    return {
      name: 'custom',
      isConfigured: () => true,
      set: inner.set.bind(inner),
      get: inner.get.bind(inner),
      consumeAttempt: inner.consumeAttempt.bind(inner),
      update: inner.update.bind(inner),
      delete: inner.delete.bind(inner),
      tryAcquireCooldown: inner.tryAcquireCooldown.bind(inner),
      getCooldown: inner.getCooldown.bind(inner),
      clearCooldown: inner.clearCooldown.bind(inner)
    }
  }

  it('should refuse to start when consumeOnVerify is on, naming the method and the storage', () => {
    expect(
      () => new OtpService(makeOptions({ consumeOnVerify: true }), storageWithout(), makeAudit())
    ).toThrow(
      /consumeOnVerify requires an IOtpStorage that implements deleteIfCode \(the custom storage/
    )
  })

  it('should start when consumeOnVerify is off', () => {
    expect(
      () => new OtpService(makeOptions({ consumeOnVerify: false }), storageWithout(), makeAudit())
    ).not.toThrow()
  })
})
