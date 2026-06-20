import type {
  EmailSendInput,
  EmailSendTemplateInput,
  EmailService
} from './email.service'
import { NotificationService } from './notification.service'
import type {
  OtpConsumeInput,
  OtpGenerateInput,
  OtpService,
  OtpVerifyInput
} from './otp.service'

const makeEmail = (): jest.Mocked<Pick<EmailService, 'send' | 'sendTemplate' | 'isConfigured'>> => ({
  send: jest.fn(async (_input: EmailSendInput) => ({ messageId: 'raw_1' })),
  sendTemplate: jest.fn(async (_input: EmailSendTemplateInput) => ({ messageId: 'tpl_1' })),
  isConfigured: jest.fn((): boolean => true)
})

const makeOtp = (): jest.Mocked<Pick<OtpService, 'generate' | 'verify' | 'consume' | 'isConfigured'>> => ({
  generate: jest.fn(async (_input: OtpGenerateInput) => ({ expiresAt: 1, cooldownSeconds: 60 })),
  verify: jest.fn(async (_input: OtpVerifyInput) => ({ valid: true as const })),
  consume: jest.fn(async (_input: OtpConsumeInput): Promise<void> => undefined),
  isConfigured: jest.fn((): boolean => true)
})

const build = (
  email?: ReturnType<typeof makeEmail>,
  otp?: ReturnType<typeof makeOtp>
): NotificationService =>
  new NotificationService(email as unknown as EmailService, otp as unknown as OtpService)

