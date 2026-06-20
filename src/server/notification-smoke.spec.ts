import { Test } from '@nestjs/testing'

import { BymaxNotificationModule } from './bymax-notification.module'
import { DefaultTemplateRenderer } from './providers/default-template-renderer'
import { InMemoryOtpStorage } from './providers/in-memory-otp.storage'
import { NoOpEmailProvider } from './providers/no-op-email.provider'
import { EmailService } from './services/email.service'
import { OtpService } from './services/otp.service'

/**
 * End-to-end smoke: a NoOp email provider + the default template renderer + the
 * in-memory OTP storage, wired through the real dynamic module, must support a raw
 * email send, an email-delivered OTP generation, and a status read.
 */
describe('notification end-to-end smoke', () => {
  const renderer = new DefaultTemplateRenderer({
    templates: {
      'otp_code::en': { subject: 'Your code', html: '<p>Code: {{code}}</p>' }
    }
  })

  const buildApp = async (): Promise<{ email: EmailService; otp: OtpService }> => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRoot({
          email: {
            provider: new NoOpEmailProvider(),
            defaultFrom: 'noreply@acme.com',
            templateRenderer: renderer
          },
          otp: { storage: new InMemoryOtpStorage() }
        })
      ]
    }).compile()
    return { email: moduleRef.get(EmailService), otp: moduleRef.get(OtpService) }
  }

  // A raw email send flows through the module to the NoOp provider.
  it('should send a raw email and return a messageId', async () => {
    const { email } = await buildApp()

    const result = await email.send({
      tenantId: 'tenant_a',
      to: 'jane@acme.com',
      subject: 'Hello',
      html: '<p>Hi</p>'
    })

    expect(result.messageId).toMatch(/^noop-/)
  })

  // An email-delivered OTP generates, then its status reports a live entry.
  it('should generate an email OTP and report its status', async () => {
    const { otp } = await buildApp()

    const generated = await otp.generate({
      tenantId: 'tenant_a',
      recipient: 'jane@acme.com',
      purpose: 'email_verification',
      deliverVia: 'email'
    })
    const status = await otp.getStatus({
      tenantId: 'tenant_a',
      recipient: 'jane@acme.com',
      purpose: 'email_verification'
    })

    expect(generated.expiresAt).toBeGreaterThan(Date.now())
    expect(generated.cooldownSeconds).toBe(60)
    expect(status).toMatchObject({ exists: true, attempts: 0, maxAttempts: 5 })
    expect(status).not.toHaveProperty('code')
  })
})
