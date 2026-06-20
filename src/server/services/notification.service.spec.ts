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

    expect(email.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'welcome', data: { n: 1 }, locale: 'pt', from: 'f@x.com', userId: 'u' })
    )
    expect(result).toEqual({ channel: 'email', messageId: 'tpl_1' })
  })

  // A minimal template payload defaults data to {} and omits absent fields.
  it('should default data to {} for a minimal template payload', async () => {
    const email = makeEmail()
    await build(email).dispatch({
      channel: 'email',
      tenantId: 't',
      payload: { to: 'a@x.com', template: 'welcome' }
    })

    expect(email.sendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ template: 'welcome', data: {} })
    )
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

    expect(email.send).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'S', html: '<p>H</p>', text: 'H', from: 'f@x.com', userId: 'u' })
    )
    expect(result).toEqual({ channel: 'email', messageId: 'raw_1' })
  })

  // A minimal raw payload omits all optional fields.
  it('should route a minimal subject+html payload to send', async () => {
    const email = makeEmail()
    await build(email).dispatch({
      channel: 'email',
      tenantId: 't',
      payload: { to: 'a@x.com', subject: 'S', html: '<p>H</p>' }
    })

    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ subject: 'S', html: '<p>H</p>' }))
  })

  // Neither a template nor subject+html → EMAIL_MISSING_BODY (the recipient is fine;
  // the body source is what's missing, so the error must say so accurately).
  it('should throw EMAIL_MISSING_BODY when the payload has no body source', async () => {
    await expect(
      build(makeEmail()).dispatch({ channel: 'email', tenantId: 't', payload: { to: 'a@x.com' } })
    ).rejects.toMatchObject({ code: 'notification.email_missing_body' })
  })

  // A subject without html is still a missing body source.
  it('should throw EMAIL_MISSING_BODY when only subject is provided', async () => {
    await expect(
      build(makeEmail()).dispatch({ channel: 'email', tenantId: 't', payload: { to: 'a@x.com', subject: 'S' } })
    ).rejects.toMatchObject({ code: 'notification.email_missing_body' })
  })

  // Dispatching to email when the channel is absent throws CHANNEL_DISABLED.
  it('should throw CHANNEL_DISABLED when the email channel is absent', async () => {
    await expect(
      build(undefined, makeOtp()).dispatch({
        channel: 'email',
        tenantId: 't',
        payload: { to: 'a@x.com', template: 'welcome' }
      })
    ).rejects.toMatchObject({ code: 'notification.channel_disabled' })
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

    expect(otp.generate).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'a@x.com', deliverVia: 'email', emailData: { name: 'A' }, userId: 'u' })
    )
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

    expect(otp.generate).toHaveBeenCalledWith({ tenantId: 't', recipient: 'a@x.com', purpose: 'p' })
  })

  // The verify action forwards the supplied code.
  it('should route the verify action with the supplied code', async () => {
    const otp = makeOtp()
    await build(makeEmail(), otp).dispatch({
      channel: 'otp',
      tenantId: 't',
      payload: { recipient: 'a@x.com', purpose: 'p', action: 'verify', code: '123456', userId: 'u' }
    })

    expect(otp.verify).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'a@x.com', code: '123456', userId: 'u' })
    )
  })

  // A verify action without a code falls back to an empty string (fails closed).
  it('should default a missing verify code to an empty string', async () => {
    const otp = makeOtp()
    await build(makeEmail(), otp).dispatch({
      channel: 'otp',
      tenantId: 't',
      payload: { recipient: 'a@x.com', purpose: 'p', action: 'verify' }
    })

    expect(otp.verify).toHaveBeenCalledWith(expect.objectContaining({ code: '' }))
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

  // Dispatching to OTP when the channel is absent throws CHANNEL_DISABLED.
  it('should throw CHANNEL_DISABLED when the OTP channel is absent', async () => {
    await expect(
      build(makeEmail(), undefined).dispatch({
        channel: 'otp',
        tenantId: 't',
        payload: { recipient: 'a@x.com', purpose: 'p' }
      })
    ).rejects.toMatchObject({ code: 'notification.channel_disabled' })
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
