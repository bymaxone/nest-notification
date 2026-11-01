/**
 * @fileoverview Specifies how `EmailService` answers whether a template resolves for a locale,
 * and what a `TEMPLATE_NOT_FOUND` for the OTP default tells the host to do. The probe is the one
 * `sendTemplate` uses, so the answer given at startup is the answer a send would get.
 * @layer application
 */
import type { NotificationException } from '../errors/notification-exception'

import {
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

const build = (
  hasTemplate: (template: string, locale: string) => Promise<boolean>
): { service: EmailService; probe: jest.Mock } => {
  const renderer = makeRenderer()
  const probe = jest.fn(hasTemplate)
  renderer.hasTemplate.mockImplementation(probe)
  return {
    service: new EmailService(makeOptions(), makeProvider(), renderer, makeAudit()),
    probe
  }
}

const details = (error: unknown): Record<string, unknown> =>
  (error as { getResponse: () => { error: { details: Record<string, unknown> } } }).getResponse()
    .error.details

describe('EmailService.resolvesTemplate', () => {
  // The requested locale answers first and the fallback is never asked.
  it('should resolve from the requested locale without asking the fallback', async () => {
    const { service, probe } = build(async (_t, locale) => locale === 'pt-BR')

    await expect(service.resolvesTemplate('otp_code', 'pt-BR')).resolves.toBe(true)
    expect(probe.mock.calls).toEqual([['otp_code', 'pt-BR']])
  })

  // The same order sendTemplate uses: requested locale, then en.
  it('should fall back to en when the requested locale has none', async () => {
    const { service, probe } = build(async (_t, locale) => locale === 'en')

    await expect(service.resolvesTemplate('otp_code', 'pt-BR')).resolves.toBe(true)
    expect(probe.mock.calls).toEqual([
      ['otp_code', 'pt-BR'],
      ['otp_code', 'en']
    ])
  })

  // A renderer's answer is a promise; a promise is truthy, so the answer must be awaited.
  it('should answer false when the renderer resolves false for both locales', async () => {
    const { service, probe } = build(() => Promise.resolve(false))

    await expect(service.resolvesTemplate('otp_code', 'pt-BR')).resolves.toBe(false)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  // sendTemplate probes en twice when en is also the requested locale; the check mirrors it.
  it('should probe exactly as sendTemplate does when the requested locale is en', async () => {
    const check = build(async () => false)
    const send = build(async () => false)

    await check.service.resolvesTemplate('otp_code', 'en')
    await send.service
      .sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'otp_code', data: {}, locale: 'en' })
      .catch(() => undefined)

    expect(check.probe.mock.calls).toEqual(send.probe.mock.calls)
  })
})

describe('EmailService TEMPLATE_NOT_FOUND', () => {
  const missing = async (template: string): Promise<unknown> => {
    const { service } = build(async () => false)
    return service
      .sendTemplate({ tenantId: 't', to: 'a@x.com', template, data: {}, locale: 'fr' })
      .catch((error: unknown) => error)
  }

  // The OTP default is the one template a host does not name, so the error names the way out.
  it('should name the way out when the missing template is the OTP default', async () => {
    const error = await missing('otp_code')

    expect(details(error)).toEqual({
      template: 'otp_code',
      locale: 'fr',
      remedy: expect.stringContaining('DefaultTemplateRenderer')
    })
    expect(details(error).remedy).toContain("'otp_code'")
    expect(details(error).remedy).toContain('emailTemplate')
  })

  // The sentence is read by whoever hit the error, from generate() or from a direct
  // sendTemplate('otp_code'), so it names where emailTemplate applies instead of telling the
  // caller to pass it. Pinned by value.
  it('should give the same remedy to a direct sendTemplate of the OTP template', async () => {
    const error = await missing('otp_code')

    expect(details(error).remedy).toBe(
      "register an 'otp_code' template (for example 'otp_code::en') in your template renderer, such as " +
        'DefaultTemplateRenderer; the OTP email can use another template through the emailTemplate ' +
        'option of generate()'
    )
  })

  // The remedy is specific to the OTP default: every other template's error carries exactly
  // `template` and `locale`.
  it('should keep exactly template and locale for any other template', async () => {
    const error = await missing('welcome')

    expect(details(error)).toStrictEqual({ template: 'welcome', locale: 'fr' })
  })
})
