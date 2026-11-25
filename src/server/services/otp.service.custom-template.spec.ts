/**
 * @fileoverview Specifies that `OtpService.generate` delivers with the email template the caller
 * names, and with the canonical `otp_code` template only when it names none.
 * @layer application
 */
import { resolveOptions } from '../config/resolved-options'
import type { IEmailTemplateRenderer } from '../interfaces/email-template-renderer.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeProvider, makeRenderer } from './__tests__/email-service.fixtures'
import { dummyRepo, ref } from './__tests__/otp-service.fixtures'
import { EmailService } from './email.service'
import { OtpService } from './otp.service'

/** An OTP channel that delivers through an email channel whose renderer is returned for inspection. */
const build = (): {
  service: OtpService
  render: jest.Mocked<IEmailTemplateRenderer>['render']
} => {
  const options = resolveOptions({
    otp: { storage: InMemoryOtpStorage },
    email: { provider: makeProvider(), defaultFrom: 'no-reply@acme.com' },
    audit: { repository: dummyRepo }
  })
  const renderer = makeRenderer()
  const email = new EmailService(options, makeProvider(), renderer, makeAudit())
  const service = new OtpService(options, new InMemoryOtpStorage(), makeAudit(), email)
  return { service, render: renderer.render }
}

describe('OtpService.generate template choice', () => {
  // The template is read by name from the caller's input; a name left out of that read would
  // silently send every code with the default template.
  it('should render the template the caller names', async () => {
    const { service, render } = build()

    await service.generate({ ...ref, emailTemplate: 'invoice_code' })

    expect(render).toHaveBeenCalledTimes(1)
    expect(render.mock.calls[0]?.[0]).toBe('invoice_code')
  })

  it('should render the canonical otp_code template when the caller names none', async () => {
    const { service, render } = build()

    await service.generate({ ...ref })

    expect(render.mock.calls[0]?.[0]).toBe('otp_code')
  })
})
