/**
 * @fileoverview Characterizes what `verify` answers when the code expires between the attempt
 * being consumed and the `validated` flag being written: the answer is still valid, and the
 * flag is not stored, so a later step that gates on it fails closed.
 * @layer domain
 */
import type { OtpEntry } from '../interfaces/otp-storage.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import {
  dummyRepo,
  emailSendTemplate,
  emailServiceStub,
  makeOptions
} from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

/** A storage whose entry is gone by the time `update` runs, as a Redis `SET … KEEPTTL XX` finds it. */
class ExpiringBeforeUpdateStorage extends InMemoryOtpStorage {
  override async update(
    tenantId: string,
    recipient: string,
    purpose: string,
    entry: OtpEntry
  ): Promise<void> {
    await this.delete(tenantId, recipient, purpose)
    await super.update(tenantId, recipient, purpose, entry)
  }
}

const scope = { tenantId: 'acme', recipient: 'jane@acme.com', purpose: 'email_verification' }

describe('OtpService verify when the code expires before the validated flag is written', () => {
  beforeEach(() => {
    emailSendTemplate.mockReset()
    emailSendTemplate.mockResolvedValue({ messageId: 'm1' })
  })

  const issue = async (service: OtpService): Promise<string> => {
    await service.generate({ ...scope })
    const sent = emailSendTemplate.mock.calls.at(-1)?.[0] as { data: { code: string } }
    return sent.data.code
  }

  // The contract the interface documents for `update`: it never writes an entry that is gone.
  // The caller is told the code was right; what it must not assume is that a flag was stored.
  it('should answer valid and store no validated flag', async () => {
    const storage = new ExpiringBeforeUpdateStorage()
    const service = new OtpService(
      makeOptions({ consumeOnVerify: false }),
      storage,
      dummyRepo,
      emailServiceStub
    )
    const code = await issue(service)

    const result = await service.verify({ ...scope, code })
    const status = await service.getStatus(scope)

    expect(result).toEqual({ valid: true })
    expect(status.exists).toBe(false)
    expect(await storage.get(scope.tenantId, scope.recipient, scope.purpose)).toBeNull()
  })

  // Failing closed: a later step that asks whether the recipient is validated finds nothing,
  // so it asks for the code again instead of trusting a flag that was never written.
  it('should leave a later validated check with nothing to trust', async () => {
    const service = new OtpService(
      makeOptions({ consumeOnVerify: false }),
      new ExpiringBeforeUpdateStorage(),
      dummyRepo,
      emailServiceStub
    )
    const code = await issue(service)
    await service.verify({ ...scope, code })

    const status = await service.getStatus(scope)

    expect(status).not.toHaveProperty('validated', true)
  })
})
