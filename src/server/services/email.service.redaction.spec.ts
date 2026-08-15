/**
 * @fileoverview Redaction-focused specs for EmailService: scrubbing declared
 * secrets and echoed body content from the failed-audit entry and from the
 * outgoing `Error.cause`. The core send/sendTemplate behavior lives in
 * `email.service.spec.ts`; shared fixtures in `__tests__/email-service.fixtures.ts`.
 * @layer application
 */

import { NotificationException } from '../errors/notification-exception'

import {
  baseInput,
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

describe('EmailService.send redaction', () => {
  // SECURITY (regression for the community-core finding on 1.2.0): a provider
  // error that ECHOES the rendered body — a policy/DLP relay quoting the
  // rejected content in a 550 — carried the body's secret into the attached
  // cause even though the caller declared nothing. Detected echoes are now
  // scrubbed from the outgoing cause.
  it('should scrub echoed body content from the cause without declared values', async () => {
    const provider = makeProvider()
    const body = '<p>Hello Jane, Your password reset code is 998877. It expires shortly.</p>'
    provider.send.mockImplementation(async (options) => {
      throw new Error(
        `Message failed: 550 5.7.1 rejected by policy - message body was: ${options.html.slice(3, 60)}`
      )
    })
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    const caught: unknown = await service
      .send({ ...baseInput, html: body })
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(NotificationException)
    const cause = (caught as NotificationException).cause as Error
    expect(cause.message).toContain('550 5.7.1 rejected by policy')
    expect(cause.message).toContain('[redacted]')
    expect(cause.message.includes('998877')).toBe(false)
    expect(cause.stack?.includes('998877')).toBe(false)
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        verb: 'failed',
        errorMessage: expect.not.stringContaining('998877')
      })
    )
  })

  // The PLAIN-TEXT body is an echo reference too — a relay may quote the text
  // part rather than the HTML part.
  it('should scrub content echoed from the plain-text body', async () => {
    const provider = makeProvider()
    provider.send.mockImplementation(async (options) => {
      throw new Error(`550 rejected - body: ${String(options.text).slice(0, 40)}`)
    })
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, text: 'Plain text: your reset code is 998877 today' })
      .catch((error: unknown) => error)

    const cause = (caught as NotificationException).cause as Error
    expect(cause.message).toContain('[redacted]')
    expect(cause.message.includes('998877')).toBe(false)
  })

  // With no declared values AND no echo, the raw error passes through as the
  // cause untouched — including its own properties. Pins the empty-values gate
  // so unrelated transport errors keep full diagnosability.
  it('should pass a non-echoing provider error through as the raw cause', async () => {
    const provider = makeProvider()
    const providerError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1099'), {
      syscall: 'connect'
    })
    provider.send.mockRejectedValue(providerError)
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service.send(baseInput).catch((error: unknown) => error)

    const cause = (caught as NotificationException).cause as Error
    expect(cause.message).toBe('connect ECONNREFUSED 127.0.0.1:1099')
    // The original error object was not mutated by any scrub.
    expect(providerError.syscall).toBe('connect')
  })

  // Declared values are scrubbed from the cause too — the audit errorMessage
  // was covered since 1.2.0, but the cause carried the secret onward.
  it('should scrub declared values from the outgoing cause', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('relay said: your code 998877 was rejected'))
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, auditRedactValues: ['998877'] })
      .catch((error: unknown) => error)

    const cause = (caught as NotificationException).cause as Error
    expect(cause.message).toBe('relay said: your code [redacted] was rejected')
  })

  // Declared values reach the PROVIDER as `redactValues` so its own error
  // logging can scrub them; absent declaration adds no phantom key.
  it('should forward declared values to the provider send options', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    await service.send({ ...baseInput, auditRedactValues: ['998877'] })
    await service.send(baseInput)

    expect(provider.send.mock.calls[0]?.[0]?.redactValues).toEqual(['998877'])
    expect('redactValues' in (provider.send.mock.calls[1]?.[0] ?? {})).toBe(false)
  })

  // SECURITY: a provider failure that echoes a declared secret value back must
  // have it redacted from the failed-audit errorMessage — the caller names the
  // secrets via `auditRedactValues` because only the caller knows them.
  it('should redact declared values from the failed-audit errorMessage', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('rejected body with 998877 inside'))
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    await service.send({ ...baseInput, auditRedactValues: ['998877'] }).catch(() => undefined)

    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        verb: 'failed',
        errorMessage: 'rejected body with [redacted] inside'
      })
    )
  })

  // SECURITY (regression): a provider error whose `message` getter throws must
  // not escape unaudited — the audit read fails closed to the marker and the
  // send still maps to EMAIL_SEND_FAILED.
  it('should fail closed when the provider error message getter throws', async () => {
    const provider = makeProvider()
    const hostile = new Error('shell')
    Object.defineProperty(hostile, 'message', {
      get: (): never => {
        throw new Error('getter leaked 998877')
      }
    })
    provider.send.mockRejectedValue(hostile)
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.email_send_failed'
    })
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'failed', errorMessage: '[redacted]' })
    )
  })
})

describe('EmailService.sendTemplate redaction', () => {
  // A renderer error can echo the template data (which carries the caller's
  // secret); declared values are scrubbed from the TEMPLATE_RENDER_FAILED
  // cause too.
  it('should scrub declared values from a render-failure cause', async () => {
    const renderer = makeRenderer()
    renderer.render.mockRejectedValue(new Error('cannot interpolate: code=998877'))
    const service = new EmailService(makeOptions(), makeProvider(), renderer, makeAudit())

    const caught: unknown = await service
      .sendTemplate({
        tenantId: 't',
        to: 'a@x.com',
        template: 'otp',
        data: { code: '998877' },
        auditRedactValues: ['998877']
      })
      .catch((error: unknown) => error)

    const cause = (caught as NotificationException).cause as Error
    expect(cause.message).toBe('cannot interpolate: code=[redacted]')
  })

  // Declared secret values must ride sendTemplate → send so the failed-audit
  // redaction works on the template path (the one OTP delivery uses).
  it('should forward auditRedactValues to the inner send input', async () => {
    const renderer = makeRenderer()
    const service = new EmailService(makeOptions(), makeProvider(), renderer, makeAudit())
    const sendSpy = jest.spyOn(service, 'send').mockResolvedValue({ messageId: 'm' })

    await service.sendTemplate({
      tenantId: 't',
      to: 'a@x.com',
      template: 'welcome',
      data: {},
      auditRedactValues: ['998877']
    })

    expect(sendSpy.mock.calls[0]?.[0]?.auditRedactValues).toEqual(['998877'])
  })
})
