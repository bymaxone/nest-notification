/**
 * @fileoverview Public transactional email service.
 * @layer application
 *
 * Wraps the configured `IEmailProvider`, adding: default header application
 * (`from` / `fromName` / `replyTo` / `tags`), an attachment-size guard, optional
 * template rendering via `IEmailTemplateRenderer` (the renderer owns HTML escaping
 * during `sendTemplate`), and fire-and-forget audit logging with recipient masking.
 *
 * Security: the email body is never logged or audited; on a provider failure the
 * underlying error reaches the audit log only — the caller receives the generic
 * `EMAIL_SEND_FAILED`. OTP codes ride inside the body, never in audit metadata.
 */

import { Inject, Injectable } from '@nestjs/common'

import {
  BYMAX_NOTIFICATION_EMAIL_PROVIDER,
  BYMAX_NOTIFICATION_LOG_REPOSITORY,
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_TEMPLATE_RENDERER
} from '../bymax-notification.constants'
import type { ResolvedNotificationOptions } from '../config/resolved-options'
import { NotificationException } from '../errors/notification-exception'
import type { EmailSendOptions, IEmailProvider } from '../interfaces/email-provider.interface'
import type { IEmailTemplateRenderer } from '../interfaces/email-template-renderer.interface'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import type { DeliveryStatus } from '../utils/delivery-status'
import {
  extractDeliveryStatus,
  isBasicStatus,
  isEnhancedStatus,
  withoutDeclaredValues
} from '../utils/delivery-status'
import {
  collectEchoedExcerpts,
  collectErrorChainMessages,
  collectErrorChainText,
  readRedactedMessage,
  scrubValuesFromErrorChain
} from '../utils/redact'

/** Locale used as the fallback when the requested locale has no template. */
const FALLBACK_LOCALE = 'en'

/**
 * Stands in for the provider's own message when the caller set
 * `publishProviderText: false`. A fixed label, so the audit entry records THAT
 * delivery failed without recording anything the provider wrote.
 */
const WITHHELD_PROVIDER_TEXT = '[provider text withheld]'

/** An email tag pair. */
type EmailTag = { name: string; value: string }

/** Input for {@link EmailService.send} — the caller supplies the rendered body. */
export interface EmailSendInput {
  tenantId: string
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  fromName?: string
  replyTo?: string
  cc?: string | string[]
  bcc?: string | string[]
  tags?: ReadonlyArray<EmailTag>
  attachments?: EmailSendOptions['attachments']
  /** Associated user id, recorded in the audit entry. */
  userId?: string
  /**
   * Secret values (e.g. an OTP code the body carries) redacted from the audit
   * entry's `errorMessage` when a provider failure echoes them back.
   *
   * Precision where text is published on purpose — NOT a barrier. Matching is
   * literal, so the same bytes in another transfer encoding are missed; set
   * {@link EmailSendInput.publishProviderText} to `false` when the body must
   * not surface at all.
   */
  auditRedactValues?: readonly string[]
  /**
   * Whether a delivery failure may surface the text the PROVIDER authored —
   * its message, its stack, and the `cause` chain built from them. Defaults to
   * `true`, which keeps full diagnosability for ordinary mail.
   *
   * Set it to `false` for a message whose body carries a credential. A relay
   * that quotes the rejected content puts the body into its error, and a
   * declared value cannot be relied on to remove it: redaction predicts shapes,
   * and a body quoted in base64 matches nothing. With this `false` the failure
   * carries no provider-authored byte — no `cause`, and no message in the audit
   * entry — only the SMTP reply codes a fixed grammar can express, which are
   * the same whatever the body held.
   */
  publishProviderText?: boolean
}

