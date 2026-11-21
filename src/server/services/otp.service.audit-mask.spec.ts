/**
 * @fileoverview Holds the failed-generate audit entry to carrying no raw recipient in the store's
 * error text when `audit.maskRecipient` is set.
 * @layer domain
 */

import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

const base = { ...ref, deliverVia: 'manual' as const }

async function failedEntry(message: string, mask?: (r: string) => string) {
  const storage = new InMemoryOtpStorage()
  storage.set = async () => {
    throw new Error(message)
  }
  const audit = makeAudit()
  const options = makeOptions({}, mask ? { maskRecipient: mask } : {})
  await new OtpService(options, storage, audit).generate(base).catch(() => undefined)
  return audit.create.mock.calls.map((c) => c[0]).find((e) => e.verb === 'failed')
}

describe('the failed-generate audit entry under audit.maskRecipient', () => {
  it('should mask every occurrence of the recipient in the store error text', async () => {
    const entry = await failedEntry(
      `write failed for ${ref.recipient} and again ${ref.recipient}`,
      () => '***'
    )

    expect(entry?.metadata?.errorMessage).toBe('write failed for *** and again ***')
    expect(JSON.stringify(entry)).not.toContain(ref.recipient)
  })

  it('should leave the text as it is when the mask returns the recipient', async () => {
    const entry = await failedEntry(`write failed for ${ref.recipient}`)

    expect(entry?.metadata?.errorMessage).toBe(`write failed for ${ref.recipient}`)
  })
})
