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

/** Locale used as the fallback when the requested locale has no template. */
const FALLBACK_LOCALE = 'en'

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
    try {
      const result = await this.provider.send(sendOptions)
      await this.audit(
        this.auditEntry('sent', input.tenantId, recipient, input.userId, {
          messageId: result.messageId
        })
      )
      return { messageId: result.messageId }
    } catch (error) {
      if (error instanceof NotificationException) {
        throw error
      }
      await this.audit(
        this.auditEntry('failed', input.tenantId, recipient, input.userId, {
          errorMessage: error instanceof Error ? error.message : String(error)
        })
      )
      throw new NotificationException('EMAIL_SEND_FAILED', { providerName: this.provider.name })
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
    const rendered = await this.renderTemplate(input.template, input.data, locale)
    const tags: EmailTag[] = [...(input.tags ?? []), { name: 'template', value: input.template }]
    // The always-add (`? {x} : {}` -> `? {x:undefined}`) variant of these spreads is
    // equivalent because `send()` re-applies defaults and re-filters undefined for
    // from/fromName/replyTo/text; only the omit (`{}`) variant is killable and is
    // covered by the EmailService.send tests asserting these fields' presence.
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
      ...(input.userId !== undefined ? { userId: input.userId } : {})
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
      ...(input.attachments !== undefined ? { attachments: input.attachments } : {})
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
    locale: string
  ): Promise<{ subject: string; html: string; text?: string }> {
    try {
      return await this.renderer.render(template, data, locale)
    } catch {
      throw new NotificationException('TEMPLATE_RENDER_FAILED', { template })
    }
  }

  /** Builds an audit entry with the recipient already masked. */
  private auditEntry(
    verb: NotificationLogEntry['verb'],
    tenantId: string,
    recipient: string,
    userId: string | undefined,
    extra: { messageId?: string; errorMessage?: string }
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
      ...(userId !== undefined ? { userId } : {})
    }
  }

  /** Writes an audit entry, swallowing failures unless `audit.swallowErrors` is `false`. */
  private async audit(entry: NotificationLogEntry): Promise<void> {
    try {
      await this.auditLog.create(entry)
    } catch (error) {
      if (!this.options.audit.swallowErrors) {
        throw new NotificationException('AUDIT_LOG_FAILED', {
          cause: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  /** Masks the recipient(s) per `audit.maskRecipient`, joining an array with `', '`. */
  private maskRecipients(to: string | string[]): string {
    const mask = this.options.audit.maskRecipient
    return Array.isArray(to) ? to.map((recipient) => mask(recipient)).join(', ') : mask(to)
  }
}
