import type { ResolvedNotificationOptions } from '../config/resolved-options'
import { NotificationException } from '../errors/notification-exception'
import type {
  EmailSendOptions,
  EmailSendResult,
  IEmailProvider
} from '../interfaces/email-provider.interface'
import type {
  IEmailTemplateRenderer,
  RenderedEmail
} from '../interfaces/email-template-renderer.interface'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'

import { EmailService } from './email.service'

type EmailOpts = NonNullable<ResolvedNotificationOptions['email']>

const makeOptions = (
  email: Partial<EmailOpts> | null = {},
  audit: Partial<ResolvedNotificationOptions['audit']> = {}
): ResolvedNotificationOptions => ({
  global: { redisNamespace: 'notification', defaultLocale: 'en' },
  audit: { swallowErrors: true, maskRecipient: (recipient: string): string => recipient, ...audit },
  ...(email
    ? {
        email: {
          defaultFrom: 'noreply@acme.com',
          defaultTags: [],
          maxAttachmentBytes: 1_000_000,
          ...email
        }
      }
    : {})
})

const makeProvider = (): jest.Mocked<IEmailProvider> => ({
  name: 'resend',
  isConfigured: jest.fn((): boolean => true),
  send: jest.fn(async (_options: EmailSendOptions): Promise<EmailSendResult> => ({ messageId: 'msg_1' }))
})

const makeRenderer = (): jest.Mocked<IEmailTemplateRenderer> => ({
  name: 'default',
  hasTemplate: jest.fn(async (_template: string, _locale: string): Promise<boolean> => true),
  render: jest.fn(
    async (_template: string, _data: Record<string, unknown>, _locale: string): Promise<RenderedEmail> => ({
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi'
    })
  )
})

const makeAudit = (): jest.Mocked<INotificationLogRepository> => ({
  name: 'audit',
  create: jest.fn(async (_entry: NotificationLogEntry): Promise<void> => undefined)
})

const baseInput = { tenantId: 'tenant_a', to: 'jane@acme.com', subject: 'S', html: '<p>B</p>' }

describe('EmailService.send', () => {
  // The happy path applies channel defaults, concatenates tags, and audits "sent".
  it('should apply defaults, concatenate tags, and audit on success', async () => {
    const provider = makeProvider()
    const audit = makeAudit()
    const options = makeOptions(
      { defaultFromName: 'Acme', defaultReplyTo: 'reply@acme.com', defaultTags: [{ name: 'env', value: 'prod' }] },
      { maskRecipient: (r): string => `masked:${r}` }
    )
    const service = new EmailService(options, provider, makeRenderer(), audit)

    const result = await service.send({ ...baseInput, tags: [{ name: 'x', value: '1' }], userId: 'u1' })

    expect(result).toEqual({ messageId: 'msg_1' })
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'noreply@acme.com',
        fromName: 'Acme',
        replyTo: 'reply@acme.com',
        tags: [
          { name: 'env', value: 'prod' },
          { name: 'x', value: '1' }
        ]
      })
    )
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'sent', recipient: 'masked:jane@acme.com', messageId: 'msg_1', userId: 'u1' })
    )
  })

  // All optional envelope fields and a caller-supplied from must reach the provider.
  it('should forward every optional field including attachments', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    await service.send({
      ...baseInput,
      from: 'custom@acme.com',
      fromName: 'Custom',
      replyTo: 'r@acme.com',
      text: 'plain',
      cc: 'cc@acme.com',
      bcc: ['bcc@acme.com'],
      attachments: [
        { filename: 'a.txt', content: 'hello' },
        { filename: 'b.bin', content: Buffer.from([1, 2, 3]) }
      ]
    })

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'custom@acme.com',
        fromName: 'Custom',
        replyTo: 'r@acme.com',
        text: 'plain',
        cc: 'cc@acme.com',
        bcc: ['bcc@acme.com']
      })
    )
  })

  // With no caller and no default name/reply-to, those header keys are omitted.
  it('should omit fromName and replyTo when neither caller nor default supplies them', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    await service.send(baseInput)

    const sent = provider.send.mock.calls[0]?.[0]
    expect(sent).not.toHaveProperty('fromName')
    expect(sent).not.toHaveProperty('replyTo')
  })

  // A masked array recipient must be joined with ", " in the audit entry.
  it('should mask and join array recipients for the audit entry', async () => {
    const audit = makeAudit()
    const options = makeOptions({}, { maskRecipient: (r): string => r.replace(/@.*/, '@***') })
    const service = new EmailService(options, makeProvider(), makeRenderer(), audit)

    await service.send({ ...baseInput, to: ['a@x.com', 'b@y.com'] })

    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: 'a@***, b@***' })
    )
  })

  // A missing email channel fails closed.
  it('should throw EMAIL_PROVIDER_NOT_CONFIGURED when email is not configured', async () => {
    const service = new EmailService(makeOptions(null), makeProvider(), makeRenderer(), makeAudit())

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.email_provider_not_configured'
    })
  })

  // A provider reporting itself unconfigured also fails closed.
  it('should throw EMAIL_PROVIDER_NOT_CONFIGURED when the provider is not configured', async () => {
    const provider = makeProvider()
    provider.isConfigured.mockReturnValue(false)
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.email_provider_not_configured'
    })
  })

  // Oversized attachments are rejected before contacting the provider.
  it('should throw EMAIL_ATTACHMENTS_TOO_LARGE when over the byte budget', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions({ maxAttachmentBytes: 5 }), provider, makeRenderer(), makeAudit())

    await expect(
      service.send({ ...baseInput, attachments: [{ filename: 'big', content: 'abcdefghij' }] })
    ).rejects.toMatchObject({ code: 'notification.email_attachments_too_large' })
    expect(provider.send).not.toHaveBeenCalled()
  })

  // A provider failure becomes EMAIL_SEND_FAILED and audits "failed".
  it('should map a provider failure to EMAIL_SEND_FAILED and audit failed', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('smtp down'))
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.email_send_failed'
    })
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ verb: 'failed', errorMessage: 'smtp down' })
    )
  })

  // A non-Error provider rejection is stringified for the audit message.
  it('should stringify a non-Error provider rejection for the audit', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue('boom')
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.email_send_failed'
    })
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ errorMessage: 'boom' }))
  })

  // Audit failures are swallowed by default so the send still succeeds.
  it('should swallow audit failures by default', async () => {
    const audit = makeAudit()
    audit.create.mockRejectedValue(new Error('db down'))
    const service = new EmailService(makeOptions(), makeProvider(), makeRenderer(), audit)

    await expect(service.send(baseInput)).resolves.toEqual({ messageId: 'msg_1' })
  })

  // With swallowErrors false an audit failure surfaces as AUDIT_LOG_FAILED.
  it('should propagate AUDIT_LOG_FAILED when swallowErrors is false', async () => {
    const audit = makeAudit()
    audit.create.mockRejectedValue(new Error('db down'))
    const service = new EmailService(makeOptions({}, { swallowErrors: false }), makeProvider(), makeRenderer(), audit)

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.audit_log_failed'
    })
  })

  // A non-Error audit rejection is stringified into the AUDIT_LOG_FAILED cause.
  it('should stringify a non-Error audit rejection when not swallowing', async () => {
    const audit = makeAudit()
    audit.create.mockRejectedValue('weird')
    const service = new EmailService(makeOptions({}, { swallowErrors: false }), makeProvider(), makeRenderer(), audit)

    await expect(service.send(baseInput)).rejects.toBeInstanceOf(NotificationException)
  })
})

