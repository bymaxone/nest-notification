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

  // Echo discovery reads the WHOLE chain: a wrapper with a generic outer
  // message but the echoed body inside a nested cause must still be caught —
  // reading only the top-level message would pick the raw-cause path with the
  // plaintext aboard.
  it('should scrub an echo living only in a nested cause message', async () => {
    const provider = makeProvider()
    const body = '<p>Hello Jane, Your password reset code is 998877. It expires shortly.</p>'
    provider.send.mockImplementation(async (options) => {
      throw new Error('delivery failed', {
        cause: new Error(`550 rejected - body was: ${options.html.slice(3, 60)}`)
      })
    })
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, html: body })
      .catch((error: unknown) => error)

    const cause = (caught as NotificationException).cause as Error
    const nested = cause.cause as Error
    expect(nested.message).toContain('[redacted]')
    expect(nested.message.includes('998877')).toBe(false)
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

describe('EmailService.send with publishProviderText: false', () => {
  const body = '<p>Hello Jane, your verification code is 883779. It expires shortly.</p>'

  // SECURITY: the case redaction provably cannot cover. The relay quotes the
  // body in BASE64, so no declared value and no echo excerpt matches — and the
  // failure still carries nothing the provider wrote.
  it('should carry no provider text even when the echo is re-encoded', async () => {
    const provider = makeProvider()
    provider.send.mockImplementation(async (options) => {
      const encoded = Buffer.from(options.html, 'utf8').toString('base64')
      throw new Error(`550 5.7.1 refused by policy - body was: ${encoded}`)
    })
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    const caught: unknown = await service
      .send({ ...baseInput, html: body, publishProviderText: false })
      .catch((error: unknown) => error)

    const exception = caught as NotificationException
    expect('cause' in exception).toBe(false)
    const serialized = JSON.stringify(exception.getResponse())
    expect(serialized.includes('883779')).toBe(false)
    expect(serialized.includes('refused by policy')).toBe(false)
    // Decoding what survives must not reconstruct the body either.
    expect(Buffer.from(serialized, 'utf8').toString('base64').includes('883779')).toBe(false)
  })

  // The reply codes ARE published: they are independent of the body, and they
  // are the whole diagnosis an operator acts on.
  it('should publish the reply codes in the details and the audit entry', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('550 5.7.1 refused by policy - body: 883779'))
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    const caught: unknown = await service
      .send({ ...baseInput, html: body, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend', status: 550, enhanced: '5.7.1' })
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        verb: 'failed',
        errorMessage: '[provider text withheld]',
        deliveryStatus: 550,
        deliveryEnhancedStatus: '5.7.1'
      })
    )
  })

  // A failure with no reply code publishes neither field — absent, not
  // `undefined`, so a serializer does not emit empty keys.
  it('should omit both codes when the failure carries none', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:1099'))
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend' })
    const entry = audit.create.mock.calls[0]?.[0]
    expect('deliveryStatus' in entry!).toBe(false)
    expect('deliveryEnhancedStatus' in entry!).toBe(false)
  })

  // Discovery reads the whole chain here too: a wrapper with a generic outer
  // message must not hide the reply code sitting in a nested cause.
  it('should find the reply code in a nested cause', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(
      new Error('delivery failed', { cause: new Error('552 5.2.2 mailbox full') })
    )
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend', status: 552, enhanced: '5.2.2' })
  })

  // The flag reaches the provider so its OWN log line can withhold too — and
  // an absent flag adds no phantom key.
  it('should forward the flag to the provider send options', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    await service.send({ ...baseInput, publishProviderText: false })
    await service.send(baseInput)

    expect(provider.send.mock.calls[0]?.[0]?.publishProviderText).toBe(false)
    expect('publishProviderText' in (provider.send.mock.calls[1]?.[0] ?? {})).toBe(false)
  })

  // A provider that already applied the grammar itself attaches the codes to
  // the error it throws, because its message is a fixed label by then and the
  // service could not parse them back out. The bundled SMTP adapter does this.
  it('should publish codes the provider attached rather than reparsing', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(
      Object.assign(new Error('SMTP send failed'), {
        deliveryStatus: 421,
        deliveryEnhancedStatus: '4.3.0'
      })
    )
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend', status: 421, enhanced: '4.3.0' })
  })

  // Only ONE of the two codes attached: the present half publishes and the
  // absent half stays an absent key, independently of each other.
  it('should publish a lone attached basic code', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(
      Object.assign(new Error('SMTP send failed'), { deliveryStatus: 421 })
    )
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend', status: 421 })
  })

  it('should publish a lone attached enhanced code', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(
      Object.assign(new Error('SMTP send failed'), { deliveryEnhancedStatus: '4.3.0' })
    )
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend', enhanced: '4.3.0' })
  })

  // Attached values of the wrong type are ignored rather than published — the
  // properties come from consumer code and are not trusted by shape alone.
  it('should ignore attached codes of the wrong type', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(
      Object.assign(new Error('550 5.7.1 rejected'), {
        deliveryStatus: 'not-a-number',
        deliveryEnhancedStatus: 42
      })
    )
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    // Falls back to the message grammar, which finds the real codes.
    expect(details).toStrictEqual({ providerName: 'resend', status: 550, enhanced: '5.7.1' })
  })

  // SECURITY: attached values are provider-authored, so type-checking them is
  // not enough — a provider attaching the quoted body as an "enhanced status"
  // would have it published by the one path that promises only the grammar.
  it('should reject attached values that do not match the grammar', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(
      Object.assign(new Error('delivery failed'), {
        deliveryStatus: 998877,
        deliveryEnhancedStatus: 'Your code is 998877, do not share it'
      })
    )
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend' })
    expect(JSON.stringify(audit.create.mock.calls[0]?.[0]).includes('998877')).toBe(false)
  })

  // A non-integer or out-of-class number is not a reply code either.
  it('should reject an attached status outside the reply classes', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(
      Object.assign(new Error('delivery failed'), { deliveryStatus: Number.NaN })
    )
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend' })
  })

  // SECURITY: a short numeric OTP can equal a genuine reply code. Publishing it
  // discloses nothing — the relay answered 550 whatever the code was — but the
  // library's invariant is that a code's characters never reach an audit entry,
  // so a collision with a DECLARED value drops the code rather than the rule.
  it('should drop a reply code that collides with a declared secret', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('550 5.7.1 rejected'))
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false, auditRedactValues: ['550'] })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    // The enhanced code does not collide, so it still publishes.
    expect(details).toStrictEqual({ providerName: 'resend', enhanced: '5.7.1' })
    expect(JSON.stringify(audit.create.mock.calls[0]?.[0]).includes('550')).toBe(false)
  })

  // Declared values present, but the failure carries no basic code: the absent
  // field must stay an absent KEY, not become `status: undefined` on its way
  // through the collision filter.
  it('should not invent a status key when only the enhanced code is present', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('rejected with 5.7.1 and no reply code'))
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false, auditRedactValues: ['998877'] })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend', enhanced: '5.7.1' })
  })

  // A declared value that collides with the ENHANCED code drops that one.
  it('should drop an enhanced code that collides with a declared secret', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('421 5.7.1 rejected'))
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false, auditRedactValues: ['5.7.1'] })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend', status: 421 })
  })

  // A hostile property getter must not escape the read — the failure still
  // resolves through the message grammar.
  it('should fail closed on a hostile attached property', async () => {
    const provider = makeProvider()
    const hostile = new Error('552 5.2.2 mailbox full')
    Object.defineProperty(hostile, 'deliveryStatus', {
      get: (): never => {
        throw new Error('trap')
      }
    })
    provider.send.mockRejectedValue(hostile)
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend', status: 552, enhanced: '5.2.2' })
  })

  // A non-Error rejection has no properties to read; the grammar still applies.
  it('should read the grammar from a non-Error rejection', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue('421 4.3.0 try again later')
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: false })
      .catch((error: unknown) => error)

    const details = (
      caught as { getResponse: () => { error: { details: Record<string, unknown> } } }
    ).getResponse().error.details
    expect(details).toStrictEqual({ providerName: 'resend', status: 421, enhanced: '4.3.0' })
  })

  // Explicit `true` is the documented default and must keep the cause — the
  // flag only ever removes diagnosability when it is exactly `false`.
  it('should keep the cause when the flag is true', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('550 plain failure'))
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, publishProviderText: true })
      .catch((error: unknown) => error)

    expect(((caught as NotificationException).cause as Error).message).toBe('550 plain failure')
  })
})

describe('EmailService.sendTemplate redaction', () => {
  // The flag must ride sendTemplate → send, or the template path — the one OTP
  // delivery uses — silently keeps publishing provider text.
  it('should forward publishProviderText to the inner send input', async () => {
    const service = new EmailService(makeOptions(), makeProvider(), makeRenderer(), makeAudit())
    const sendSpy = jest.spyOn(service, 'send').mockResolvedValue({ messageId: 'm' })

    await service.sendTemplate({
      tenantId: 't',
      to: 'a@x.com',
      template: 'welcome',
      data: {},
      publishProviderText: false
    })
    await service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {} })

    expect(sendSpy.mock.calls[0]?.[0]?.publishProviderText).toBe(false)
    expect('publishProviderText' in (sendSpy.mock.calls[1]?.[0] ?? {})).toBe(false)
  })

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