describe('NotificationService.dispatch — email', () => {
  // A template payload routes to sendTemplate, forwarding every optional field.
  it('should route a template payload to sendTemplate', async () => {
    const email = makeEmail()
    const result = await build(email).dispatch({
      channel: 'email',
      tenantId: 't',
      payload: {
        to: 'a@x.com',
        template: 'welcome',
        data: { n: 1 },
        locale: 'pt',
        from: 'f@x.com',
        fromName: 'F',
        replyTo: 'r@x.com',
        tags: [{ name: 'k', value: 'v' }],
        userId: 'u'
      }
    })

    // Exact match: every optional field must be forwarded verbatim — pins each
    // conditional-spread so dropping any field (mutant → {}) is caught.
    expect(email.sendTemplate).toHaveBeenCalledWith({
      tenantId: 't',
      to: 'a@x.com',
      template: 'welcome',
      data: { n: 1 },
      locale: 'pt',
      from: 'f@x.com',
      fromName: 'F',
      replyTo: 'r@x.com',
      tags: [{ name: 'k', value: 'v' }],
      userId: 'u'
    })
    expect(result).toEqual({ channel: 'email', messageId: 'tpl_1' })
  })

  // A minimal template payload defaults data to {} and omits every absent field.
  it('should default data to {} for a minimal template payload', async () => {
    const email = makeEmail()
    await build(email).dispatch({
      channel: 'email',
      tenantId: 't',
      payload: { to: 'a@x.com', template: 'welcome' }
    })

    // Exact match: absent optionals must NOT appear (no `locale: undefined` etc.) —
    // pins the conditional spreads from the omission side.
    const sent = email.sendTemplate.mock.calls[0]?.[0]
    expect(sent).toEqual({
      tenantId: 't',
      to: 'a@x.com',
      template: 'welcome',
      data: {}
    })
    // `'key' in obj` distinguishes an absent key from an `undefined`-valued one,
    // which jest's `toEqual` collapses — this pins the `... ? {} : ...` -> always-add
    // (`true`) mutants that would inject `locale: undefined` etc.
    for (const key of ['locale', 'from', 'fromName', 'replyTo', 'tags', 'userId']) {
      expect(key in sent!).toBe(false)
    }
  })

  // A raw payload with subject + html routes to send, forwarding optional fields.
  it('should route a raw subject+html payload to send', async () => {
    const email = makeEmail()
    const result = await build(email).dispatch({
      channel: 'email',
      tenantId: 't',
      payload: {
        to: 'a@x.com',
        subject: 'S',
        html: '<p>H</p>',
        text: 'H',
        from: 'f@x.com',
        fromName: 'F',
        replyTo: 'r@x.com',
        tags: [{ name: 'k', value: 'v' }],
        userId: 'u'
      }
    })

    // Exact match across every optional envelope field (text + the common fields).
    expect(email.send).toHaveBeenCalledWith({
      tenantId: 't',
      to: 'a@x.com',
      subject: 'S',
      html: '<p>H</p>',
      text: 'H',
      from: 'f@x.com',
      fromName: 'F',
      replyTo: 'r@x.com',
      tags: [{ name: 'k', value: 'v' }],
      userId: 'u'
    })
    expect(result).toEqual({ channel: 'email', messageId: 'raw_1' })
  })

  // A minimal raw payload omits every optional field.
  it('should route a minimal subject+html payload to send', async () => {
    const email = makeEmail()
    await build(email).dispatch({
      channel: 'email',
      tenantId: 't',
      payload: { to: 'a@x.com', subject: 'S', html: '<p>H</p>' }
    })

    // Exact match: no `text`/`from`/… keys when their payload fields are absent.
    const sent = email.send.mock.calls[0]?.[0]
    expect(sent).toEqual({ tenantId: 't', to: 'a@x.com', subject: 'S', html: '<p>H</p>' })
    for (const key of ['text', 'from', 'fromName', 'replyTo', 'tags', 'userId']) {
      expect(key in sent!).toBe(false)
    }
  })

  // Neither a template nor subject+html → EMAIL_MISSING_BODY (the recipient is fine;
  // the body source is what's missing, so the error must say so accurately). The
  // details carry a non-empty hint — pins the hint object and string literal.
  it('should throw EMAIL_MISSING_BODY when the payload has no body source', async () => {
    expect.assertions(2)
    try {
      await build(makeEmail()).dispatch({ channel: 'email', tenantId: 't', payload: { to: 'a@x.com' } })
    } catch (error) {
      expect((error as { code: string }).code).toBe('notification.email_missing_body')
      const details = (
        error as { getResponse: () => { error: { details: { hint: string } } } }
      ).getResponse().error.details
      expect(details.hint).toContain('template')
    }
  })

  // A subject without html is still a missing body source.
  it('should throw EMAIL_MISSING_BODY when only subject is provided', async () => {
    await expect(
      build(makeEmail()).dispatch({ channel: 'email', tenantId: 't', payload: { to: 'a@x.com', subject: 'S' } })
    ).rejects.toMatchObject({ code: 'notification.email_missing_body' })
  })

  // Dispatching to email when the channel is absent throws CHANNEL_DISABLED with the
  // channel named in the details — pins the `{ channel: 'email' }` detail object.
  it('should throw CHANNEL_DISABLED when the email channel is absent', async () => {
    expect.assertions(2)
    try {
      await build(undefined, makeOtp()).dispatch({
        channel: 'email',
        tenantId: 't',
        payload: { to: 'a@x.com', template: 'welcome' }
      })
    } catch (error) {
      expect((error as { code: string }).code).toBe('notification.channel_disabled')
      const details = (
        error as { getResponse: () => { error: { details: { channel: string } } } }
      ).getResponse().error.details
      expect(details.channel).toBe('email')
    }
  })
})

