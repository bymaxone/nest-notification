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

import { HttpStatus, Inject, Injectable, Logger, Optional } from '@nestjs/common'

import {
  BYMAX_NOTIFICATION_EMAIL_PROVIDER,
  BYMAX_NOTIFICATION_AUDIT_SINK,
  BYMAX_NOTIFICATION_OBSERVER,
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_TEMPLATE_RENDERER
} from '../bymax-notification.constants'
import type { ResolvedNotificationOptions } from '../config/resolved-options'
import { CANONICAL_EMAIL_TEMPLATES } from '../constants/canonical-templates'
import { NotificationException } from '../errors/notification-exception'
import type { EmailSendOptions, IEmailProvider } from '../interfaces/email-provider.interface'
import type { IEmailTemplateRenderer } from '../interfaces/email-template-renderer.interface'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '../interfaces/notification-log-repository.interface'
import type { INotificationObserver } from '../interfaces/notification-observer.interface'
import { AuditWriteWarning } from '../utils/audit-write-warning'
import { isUnavailableProviderError } from '../utils/availability'
import type { DeliveryStatus } from '../utils/delivery-status'
import {
  extractDeliveryStatus,
  isBasicStatus,
  isEnhancedStatus,
  withoutDeclaredValues
} from '../utils/delivery-status'
import { assertBodyParts } from '../utils/email-body'
import { attachmentBytes, readSendInput } from '../utils/email-send-input'
import { readHostName } from '../utils/host-name'
import { isLibraryError } from '../utils/is-library-error'
import { maskAddressTokens } from '../utils/mask-in-text'
import { reportSend, runInSpan } from '../utils/observe'
import { rethrowRefusal } from '../utils/provider-refusal'
import { nullProto } from '../utils/read-options'
import { checkedAwait, own } from '../utils/realm-root'
import { countRecipients } from '../utils/recipient-list'
import {
  collectEchoedExcerpts,
  collectErrorChainMessages,
  inspectErrorChain,
  readRedactedMessage,
  scrubValuesFromErrorChain
} from '../utils/redact'
import { assertIdentifies } from '../utils/tenant-scope'
import { SEND_KEYS, TEMPLATE_KEYS } from './email-send-keys'
import { templateSendInput } from './email-template-input'

/** Locale used as the fallback when the requested locale has no template. */
const FALLBACK_LOCALE = 'en'

/** What to tell a host whose OTP email has no template: the OTP default is the one it never names. */
const OTP_TEMPLATE_REMEDY =
  "register an 'otp_code' template (for example 'otp_code::en') in your template renderer, such as " +
  'DefaultTemplateRenderer; the OTP email can use another template through the emailTemplate ' +
  'option of generate()'

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

/**
 * The status override of a failed send: 503 when the provider could not be reached, timed out or
 * answered with a transient reply, nothing (the catalog's 502) when it answered and refused. A
 * caller told 503 may try again later. The rule is the service's, so a provider of the host's own
 * that throws the error its client gave it, a reply number and nothing else, is classified too.
 */
function unavailableStatus(error: unknown): { status?: HttpStatus } {
  return isUnavailableProviderError(error) ? { status: HttpStatus.SERVICE_UNAVAILABLE } : {}
}

/** Nanoseconds in a second, to turn a high-resolution timer into the seconds a metric holds. */
const NANOSECONDS_PER_SECOND = 1_000_000_000

/** How far a send got: whether the provider was reached, and what it answered. */
interface SendProgress {
  stage: 'before-provider' | 'accepted' | 'failed'
}

/**
 * How a send that threw ended, as the observer counts it, decided by how far it got and not by the
 * error it ended in. A message the provider accepted is `sent`, even when the audit write that
 * followed threw; a message the provider failed is `failed`, even when the audit write of that
 * failure threw too; one that never reached the provider is `rejected` when the library refused it,
 * and `failed` when something that is not the library's failed.
 *
 * @param progress - How far the send got.
 * @param error - What the send threw.
 * @returns The outcome.
 */
function sendOutcomeOf(progress: SendProgress, error: unknown): 'sent' | 'failed' | 'rejected' {
  if (progress.stage === 'accepted') {
    return 'sent'
  }
  if (progress.stage === 'failed') {
    return 'failed'
  }
  return isLibraryError(error) ? 'rejected' : 'failed'
}

/** The provider's name as text that is safe to write: bounded, escaped, `[unreadable]` when it cannot be read. */
function providerNameOf(provider: IEmailProvider): string {
  return readHostName(() => provider.name)
}

/**
 * Whether the provider says it is configured. One that throws is answered with
 * `EMAIL_PROVIDER_NOT_CONFIGURED`, its own error the cause, and never with a quieter path.
 */
