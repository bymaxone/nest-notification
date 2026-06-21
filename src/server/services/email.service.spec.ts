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
    // Exact audit shape (minus the volatile timestamp): pins the messageId and
    // userId conditional spreads in the audit-entry builder.
    const sentEntry = audit.create.mock.calls[0]?.[0]
    expect(sentEntry).toMatchObject({
      channel: 'email',
      verb: 'sent',
      recipient: 'masked:jane@acme.com',
      providerName: 'resend',
      messageId: 'msg_1',
      userId: 'u1'
    })
    expect('errorMessage' in sentEntry!).toBe(false)
  })

  // A NotificationException thrown inside send (e.g. attachments too large, raised
  // before the provider call) is rethrown verbatim — never remapped to
  // EMAIL_SEND_FAILED and never audited as a provider "failed". Pins the
  // `error instanceof NotificationException` rethrow branch.
  it('should rethrow a NotificationException without remapping or auditing failed', async () => {
    const provider = makeProvider()
    const audit = makeAudit()
    const service = new EmailService(makeOptions({ maxAttachmentBytes: 1 }), provider, makeRenderer(), audit)

    await expect(
      service.send({ ...baseInput, attachments: [{ filename: 'big', content: 'toolong' }] })
    ).rejects.toMatchObject({ code: 'notification.email_attachments_too_large' })
    expect(audit.create).not.toHaveBeenCalledWith(expect.objectContaining({ verb: 'failed' }))
  })

  // All optional envelope fields and a caller-supplied from must reach the provider.
  it('should forward every optional field including attachments', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const attachments = [
      { filename: 'a.txt', content: 'hello' },
      { filename: 'b.bin', content: Buffer.from([1, 2, 3]) }
    ]
    await service.send({
      ...baseInput,
      from: 'custom@acme.com',
      fromName: 'Custom',
      replyTo: 'r@acme.com',
      text: 'plain',
      cc: 'cc@acme.com',
      bcc: ['bcc@acme.com'],
      attachments
    })

    // Exact match: every optional field — including cc/bcc/attachments and the
    // default-tag concatenation — must be forwarded, so dropping any spread fails.
    expect(provider.send).toHaveBeenCalledWith({
      to: 'jane@acme.com',
      from: 'custom@acme.com',
      subject: 'S',
      html: '<p>B</p>',
      tags: [],
      fromName: 'Custom',
      replyTo: 'r@acme.com',
      text: 'plain',
      cc: 'cc@acme.com',
      bcc: ['bcc@acme.com'],
      attachments
    })
  })

  // Attachments exactly at the byte budget are accepted — pins the `> maxBytes`
  // boundary so a `>= maxBytes` mutant (which would reject the exact size) dies.
  // A string content of length 5 is 5 bytes; the budget is 5.
  it('should accept attachments exactly at the byte budget', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions({ maxAttachmentBytes: 5 }), provider, makeRenderer(), makeAudit())

    await expect(
      service.send({ ...baseInput, attachments: [{ filename: 'edge', content: 'abcde' }] })
    ).resolves.toEqual({ messageId: 'msg_1' })
    expect(provider.send).toHaveBeenCalledTimes(1)
  })

  // A Buffer attachment is measured by its byte length (`content.length`), not the
  // string path — pins the `typeof content === 'string'` branch. Three bytes are
  // under the budget of 3? No: exactly 3, which must pass; four bytes must fail.
  it('should measure Buffer attachment size by byte length', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions({ maxAttachmentBytes: 3 }), provider, makeRenderer(), makeAudit())

    await expect(
      service.send({ ...baseInput, attachments: [{ filename: 'buf', content: Buffer.from([1, 2, 3, 4]) }] })
    ).rejects.toMatchObject({ code: 'notification.email_attachments_too_large' })
    expect(provider.send).not.toHaveBeenCalled()
  })

  // A multi-byte string is measured by its UTF-8 BYTE length, not its UTF-16 char
  // length — pins the `typeof content === 'string' ? Buffer.byteLength(...) :
  // content.length` ternary. '😀' is 2 UTF-16 code units but 4 UTF-8 bytes; a budget
  // of 3 must reject it. A `.length` mutant (which would see 2 ≤ 3) lets it through.
  it('should measure a multi-byte string attachment by UTF-8 byte length', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions({ maxAttachmentBytes: 3 }), provider, makeRenderer(), makeAudit())

    await expect(
      service.send({ ...baseInput, attachments: [{ filename: 'emoji', content: '😀' }] })
    ).rejects.toMatchObject({ code: 'notification.email_attachments_too_large' })
    expect(provider.send).not.toHaveBeenCalled()
  })

  // The EMAIL_ATTACHMENTS_TOO_LARGE error carries the offending total and the limit
  // in its details — pins the `{ totalBytes, limit }` detail object against an
  // emptied-object mutant. 'abcdefghij' is 10 bytes; the budget is 5.
  it('should include totalBytes and limit in the EMAIL_ATTACHMENTS_TOO_LARGE details', async () => {
    const service = new EmailService(makeOptions({ maxAttachmentBytes: 5 }), makeProvider(), makeRenderer(), makeAudit())

    expect.assertions(2)
    try {
      await service.send({ ...baseInput, attachments: [{ filename: 'big', content: 'abcdefghij' }] })
    } catch (error) {
      const details = (
        error as { getResponse: () => { error: { details: Record<string, unknown> } } }
      ).getResponse().error.details
      expect(details.totalBytes).toBe(10)
      expect(details.limit).toBe(5)
    }
  })

  // With no caller and no default name/reply-to, those header keys are omitted.
  it('should omit fromName and replyTo when neither caller nor default supplies them', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    await service.send(baseInput)

    const sent = provider.send.mock.calls[0]?.[0]
    // Every optional that the minimal input omits must be absent as a KEY (not just
    // `undefined`) — pins each conditional spread's omission branch against the
    // always-add (`true`) mutant that would inject `key: undefined`.
    for (const key of ['fromName', 'replyTo', 'text', 'cc', 'bcc', 'attachments']) {
      expect(key in sent!).toBe(false)
    }
  })

  // A failed send audits an entry that carries errorMessage but no messageId/userId
  // — pins the messageId/userId/errorMessage conditional spreads in the audit builder.
  it('should build the failed audit entry with errorMessage and without messageId', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('smtp down'))
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.email_send_failed'
    })
    const failedEntry = audit.create.mock.calls[0]?.[0]
    expect(failedEntry).toMatchObject({ verb: 'failed', errorMessage: 'smtp down' })
    expect('messageId' in failedEntry!).toBe(false)
    expect('userId' in failedEntry!).toBe(false)
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

  // A provider failure becomes EMAIL_SEND_FAILED and audits "failed". The rethrown
  // exception carries the provider name in its details — pins the `{ providerName }`
  // detail object against an emptied-object mutant.
  it('should map a provider failure to EMAIL_SEND_FAILED and audit failed', async () => {
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('smtp down'))
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    expect.assertions(3)
    try {
      await service.send(baseInput)
    } catch (error) {
      expect((error as NotificationException).code).toBe('notification.email_send_failed')
      const details = (
        error as { getResponse: () => { error: { details: Record<string, unknown> } } }
      ).getResponse().error.details
      expect(details.providerName).toBe('resend')
    }
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

  // With swallowErrors false an audit failure surfaces as AUDIT_LOG_FAILED carrying
  // the underlying cause — pins the `{ cause }` detail object on the rethrow.
  it('should propagate AUDIT_LOG_FAILED when swallowErrors is false', async () => {
    const audit = makeAudit()
    audit.create.mockRejectedValue(new Error('db down'))
    const service = new EmailService(makeOptions({}, { swallowErrors: false }), makeProvider(), makeRenderer(), audit)

    expect.assertions(2)
    try {
      await service.send(baseInput)
    } catch (error) {
      expect((error as NotificationException).code).toBe('notification.audit_log_failed')
      const details = (
        error as { getResponse: () => { error: { details: Record<string, unknown> } } }
      ).getResponse().error.details
      expect(details.cause).toBe('db down')
    }
  })

  // When the SUCCESS-path audit throws AUDIT_LOG_FAILED (a NotificationException) and
  // only that first audit call fails, the catch must RETHROW it verbatim — not fall
  // through to a second audit + EMAIL_SEND_FAILED. Pins the `instanceof
  // NotificationException` rethrow guard inside the provider catch.
  it('should rethrow a NotificationException raised by the success-path audit', async () => {
    const provider = makeProvider()
    const audit = makeAudit()
    // First (success) audit write fails; any later write succeeds.
    audit.create.mockRejectedValueOnce(new Error('db down')).mockResolvedValue(undefined)
    const service = new EmailService(makeOptions({}, { swallowErrors: false }), provider, makeRenderer(), audit)

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.audit_log_failed'
    })
    // The provider DID succeed; the failure came from the audit, so no EMAIL_SEND_FAILED.
    expect(provider.send).toHaveBeenCalledTimes(1)
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
    // The minimal template payload supplies no from-override/fromName/replyTo/userId,
    // so those keys must be ABSENT in the inner send input — pins the omission side
    // of the template-path conditional spreads against the always-add mutants.
    const inner = provider.send.mock.calls[0]?.[0]
    for (const key of ['fromName', 'replyTo', 'userId']) {
      expect(key in inner!).toBe(false)
    }
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

    // Exact match: the send input built by sendTemplate carries from/fromName/replyTo
    // /userId; the renderer returned no `text`, so `text` must be ABSENT — pins both
    // sides of every conditional spread in the template path.
    const sent = provider.send.mock.calls[0]?.[0]
    expect(sent?.from).toBe('f@acme.com')
    expect(sent?.fromName).toBe('F')
    expect(sent?.replyTo).toBe('r@acme.com')
    expect('text' in sent!).toBe(false)
  })

  // userId supplied to sendTemplate must reach the inner send() and thus the audit
  // entry — pins the userId conditional spread in the template path (the inner send
  // input is not directly observable, but the audit entry carries the userId).
  it('should forward userId from sendTemplate into the audit entry', async () => {
    const provider = makeProvider()
    const renderer = makeRenderer()
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, renderer, audit)

    await service.sendTemplate({
      tenantId: 't',
      to: 'a@x.com',
      template: 'welcome',
      data: {},
      userId: 'user-9'
    })

    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-9' }))
  })

  // sendTemplate without a userId must NOT surface a userId key in the audit entry.
  it('should omit userId from the audit entry when sendTemplate has none', async () => {
    const provider = makeProvider()
    const renderer = makeRenderer()
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, renderer, audit)

    await service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {} })

    const entry = audit.create.mock.calls[0]?.[0]
    expect('userId' in entry!).toBe(false)
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

  // When the REQUESTED (non-en) locale has a template, it is used directly without
  // dropping to the en fallback — pins the `if (await hasTemplate(template, locale))
  // return locale` first branch. The en template is absent here, so a mutant that
  // skips the requested-locale check would throw TEMPLATE_NOT_FOUND instead.
  it('should render in the requested locale when it has a template', async () => {
    const renderer = makeRenderer()
    renderer.hasTemplate.mockImplementation(async (_t, locale) => locale === 'pt-BR')
    const service = new EmailService(makeOptions(), makeProvider(), renderer, makeAudit())

    await service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {}, locale: 'pt-BR' })

    expect(renderer.render).toHaveBeenCalledWith('welcome', {}, 'pt-BR')
  })

  // Neither the requested locale nor en exists → TEMPLATE_NOT_FOUND, whose details
  // name the template and the originally-requested locale — pins the `{ template,
  // locale }` detail object against an emptied-object mutant.
  it('should throw TEMPLATE_NOT_FOUND with template and locale details when no locale matches', async () => {
    const renderer = makeRenderer()
    renderer.hasTemplate.mockResolvedValue(false)
    const service = new EmailService(makeOptions(), makeProvider(), renderer, makeAudit())

    expect.assertions(3)
    try {
      await service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {}, locale: 'fr' })
    } catch (error) {
      expect((error as NotificationException).code).toBe('notification.template_not_found')
      const details = (
        error as { getResponse: () => { error: { details: Record<string, unknown> } } }
      ).getResponse().error.details
      expect(details.template).toBe('welcome')
      expect(details.locale).toBe('fr')
    }
  })

  // A renderer that throws maps to TEMPLATE_RENDER_FAILED, whose details name the
  // template — pins the `{ template }` detail object against an emptied-object mutant.
  it('should throw TEMPLATE_RENDER_FAILED with template details when the renderer throws', async () => {
    const renderer = makeRenderer()
    renderer.render.mockRejectedValue(new Error('bad syntax'))
    const service = new EmailService(makeOptions(), makeProvider(), renderer, makeAudit())

    expect.assertions(2)
    try {
      await service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {} })
    } catch (error) {
      expect((error as NotificationException).code).toBe('notification.template_render_failed')
      const details = (
        error as { getResponse: () => { error: { details: Record<string, unknown> } } }
      ).getResponse().error.details
      expect(details.template).toBe('welcome')
    }
  })

  // Absent optional fields must NOT be injected as `undefined` keys into the inner
  // send() input — pins the omission (`: {}`) side of every conditional spread in
  // sendTemplate against the always-add (`? { x: undefined }`) mutant. Spying on the
  // inner send observes the EmailSendInput sendTemplate actually builds.
  it('should omit absent optional fields from the inner send input', async () => {
    const renderer = makeRenderer()
    renderer.render.mockResolvedValue({ subject: 'S', html: '<p>H</p>' })
    const service = new EmailService(makeOptions(), makeProvider(), renderer, makeAudit())
    const sendSpy = jest.spyOn(service, 'send').mockResolvedValue({ messageId: 'm' })

    await service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {} })

    const input = sendSpy.mock.calls[0]?.[0]
    for (const key of ['text', 'from', 'fromName', 'replyTo', 'userId']) {
      expect(key in input!).toBe(false)
    }
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