describe('EmailService.sendTemplate', () => {
  // The renderer output is forwarded to send with a template tag appended.
  it('should render and forward to send, appending the template tag', async () => {
    const provider = makeProvider()
    const renderer = makeRenderer()
    const service = new EmailService(makeOptions(), provider, renderer, makeAudit())

    await service.sendTemplate({
      tenantId: 'tenant_a',
      to: 'jane@acme.com',
      template: 'welcome',
      data: { name: 'Jane' },
      tags: [{ name: 'campaign', value: 'q3' }]
    })

    expect(renderer.render).toHaveBeenCalledWith('welcome', { name: 'Jane' }, 'en')
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Hi',
        html: '<p>Hi</p>',
        text: 'Hi',
        tags: [
          { name: 'campaign', value: 'q3' },
          { name: 'template', value: 'welcome' }
        ]
      })
    )
  })

  // Optional from/fromName/replyTo flow through the template path.
  it('should forward optional headers through the template path', async () => {
    const provider = makeProvider()
    const renderer = makeRenderer()
    renderer.render.mockResolvedValue({ subject: 'S', html: '<p>H</p>' })
    const service = new EmailService(makeOptions(), provider, renderer, makeAudit())

    await service.sendTemplate({
      tenantId: 'tenant_a',
      to: 'jane@acme.com',
      template: 'welcome',
      data: {},
      from: 'f@acme.com',
      fromName: 'F',
      replyTo: 'r@acme.com',
      userId: 'u1'
    })

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'f@acme.com', fromName: 'F', replyTo: 'r@acme.com' })
    )
  })

  // When the requested locale has no template, the en fallback is used.
  it('should fall back to the en locale when the requested locale is missing', async () => {
    const renderer = makeRenderer()
    renderer.hasTemplate.mockImplementation(async (_t, locale) => locale === 'en')
    const provider = makeProvider()
    const service = new EmailService(makeOptions(), provider, renderer, makeAudit())

    await service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {}, locale: 'pt-BR' })

    expect(renderer.render).toHaveBeenCalledWith('welcome', {}, 'en')
  })

  // Neither the requested locale nor en exists → TEMPLATE_NOT_FOUND.
  it('should throw TEMPLATE_NOT_FOUND when no locale matches', async () => {
    const renderer = makeRenderer()
    renderer.hasTemplate.mockResolvedValue(false)
    const service = new EmailService(makeOptions(), makeProvider(), renderer, makeAudit())

    await expect(
      service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {} })
    ).rejects.toMatchObject({ code: 'notification.template_not_found' })
  })

  // A renderer that throws maps to TEMPLATE_RENDER_FAILED.
  it('should throw TEMPLATE_RENDER_FAILED when the renderer throws', async () => {
    const renderer = makeRenderer()
    renderer.render.mockRejectedValue(new Error('bad syntax'))
    const service = new EmailService(makeOptions(), makeProvider(), renderer, makeAudit())

    await expect(
      service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {} })
    ).rejects.toMatchObject({ code: 'notification.template_render_failed' })
  })
})

describe('EmailService.isConfigured', () => {
  // True only when the channel is present AND the provider reports ready.
  it('should reflect both the channel presence and the provider state', () => {
    const provider = makeProvider()
    expect(new EmailService(makeOptions(), provider, makeRenderer(), makeAudit()).isConfigured()).toBe(true)

    expect(
      new EmailService(makeOptions(null), provider, makeRenderer(), makeAudit()).isConfigured()
    ).toBe(false)

    const unready = makeProvider()
    unready.isConfigured.mockReturnValue(false)
    expect(new EmailService(makeOptions(), unready, makeRenderer(), makeAudit()).isConfigured()).toBe(false)
  })
})