function providerConfigured(provider: IEmailProvider): boolean {
  try {
    const answer: unknown = provider.isConfigured()
    // A truthy string or object is not `true`: only a boolean says whether the provider is ready.
    if (typeof answer !== 'boolean') {
      throw new NotificationException('EMAIL_PROVIDER_NOT_CONFIGURED')
    }
    return answer
  } catch (error) {
    throw new NotificationException('EMAIL_PROVIDER_NOT_CONFIGURED', undefined, { cause: error })
  }
}

export { templateSendInput }

/** Transactional email service. */
@Injectable()
export class EmailService {
  /** @internal */
  private readonly auditWarning = new AuditWriteWarning(new Logger(EmailService.name), 'email')

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
    @Inject(BYMAX_NOTIFICATION_AUDIT_SINK)
    private readonly auditLog: INotificationLogRepository,
    @Optional()
    @Inject(BYMAX_NOTIFICATION_OBSERVER)
    private readonly observer?: INotificationObserver
  ) {}

  /**
   * Whether the email channel is configured and its provider is ready.
   *
   * @returns `true` when both hold.
   */
  isConfigured(): boolean {
    return Boolean(this.options.email) && providerConfigured(this.provider)
  }

  /**
   * Sends an email whose subject/html/text the caller already produced.
   *
   * @param input - The message envelope and rendered body.
   * @returns The provider's message id.
   * @throws NotificationException `EMAIL_PROVIDER_NOT_CONFIGURED`, `INVALID_SCOPE_IDENTIFIER`
   * (a blank tenant or one with a control character), `EMAIL_ATTACHMENTS_TOO_LARGE`,
   * `EMAIL_INVALID_RECIPIENT` (more recipients than `maxRecipients`), `EMAIL_MISSING_BODY` (an html
   * or text part that is not a string), `EMAIL_SEND_FAILED`, or `AUDIT_LOG_FAILED` (only when `audit.swallowErrors` is `false`).
   */
  async send(input: EmailSendInput): Promise<{ messageId: string }> {
    return await own(
      this.observed((progress) => this.sendUnobserved(input, progress)),
      'EmailService'
    )
  }

  /**
   * Runs one send inside the observer's span and tells it how the send ended.
   *
   * @param run - The send, which records in `progress` how far it gets.
   * @returns What the send returns.
   */
  private async observed<T>(run: (progress: SendProgress) => Promise<T>): Promise<T> {
    const progress: SendProgress = { stage: 'before-provider' }
    const started = process.hrtime.bigint()
    const seconds = (): number => Number(process.hrtime.bigint() - started) / NANOSECONDS_PER_SECOND
    try {
      const result = await runInSpan(
        this.observer,
        'notification.send',
        { channel: 'email' },
        () => run(progress),
        'EmailService'
      )
      reportSend(this.observer, { channel: 'email', outcome: 'sent', seconds: seconds() })
      return result
    } catch (error) {
      reportSend(this.observer, {
        channel: 'email',
        outcome: sendOutcomeOf(progress, error),
        seconds: seconds()
      })
      throw error
    }
  }

  /**
   * The send itself, with no observer in sight, so a template send that ends in one is reported
   * once, by the call the host made.
   *
   * @param input - The message envelope and rendered body.
   * @param progress - Where the send records how far it gets.
   * @returns The provider's message id.
   */
  private async sendUnobserved(
    raw: EmailSendInput,
    progress: SendProgress,
    isRead = false
  ): Promise<{ messageId: string }> {
    const email = this.requireEmailOptions()
    // A template send has read its input already, and adds a tag of its own to the list; the bound
    // is the caller's, so the list is not read again with that tag in it.
    const input = isRead ? raw : this.readInput(raw, progress, SEND_KEYS)
    assertIdentifies('EmailService', 'tenantId', input.tenantId)
    assertBodyParts(input.html, input.text)
    this.guardAttachmentSize(input.attachments, email.maxAttachmentBytes)
    this.guardRecipientCount(input, email.maxRecipients)
    const sendOptions = this.buildSendOptions(input, email)
    const recipient = this.maskRecipients(input.to)
    const result = await this.deliver(sendOptions, input, recipient, progress)
    await this.audit(
      this.auditEntry(
        'sent',
        providerNameOf(this.provider),
        input.tenantId,
        recipient,
        input.userId,
        {
          messageId: result.messageId
        }
      )
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
   * @param progress - Where the send records how far it gets.
   * @returns The provider's result.
   * @throws NotificationException `EMAIL_SEND_FAILED`, carrying only what the
   * caller allows to be published.
   */
  private async deliver(
    sendOptions: EmailSendOptions,
    input: EmailSendInput,
    recipient: string,
    progress: SendProgress
  ): Promise<{ messageId: string }> {
    try {
      const result = await checkedAwait(this.provider.send(sendOptions), 'EmailService')
      progress.stage = 'accepted'
      return result
    } catch (error) {
      // The provider refused the message as given: nothing was sent, so it is not a failed delivery.
      rethrowRefusal(error)
      progress.stage = 'failed'
      return this.failDelivery(error, sendOptions, input, recipient)
    }
  }

  /**
   * Answers a failed provider call: the audit row, then `EMAIL_SEND_FAILED`.
   *
   * @throws NotificationException Always.
   */
  private async failDelivery(
    error: unknown,
    sendOptions: EmailSendOptions,
    input: EmailSendInput,
    recipient: string
  ): Promise<never> {
    const status = unavailableStatus(error)
    // A chain too large to examine, like a send that asked for it, publishes none of the provider's text.
    const chain = inspectErrorChain(error)
    if (input.publishProviderText === false || chain.withheld) {
      await this.failWithoutProviderText(error, input, recipient)
    }
    // Declared secrets plus detected body echoes: a relay that quotes the rejected content back.
    const secretValues = this.gatherRedactionValues(
      chain.parts,
      input.auditRedactValues,
      sendOptions
    )
    // Read once, like the text: the audit row, the error and the cause all carry these.
    const providerName = providerNameOf(this.provider)
    const text = this.auditText(error, secretValues)
    await this.audit(
      this.auditEntry('failed', providerName, input.tenantId, recipient, input.userId, {
        errorMessage: text
      })
    )
    throw new NotificationException(
      'EMAIL_SEND_FAILED',
      { providerName },
      {
        cause: new Error(text),
        ...status
      }
    )
  }

  /** The provider's text for the audit row: secrets removed, and every address-shaped token masked. */
  private auditText(error: unknown, secretValues: readonly string[]): string {
    return maskAddressTokens(
      readRedactedMessage(error, secretValues),
      this.options.audit.maskRecipient
    )
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
    return await own(
      this.observed((progress) => this.sendTemplateUnobserved(input, progress)),
      'EmailService'
    )
  }

  /**
   * The template send, whose last step is the unobserved send.
   *
   * @param input - The template name, data, and envelope.
   * @param progress - Where the send records how far it gets.
   * @returns The provider's message id.
   */
  private async sendTemplateUnobserved(
    raw: EmailSendTemplateInput,
    progress: SendProgress
  ): Promise<{ messageId: string }> {
    // Read first, so nothing below touches the caller's own lists or getters.
    const input = this.readInput(raw, progress, TEMPLATE_KEYS)
    assertIdentifies('EmailService', 'tenantId', input.tenantId)
    // Refused before rendering: a template is not rendered to be thrown away.
    if (this.options.email) {
      this.guardRecipientCount(input, this.options.email.maxRecipients)
    }
    const requestedLocale = input.locale ?? this.options.global.defaultLocale
    const locale = await this.resolveTemplateLocale(input.template, requestedLocale)
    const rendered = await this.renderTemplate(
      input.template,
      input.data,
      locale,
      input.auditRedactValues
    )
    const tags: EmailTag[] = [...(input.tags ?? []), { name: 'template', value: input.template }]
    return await own(
      this.sendUnobserved(templateSendInput(input, rendered, tags), progress, true),
      'EmailService'
    )
  }

  /** Returns the resolved email options or throws when the channel is not configured. */
  private requireEmailOptions(): NonNullable<ResolvedNotificationOptions['email']> {
    if (!this.options.email || !providerConfigured(this.provider)) {
      throw new NotificationException('EMAIL_PROVIDER_NOT_CONFIGURED')
    }
    return this.options.email
  }

  /**
   * Throws `EMAIL_INVALID_RECIPIENT` when to, cc and bcc together address more mailboxes than
   * the channel allows. The refusal names the limit and never an address.
   */
  private guardRecipientCount(
    input: Pick<EmailSendInput, 'to' | 'cc' | 'bcc'>,
    limit: number
  ): void {
    if (
      countRecipients(input.to) + countRecipients(input.cc) + countRecipients(input.bcc) >
      limit
    ) {
      throw new NotificationException('EMAIL_INVALID_RECIPIENT', {
        reason: 'too_many_recipients',
        limit
      })
    }
  }

  /**
   * Reads the caller's input once. The library's own refusal of a field of the wrong kind passes
   * as it is; an input that cannot be read at all (a getter that throws) is a failed send whose
   * cause is the caller's error.
   */
  private readInput<T extends object>(
    raw: T,
    progress: SendProgress,
    keys: readonly (keyof T & string)[]
  ): T {
    try {
      return readSendInput(raw, keys)
    } catch (error) {
      if (isLibraryError(error)) {
        throw error
      }
      progress.stage = 'failed'
      throw new NotificationException(
        'EMAIL_SEND_FAILED',
        { providerName: providerNameOf(this.provider) },
        { cause: error }
      )
    }
  }

  /** Throws `EMAIL_ATTACHMENTS_TOO_LARGE` when the attachments exceed the byte budget. */
  private guardAttachmentSize(
    attachments: EmailSendOptions['attachments'],
    maxBytes: number
  ): void {
    if (!attachments) {
      return
    }
    const totalBytes = attachments.reduce((sum, { content }) => sum + attachmentBytes(content), 0)
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
    // No prototype: a field that is not set is absent for the provider too, and does not answer
    // with a key planted on the realm root.
    return nullProto({
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
    })
  }

  /**
   * Picks the locale that has a template: the requested one, else `en`. Answers `undefined` when
   * neither has it. The one probe behind both a send and the startup check, so the two cannot
   * disagree.
   * @internal
   */
  private async findTemplateLocale(template: string, locale: string): Promise<string | undefined> {
    if (await checkedAwait(this.renderer.hasTemplate(template, locale), 'EmailService')) {
      return locale
    }
    if (await checkedAwait(this.renderer.hasTemplate(template, FALLBACK_LOCALE), 'EmailService')) {
      return FALLBACK_LOCALE
    }
    return undefined
  }

  /**
   * Whether a send of `template` for `locale` would find it: the requested locale, else `en`,
   * probed in that order exactly as {@link EmailService.sendTemplate} does.
   *
   * @param template - The template name.
   * @param locale - The requested locale.
   * @returns `true` when the renderer has the template for the locale or for `en`.
   * @internal
   */
  async resolvesTemplate(template: string, locale: string): Promise<boolean> {
    return (await this.findTemplateLocale(template, locale)) !== undefined
  }

  /** Picks the locale that has a template, falling back to `en`, else throws `TEMPLATE_NOT_FOUND`. */
  private async resolveTemplateLocale(template: string, locale: string): Promise<string> {
    const found = await this.findTemplateLocale(template, locale)
    if (found !== undefined) {
      return found
    }
    throw new NotificationException(
      'TEMPLATE_NOT_FOUND',
      template === CANONICAL_EMAIL_TEMPLATES.OTP_CODE
        ? { template, locale, remedy: OTP_TEMPLATE_REMEDY }
        : { template, locale }
    )
  }

  /** Renders the template, mapping a renderer failure to `TEMPLATE_RENDER_FAILED`. */
  private async renderTemplate(
    template: string,
    data: Record<string, unknown>,
    locale: string,
    redactValues?: readonly string[]
  ): Promise<{ subject: string; html: string; text?: string }> {
    try {
      return await checkedAwait(this.renderer.render(template, data, locale), 'EmailService')
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
    providerName: string,
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
      providerName,
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
      await checkedAwait(this.auditLog.create(entry), 'EmailService')
    } catch (error) {
      if (!this.options.audit.swallowErrors) {
        // The underlying error rides only on `Error.cause` — `details` is serialized
        // into the HTTP response body, so internal error text must never land there.
        throw new NotificationException('AUDIT_LOG_FAILED', undefined, { cause: error })
      }
      this.auditWarning.warn(error)
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
    const providerName = providerNameOf(this.provider)
    await this.audit(
      this.auditEntry('failed', providerName, input.tenantId, recipient, input.userId, {
        errorMessage: WITHHELD_PROVIDER_TEXT,
        ...status
      })
    )
    throw new NotificationException(
      'EMAIL_SEND_FAILED',
      { providerName, ...status },
      unavailableStatus(error)
    )
  }

  /**
   * Assembles every value to scrub from a provider failure: the caller's
   * declared secrets plus any excerpt of the rendered body the error is
   * ECHOING — a policy/DLP relay that quotes the rejected content puts the
   * body (and any secret inside it) into the error without the caller having
   * declared anything. Echo detection starts from the collected excerpts so
   * that with nothing declared and nothing echoed the list is verifiably
   * empty and the text is only masked.
   */
  private gatherRedactionValues(
    parts: readonly string[],
    declared: readonly string[] | undefined,
    sendOptions: EmailSendOptions
  ): readonly string[] {
    // The WHOLE bounded window of the chain is inspected — message and stack at every `cause` link —
    // because a wrapper with a generic outer message can carry the echo only in a nested cause, and
    // discovery reading the top level alone would choose the raw-cause path with that plaintext
    // aboard. Each field on its own: what is found is removed from each field separately, so a piece
    // that spans two fields must be a substring of the field it came from.
    // Array literals, not `push(...list)`: spreading a list into a call overflows the stack.
    return [
      ...collectEchoedExcerpts(parts, sendOptions.html),
      ...collectEchoedExcerpts(parts, sendOptions.text),
      ...(declared ?? [])
    ]
  }
}