/** Input for {@link EmailService.sendTemplate} — the renderer produces the body. */
export interface EmailSendTemplateInput {
  tenantId: string
  to: string | string[]
  template: string
  data: Record<string, unknown>
  locale?: string
  from?: string
  fromName?: string
  replyTo?: string
  tags?: ReadonlyArray<EmailTag>
  userId?: string
  /**
   * Secret values (e.g. an OTP code inside `data`) redacted from the audit
   * entry's `errorMessage` when a provider failure echoes them back.
   */
  auditRedactValues?: readonly string[]
  /**
   * Whether a delivery failure may surface provider-authored text. Forwarded
   * verbatim to {@link EmailService.send} — see
   * {@link EmailSendInput.publishProviderText}, which documents why a declared
   * value cannot substitute for it.
   */
  publishProviderText?: boolean
}

/**
 * Reads reply codes a provider attached to the error it threw, when it has
 * already applied the grammar itself.
 *
 * A provider that withholds its own text cannot leave the codes in the message
 * for this service to parse back out — the message is a fixed label by then —
 * so it attaches them instead. Reading is guarded: the value is consumer code.
 *
 * @param error - The failure the provider threw.
 * @returns The attached codes, or `undefined` when the provider attached none.
 */
function readAttachedStatus(error: unknown): DeliveryStatus | undefined {
  // No `instanceof` guard: reading a property off a primitive yields undefined
  // rather than throwing, and the only failure mode left — a hostile getter or
  // proxy trap — is what the catch is for. A guard here would be a branch no
  // input can distinguish.
  try {
    const carrier = error as { deliveryStatus?: unknown; deliveryEnhancedStatus?: unknown }
    // Each property is read EXACTLY ONCE and then validated from the snapshot.
    // A stateful getter would otherwise return a well-formed code to the checks
    // and arbitrary provider text to the assignment — validating a value that
    // never reaches the audit entry.
    const rawStatus: unknown = carrier.deliveryStatus
    const rawEnhanced: unknown = carrier.deliveryEnhancedStatus
    // Validated against the SAME grammar the extractor applies, not merely
    // type-checked: these values come from provider code, and a provider that
    // attached the quoted body as a "status" would otherwise have it published
    // by the one path whose promise is that only the grammar gets out.
    const status = typeof rawStatus === 'number' && isBasicStatus(rawStatus) ? rawStatus : undefined
    const enhanced =
      typeof rawEnhanced === 'string' && isEnhancedStatus(rawEnhanced) ? rawEnhanced : undefined
    if (status === undefined && enhanced === undefined) {
      return undefined
    }
    return {
      ...(status !== undefined ? { status } : {}),
      ...(enhanced !== undefined ? { enhanced } : {})
    }
  } catch {
    // A hostile getter contributes nothing; the message grammar still applies.
    return undefined
  }
}

/** Transactional email service. */
@Injectable()
export class EmailService {
  /**
   * @param options - The resolved, frozen module options.
   * @param provider - The configured email send provider.
   * @param renderer - The configured template renderer.
   * @param auditLog - The audit-log repository (no-op when none configured).
   */
  constructor(
    @Inject(BYMAX_NOTIFICATION_OPTIONS)
    private readonly options: ResolvedNotificationOptions,
    @Inject(BYMAX_NOTIFICATION_EMAIL_PROVIDER)
    private readonly provider: IEmailProvider,
    @Inject(BYMAX_NOTIFICATION_TEMPLATE_RENDERER)
    private readonly renderer: IEmailTemplateRenderer,
    @Inject(BYMAX_NOTIFICATION_LOG_REPOSITORY)
    private readonly auditLog: INotificationLogRepository
  ) {}

  /**
   * Whether the email channel is configured and its provider is ready.
   *
   * @returns `true` when both hold.
   */
  isConfigured(): boolean {
    return Boolean(this.options.email) && this.provider.isConfigured()
  }

