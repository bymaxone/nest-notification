/**
 * @fileoverview End-to-end audit-log suite, including the never-log-code gate.
 * @layer test
 *
 * Exercises the real `OtpService` + `EmailService` wired through the module with
 * an in-memory audit repository, asserting the recorded verbs for the OTP-via-email
 * happy path, the resend cooldown, and the attempt ceiling. The security gate is
 * the load-bearing assertion: a generated OTP code must never appear anywhere in
 * the audit trail. Codes are generated as 8-char alphabetic strings (the charset
 * excludes `I`/`O`) so the assertion cannot pass by coincidence against numeric
 * timestamps.
 */

import { Test } from '@nestjs/testing'

import {
  BymaxNotificationModule,
  DefaultTemplateRenderer,
  InMemoryOtpStorage,
  NoOpEmailProvider,
  OtpService
} from '@bymax-one/nest-notification'
import type {
  INotificationLogRepository,
  NotificationLogEntry,
  OtpChannelOptions
} from '@bymax-one/nest-notification'

const TENANT = 't1'
const RECIPIENT = 'maria@x.com'

/** In-memory audit sink capturing every recorded entry for inspection. */
class MemoryAuditRepo implements INotificationLogRepository {
  readonly name = 'memory-audit'
  readonly entries: NotificationLogEntry[] = []
  async create(entry: NotificationLogEntry): Promise<void> {
    this.entries.push(entry)
  }
}

interface Harness {
  otpService: OtpService
  storage: InMemoryOtpStorage
  repo: MemoryAuditRepo
}

/** Wires a fresh module (email + otp + audit) and returns the moving parts. */
async function setup(otpOverrides: Partial<OtpChannelOptions> = {}): Promise<Harness> {
  const storage = new InMemoryOtpStorage()
  const repo = new MemoryAuditRepo()
  const renderer = new DefaultTemplateRenderer({
    templates: {
      'otp_code::en': { subject: 'Your code', html: '<p>Code: {{code}}</p>', text: 'Code: {{code}}' }
    }
  })
  const moduleRef = await Test.createTestingModule({
    imports: [
      BymaxNotificationModule.forRoot({
        email: {
          provider: new NoOpEmailProvider(),
          defaultFrom: 'noreply@acme.com',
          templateRenderer: renderer
        },
        otp: { storage, defaultCodeType: 'alpha', defaultLength: 8, ...otpOverrides },
        audit: { repository: repo }
      })
    ]
  }).compile()
  return { otpService: moduleRef.get(OtpService), storage, repo }
}

describe('Audit log (E2E)', () => {
  // An OTP delivered by email records the OTP 'generated' and the email 'sent'.
  it('records generated + sent for an OTP delivered by email', async () => {
    const { otpService, repo } = await setup()

    await otpService.generate({
      tenantId: TENANT,
      recipient: RECIPIENT,
      purpose: 'email_verification',
      deliverVia: 'email'
    })

    const verbs = repo.entries.map((entry) => entry.verb)
    expect(verbs).toContain('generated')
    expect(verbs).toContain('sent')
    expect(repo.entries.find((entry) => entry.verb === 'sent')?.channel).toBe('email')
    expect(repo.entries.find((entry) => entry.verb === 'generated')?.channel).toBe('otp')
  })

  // Security gate: the plaintext code must not leak into any audit entry.
  it('never writes the OTP code into the audit trail', async () => {
    const { otpService, storage, repo } = await setup()

    await otpService.generate({
      tenantId: TENANT,
      recipient: RECIPIENT,
      purpose: 'email_verification',
      deliverVia: 'email'
    })
    const stored = await storage.get(TENANT, RECIPIENT, 'email_verification')
    const realCode = stored?.code ?? ''

    expect(realCode).toHaveLength(8)
    expect(JSON.stringify(repo.entries)).not.toContain(realCode)
  })

  // A resend inside the cooldown window is blocked and audited as 'cooldown_blocked'.
  it('records cooldown_blocked on a resend within the cooldown window', async () => {
    const { otpService, repo } = await setup({ resendCooldownSeconds: 60 })

    await otpService.generate({
      tenantId: TENANT,
      recipient: RECIPIENT,
      purpose: 'pw',
      deliverVia: 'manual'
    })
    await expect(
      otpService.generate({
        tenantId: TENANT,
        recipient: RECIPIENT,
        purpose: 'pw',
        deliverVia: 'manual'
      })
    ).rejects.toMatchObject({ code: 'notification.otp_cooldown_active' })

    expect(repo.entries.map((entry) => entry.verb)).toContain('cooldown_blocked')
  })

  // Exhausting the attempt ceiling is audited as 'max_attempts_exceeded'.
  it('records max_attempts_exceeded after the attempt ceiling', async () => {
    const { otpService, repo } = await setup({ defaultMaxAttempts: 1 })

    await otpService.generate({
      tenantId: TENANT,
      recipient: RECIPIENT,
      purpose: 'login',
      deliverVia: 'manual'
    })
    // 'O' is excluded from the alpha charset, so this guess can never match.
    const guess = { tenantId: TENANT, recipient: RECIPIENT, purpose: 'login', code: 'WRONGOOO' }
    await otpService.verify(guess)
    const second = await otpService.verify(guess)

    expect(second).toEqual({ valid: false, reason: 'max_attempts' })
    expect(repo.entries.map((entry) => entry.verb)).toContain('max_attempts_exceeded')
  })
})
