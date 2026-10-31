/**
 * @fileoverview Holds `OtpService` to one OTP state per mailbox: every spelling of an
 * address shares the cooldown, the attempt budget, the status and the consume, while the
 * message is addressed exactly as supplied.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'
import type { INotificationLogRepository } from '../interfaces/notification-log-repository.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import {
  emailSendTemplate,
  emailServiceStub,
  makeAudit,
  makeOptions
} from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

// One mailbox, written five ways. Every mail provider in practice delivers all five to the
// same inbox, so the OTP state must be one state: separate keys would let a caller
// multiply the issue limit (one cooldown per spelling) and the attempt limit (one
// counter per spelling), and would make a user who types another case fail to verify.
const SPELLINGS = [
  'Jane@Acme.com',
  'jane@acme.com',
  ' jane@acme.com',
  'JANE@ACME.COM',
  'jane@acme.com '
]
const base = { tenantId: 'acme', purpose: 'password_reset' }

describe('OtpService recipient normalization', () => {
  let storage: InMemoryOtpStorage
  let audit: jest.Mocked<INotificationLogRepository>
  let service: OtpService

  beforeEach(() => {
    storage = new InMemoryOtpStorage()
    audit = makeAudit()
    emailSendTemplate.mockReset()
    emailSendTemplate.mockResolvedValue({ messageId: 'm1' })
    service = new OtpService(makeOptions({ defaultMaxAttempts: 3 }), storage, audit)
  })

  // The issue limit: only the first spelling may mint a code inside the cooldown.
  it('should hold one cooldown for every spelling of the mailbox', async () => {
    await service.generate({ ...base, recipient: SPELLINGS[0] as string, deliverVia: 'manual' })

    for (const recipient of SPELLINGS.slice(1)) {
      await expect(
        service.generate({ ...base, recipient, deliverVia: 'manual' })
      ).rejects.toMatchObject({ code: 'notification.otp_cooldown_active' })
    }
  })

  // The attempt limit: three wrong guesses in total, however the address is spelled.
  it('should spend one attempt budget across every spelling', async () => {
    await service.generate({ ...base, recipient: SPELLINGS[0] as string, deliverVia: 'manual' })

    const reasons: string[] = []
    for (const recipient of SPELLINGS) {
      const result = await service.verify({ ...base, recipient, code: '000000' })
      if (!result.valid) reasons.push(result.reason)
    }

    // Three guesses in total; after that the recipient is locked out, whatever the spelling.
    expect(reasons).toEqual([
      'invalid_code',
      'invalid_code',
      'invalid_code',
      'max_attempts',
      'max_attempts'
    ])
  })

  // The legitimate user: the code issued for one spelling verifies for another.
  it('should verify a code issued for one spelling under another', async () => {
    await service.generate({ ...base, recipient: 'Jane@Acme.com', deliverVia: 'manual' })
    const stored = await storage.get('acme', 'jane@acme.com', 'password_reset')

    const result = await service.verify({
      ...base,
      recipient: 'JANE@ACME.COM',
      code: stored?.code ?? ''
    })

    expect(result).toEqual({ valid: true })
  })

  // Status and consume read the same state.
  it('should read and clear the same state from any spelling', async () => {
    await service.generate({ ...base, recipient: ' Jane@Acme.com', deliverVia: 'manual' })

    expect((await service.getStatus({ ...base, recipient: 'jane@ACME.com' })).exists).toBe(true)
    await service.consume({ ...base, recipient: 'JANE@acme.com ' })
    expect((await service.getStatus({ ...base, recipient: 'jane@acme.com' })).exists).toBe(false)
  })

  // RFC 5321 §2.4: the local-part is case sensitive on the wire and a sender must
  // preserve it. Only the KEY is folded; the message goes to the address as supplied.
  it('should deliver to the address exactly as supplied', async () => {
    service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    await service.generate({ ...base, recipient: 'Jane.Doe@Acme.com' })

    expect(emailSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'Jane.Doe@Acme.com' })
    )
    expect(await storage.get('acme', 'jane.doe@acme.com', 'password_reset')).not.toBeNull()
  })

  // Audit entries correlate across spellings: they carry the folded recipient.
  it('should audit the folded recipient', async () => {
    await service.generate({ ...base, recipient: ' Jane@Acme.com', deliverVia: 'manual' })

    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'generated', recipient: 'jane@acme.com' })
    )
  })

  // A control character in the recipient is refused like a blank, before the storage.
  it('should refuse a recipient with a control character', async () => {
    await expect(
      service.generate({
        ...base,
        recipient: 'jane@acme.com\nBcc: x@evil.com',
        deliverVia: 'manual'
      })
    ).rejects.toBeInstanceOf(NotificationException)
    expect(storage.size().otps).toBe(0)
  })
})