  /**
   * Sends an email whose subject/html/text the caller already produced.
   *
   * @param input - The message envelope and rendered body.
   * @returns The provider's message id.
   * @throws NotificationException `EMAIL_PROVIDER_NOT_CONFIGURED`, `EMAIL_ATTACHMENTS_TOO_LARGE`,
   * `EMAIL_SEND_FAILED`, or `AUDIT_LOG_FAILED` (only when `audit.swallowErrors` is `false`).
   */
  async send(input: EmailSendInput): Promise<{ messageId: string }> {
    const email = this.requireEmailOptions()
    this.guardAttachmentSize(input.attachments, email.maxAttachmentBytes)
    const sendOptions = this.buildSendOptions(input, email)
    const recipient = this.maskRecipients(input.to)
    const result = await this.deliver(sendOptions, input, recipient)
    await this.audit(
      this.auditEntry('sent', input.tenantId, recipient, input.userId, {
        messageId: result.messageId
      })
    )
    return { messageId: result.messageId }
  }

  /**
   * Hands the message to the provider, converting any failure it raises.
   *
   * Only the provider call sits in this `try`. The success-path audit is the
   * caller's business, so an `AUDIT_LOG_FAILED` cannot be mistaken for a
   * delivery failure — and, more importantly, a `NotificationException` the
   * PROVIDER throws no longer escapes unconverted. A custom adapter may raise
   * one carrying its own message, details and cause, and an early rethrow would
   * have handed that provider-authored text straight to the caller even with
   * `publishProviderText: false`.
   *
   * @param sendOptions - The envelope handed to the provider.
   * @param input - The original input, for redaction values and the audit entry.
   * @param recipient - The already-masked recipient.
   * @returns The provider's result.
   * @throws NotificationException `EMAIL_SEND_FAILED`, carrying only what the
   * caller allows to be published.
   */
  private async deliver(
    sendOptions: EmailSendOptions,
    input: EmailSendInput,
    recipient: string
  ): Promise<{ messageId: string }> {
    try {
      return await this.provider.send(sendOptions)
    } catch (error) {
      if (input.publishProviderText === false) {
        await this.failWithoutProviderText(error, input, recipient)
      }
      // Declared secrets plus detected BODY ECHOES: a relay that quotes the
      // rejected content back puts the rendered body — and any secret inside
      // it — into the provider error, detectably, even when the caller
      // declared nothing.
      const secretValues = this.gatherRedactionValues(error, input.auditRedactValues, sendOptions)
      await this.audit(
        this.auditEntry('failed', input.tenantId, recipient, input.userId, {
          errorMessage: readRedactedMessage(error, secretValues)
        })
      )
      throw new NotificationException(
        'EMAIL_SEND_FAILED',
        { providerName: this.provider.name },
        { cause: secretValues.length > 0 ? scrubValuesFromErrorChain(error, secretValues) : error }
      )
    }
  }

  /**
   * Renders a template (with an `en` fallback) and sends the result.
   *
   * @param input - The template name, data, and envelope.
   * @returns The provider's message id.
   * @throws NotificationException `TEMPLATE_NOT_FOUND` (no template for the locale nor `en`),
   * `TEMPLATE_RENDER_FAILED` (the renderer threw), plus anything {@link EmailService.send} throws.
   */
  async sendTemplate(input: EmailSendTemplateInput): Promise<{ messageId: string }> {
    const requestedLocale = input.locale ?? this.options.global.defaultLocale
    const locale = await this.resolveTemplateLocale(input.template, requestedLocale)
    const rendered = await this.renderTemplate(
      input.template,
      input.data,
      locale,
      input.auditRedactValues
    )
    const tags: EmailTag[] = [...(input.tags ?? []), { name: 'template', value: input.template }]
    // Each optional field is spread only when present, so an absent field never
    // becomes an `{ x: undefined }` key in the send input that `send()` would then
    // carry as an explicit value rather than a genuinely missing one.
    return this.send({
      tenantId: input.tenantId,
      to: input.to,
      subject: rendered.subject,
      html: rendered.html,
      tags,
      ...(rendered.text !== undefined ? { text: rendered.text } : {}),
      ...(input.from !== undefined ? { from: input.from } : {}),
      ...(input.fromName !== undefined ? { fromName: input.fromName } : {}),
      ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
      ...(input.userId !== undefined ? { userId: input.userId } : {}),
      ...(input.auditRedactValues !== undefined
        ? { auditRedactValues: input.auditRedactValues }
        : {}),
      ...(input.publishProviderText !== undefined
        ? { publishProviderText: input.publishProviderText }
        : {})
    })
  }