describe('NotificationService.dispatch — otp', () => {
  // The default action generates, forwarding every optional field.
  it('should default to generate, forwarding optional fields', async () => {
    const otp = makeOtp()
    const result = await build(makeEmail(), otp).dispatch({
      channel: 'otp',
      tenantId: 't',
      payload: {
        recipient: 'a@x.com',
        purpose: 'email_verification',
        deliverVia: 'email',
        emailTemplate: 'otp_code',
        emailData: { name: 'A' },
        locale: 'en',
        userId: 'u'
      }
    })

    // Exact match: every OTP generate optional must be forwarded verbatim.
    expect(otp.generate).toHaveBeenCalledWith({
      tenantId: 't',
      recipient: 'a@x.com',
      purpose: 'email_verification',
      deliverVia: 'email',
      emailTemplate: 'otp_code',
      emailData: { name: 'A' },
      locale: 'en',
      userId: 'u'
    })
    expect(result).toEqual({ channel: 'otp', result: { expiresAt: 1, cooldownSeconds: 60 } })
  })

  // A minimal generate payload omits all optional fields.
  it('should generate from a minimal payload', async () => {
    const otp = makeOtp()
    await build(makeEmail(), otp).dispatch({
      channel: 'otp',
      tenantId: 't',
      payload: { recipient: 'a@x.com', purpose: 'p' }
    })

    const sent = otp.generate.mock.calls[0]?.[0]
    expect(sent).toEqual({ tenantId: 't', recipient: 'a@x.com', purpose: 'p' })
    for (const key of ['deliverVia', 'emailTemplate', 'emailData', 'locale', 'userId']) {
      expect(key in sent!).toBe(false)
    }
  })

  // The verify action forwards the supplied code.
  it('should route the verify action with the supplied code', async () => {
    const otp = makeOtp()
    await build(makeEmail(), otp).dispatch({
      channel: 'otp',
      tenantId: 't',
      payload: { recipient: 'a@x.com', purpose: 'p', action: 'verify', code: '123456', userId: 'u' }
    })

    // Exact match: the verify ref carries userId only when supplied.
    expect(otp.verify).toHaveBeenCalledWith({
      tenantId: 't',
      recipient: 'a@x.com',
      purpose: 'p',
      code: '123456',
      userId: 'u'
    })
  })

  // A verify action without a code falls back to an empty string (fails closed).
  it('should default a missing verify code to an empty string', async () => {
    const otp = makeOtp()
    await build(makeEmail(), otp).dispatch({
      channel: 'otp',
      tenantId: 't',
      payload: { recipient: 'a@x.com', purpose: 'p', action: 'verify' }
    })

    // Exact: no userId key when the payload omits it — pins the userId spread in
    // the verify ref (the `... ? {} : ...` -> always-add mutant injects undefined).
    const sent = otp.verify.mock.calls[0]?.[0]
    expect(sent).toEqual({ tenantId: 't', recipient: 'a@x.com', purpose: 'p', code: '' })
    expect('userId' in sent!).toBe(false)
  })

  // The consume action routes to consume.
  it('should route the consume action', async () => {
    const otp = makeOtp()
    await build(makeEmail(), otp).dispatch({
      channel: 'otp',
      tenantId: 't',
      payload: { recipient: 'a@x.com', purpose: 'p', action: 'consume' }
    })

    expect(otp.consume).toHaveBeenCalledWith({ tenantId: 't', recipient: 'a@x.com', purpose: 'p' })
  })

  // Dispatching to OTP when the channel is absent throws CHANNEL_DISABLED naming the
  // otp channel in details — pins the `{ channel: 'otp' }` detail object.
  it('should throw CHANNEL_DISABLED when the OTP channel is absent', async () => {
    expect.assertions(2)
    try {
      await build(makeEmail(), undefined).dispatch({
        channel: 'otp',
        tenantId: 't',
        payload: { recipient: 'a@x.com', purpose: 'p' }
      })
    } catch (error) {
      expect((error as { code: string }).code).toBe('notification.channel_disabled')
      const details = (
        error as { getResponse: () => { error: { details: { channel: string } } } }
      ).getResponse().error.details
      expect(details.channel).toBe('otp')
    }
  })
})

describe('NotificationService discovery + accessors', () => {
  // Enabled channels reflect which services are present and configured.
  it('should list both channels when both are configured', () => {
    expect(build(makeEmail(), makeOtp()).getEnabledChannels()).toEqual(['email', 'otp'])
  })

  // With no services injected, no channels are enabled.
  it('should list no channels when none are present', () => {
    expect(new NotificationService().getEnabledChannels()).toEqual([])
  })

  // The throwing accessors return the service when present.
  it('should return the services from getEmail/getOtp when present', () => {
    const email = makeEmail()
    const otp = makeOtp()
    const service = build(email, otp)

    expect(service.getEmail()).toBe(email)
    expect(service.getOtp()).toBe(otp)
  })

  // The throwing accessors throw CHANNEL_DISABLED when the service is absent.
  it('should throw from getEmail/getOtp when absent', () => {
    const service = new NotificationService()

    expect(() => service.getEmail()).toThrow(
      expect.objectContaining({ code: 'notification.channel_disabled' })
    )
    expect(() => service.getOtp()).toThrow(
      expect.objectContaining({ code: 'notification.channel_disabled' })
    )
  })
})