  /** Returns the resolved email options or throws when the channel is not configured. */
  private requireEmailOptions(): NonNullable<ResolvedNotificationOptions['email']> {
    if (!this.options.email || !this.provider.isConfigured()) {
      throw new NotificationException('EMAIL_PROVIDER_NOT_CONFIGURED')
    }
    return this.options.email
  }

  /** Throws `EMAIL_ATTACHMENTS_TOO_LARGE` when the attachments exceed the byte budget. */
  private guardAttachmentSize(
    attachments: EmailSendOptions['attachments'],
    maxBytes: number
  ): void {
    if (!attachments) {
      return
    }
    const totalBytes = attachments.reduce(
      (sum, { content }) =>
        // Stryker disable next-line ConditionalExpression: equivalent — `Buffer.byteLength` answers a Buffer's own length, so both arms measure the same bytes; the conditional says where the number comes from
        sum + (typeof content === 'string' ? Buffer.byteLength(content) : content.length),
      0
    )
    if (totalBytes > maxBytes) {
      throw new NotificationException('EMAIL_ATTACHMENTS_TOO_LARGE', {
        totalBytes,
        limit: maxBytes
      })
    }
  }

  /** Applies channel defaults and concatenates default + caller tags. */
  private buildSendOptions(
    input: EmailSendInput,
    email: NonNullable<ResolvedNotificationOptions['email']>
  ): EmailSendOptions {
    const fromName = input.fromName ?? email.defaultFromName
    const replyTo = input.replyTo ?? email.defaultReplyTo
    return {
      to: input.to,
      from: input.from ?? email.defaultFrom,
      subject: input.subject,
      html: input.html,
      tags: [...email.defaultTags, ...(input.tags ?? [])],
      ...(fromName !== undefined ? { fromName } : {}),
      ...(replyTo !== undefined ? { replyTo } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.cc !== undefined ? { cc: input.cc } : {}),
      ...(input.bcc !== undefined ? { bcc: input.bcc } : {}),
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {}),
      ...(input.auditRedactValues !== undefined ? { redactValues: input.auditRedactValues } : {}),
      ...(input.publishProviderText !== undefined
        ? { publishProviderText: input.publishProviderText }
        : {})
    }
  }

  /** Picks the locale that has a template, falling back to `en`, else throws `TEMPLATE_NOT_FOUND`. */
  private async resolveTemplateLocale(template: string, locale: string): Promise<string> {
    if (await this.renderer.hasTemplate(template, locale)) {
      return locale
    }
    if (await this.renderer.hasTemplate(template, FALLBACK_LOCALE)) {
      return FALLBACK_LOCALE
    }
    throw new NotificationException('TEMPLATE_NOT_FOUND', { template, locale })
  }

  /** Renders the template, mapping a renderer failure to `TEMPLATE_RENDER_FAILED`. */
  private async renderTemplate(
    template: string,
    data: Record<string, unknown>,
    locale: string,
    redactValues?: readonly string[]
  ): Promise<{ subject: string; html: string; text?: string }> {
    try {
      return await this.renderer.render(template, data, locale)
    } catch (error) {
      // A renderer error can echo the template data (which carries the
      // caller's secrets); declared values are scrubbed from the cause.
      throw new NotificationException(
        'TEMPLATE_RENDER_FAILED',
        { template },
        {
          cause: redactValues ? scrubValuesFromErrorChain(error, redactValues) : error
        }
      )
    }
  }

  /** Builds an audit entry with the recipient already masked. */
  private auditEntry(
    verb: NotificationLogEntry['verb'],
    tenantId: string,
    recipient: string,
    userId: string | undefined,
    extra: { messageId?: string; errorMessage?: string; status?: number; enhanced?: string }
  ): NotificationLogEntry {
    return {
      timestamp: Date.now(),
      tenantId,
      channel: 'email',
      verb,
      recipient,
      providerName: this.provider.name,
      ...(extra.messageId !== undefined ? { messageId: extra.messageId } : {}),
      ...(extra.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
      ...(extra.status !== undefined ? { deliveryStatus: extra.status } : {}),
      ...(extra.enhanced !== undefined ? { deliveryEnhancedStatus: extra.enhanced } : {}),
      ...(userId !== undefined ? { userId } : {})
    }
  }

  /** Writes an audit entry, swallowing failures unless `audit.swallowErrors` is `false`. */
  private async audit(entry: NotificationLogEntry): Promise<void> {
    try {
      await this.auditLog.create(entry)
    } catch (error) {
      if (!this.options.audit.swallowErrors) {
        // The underlying error rides only on `Error.cause` — `details` is serialized
        // into the HTTP response body, so internal error text must never land there.
        throw new NotificationException('AUDIT_LOG_FAILED', undefined, { cause: error })
      }
    }
  }

  /** Masks the recipient(s) per `audit.maskRecipient`, joining an array with `', '`. */
  private maskRecipients(to: string | string[]): string {
    const mask = this.options.audit.maskRecipient
    return Array.isArray(to) ? to.map((recipient) => mask(recipient)).join(', ') : mask(to)
  }

  /**
   * Fails a send whose caller forbade publishing provider-authored text.
   *
   * Nothing the provider wrote is carried: no `cause`, and no provider message
   * in the audit entry. Redaction could not honour the promise — it removes the
   * shapes it predicts, and an echo in another transfer encoding defeats every
   * declared value — so the failure publishes only the reply codes a fixed
   * grammar can express, which are independent of whatever the body held.
   *
   * @param error - The provider failure, read but never surfaced.
   * @param input - The send input, for the tenant and user recorded in the audit.
   * @param recipient - The already-masked recipient.
   * @throws NotificationException Always — `EMAIL_SEND_FAILED` carrying the codes only.
   */
  private async failWithoutProviderText(
    error: unknown,
    input: EmailSendInput,
    recipient: string
  ): Promise<never> {
    const status = withoutDeclaredValues(
      readAttachedStatus(error) ?? extractDeliveryStatus(collectErrorChainMessages(error)),
      input.auditRedactValues
    )
    await this.audit(
      this.auditEntry('failed', input.tenantId, recipient, input.userId, {
        errorMessage: WITHHELD_PROVIDER_TEXT,
        ...status
      })
    )
    throw new NotificationException('EMAIL_SEND_FAILED', {
      providerName: this.provider.name,
      ...status
    })
  }

  /**
   * Assembles every value to scrub from a provider failure: the caller's
   * declared secrets plus any excerpt of the rendered body the error is
   * ECHOING — a policy/DLP relay that quotes the rejected content puts the
   * body (and any secret inside it) into the error without the caller having
   * declared anything. Echo detection starts from the collected excerpts so
   * that with nothing declared and nothing echoed the list is verifiably
   * empty and the raw error passes through untouched.
   */
  private gatherRedactionValues(
    error: unknown,
    declared: readonly string[] | undefined,
    sendOptions: EmailSendOptions
  ): readonly string[] {
    // The WHOLE chain is inspected — message and stack at every `cause` link —
    // because a wrapper with a generic outer message can carry the echo only in
    // a nested cause, and discovery reading the top level alone would choose
    // the raw-cause path with that plaintext aboard.
    const errorText = collectErrorChainText(error)
    const values = collectEchoedExcerpts(errorText, sendOptions.html)
    if (sendOptions.text !== undefined) {
      values.push(...collectEchoedExcerpts(errorText, sendOptions.text))
    }
    if (declared) {
      values.push(...declared)
    }
    return values
  }
}
