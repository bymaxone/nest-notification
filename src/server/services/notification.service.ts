/**
 * @fileoverview Channel-agnostic notification façade.
 * @layer application
 *
 * A uniform `dispatch({ channel, tenantId, payload })` API over the per-channel
 * services, plus throwing accessors (`getEmail` / `getOtp`) and channel discovery
 * (`getEnabledChannels`). Channel services are `@Optional()`: a channel that was
 * not configured is simply absent, and dispatching to it throws `CHANNEL_DISABLED`.
 */

import { Injectable, Optional } from '@nestjs/common'

import { EmailService } from './email.service'
import type { EmailSendInput, EmailSendTemplateInput } from './email.service'
import { OtpService } from './otp.service'
import type { OtpGenerateInput, OtpGenerateResult } from './otp.service'
import type { NotificationChannel } from '../../shared/types/notification-channel.types'
import { NotificationException } from '../errors/notification-exception'
import type { OtpVerifyResult } from '../interfaces/otp-storage.interface'

/** An email tag pair. */
type EmailTag = { name: string; value: string }

/** Email dispatch payload — either a `template` (+ `data`) or a raw `subject` + `html`. */
export interface EmailDispatchPayload {
  to: string | string[]
  template?: string
  data?: Record<string, unknown>
  locale?: string
  subject?: string
  html?: string
  text?: string
  from?: string
  fromName?: string
  replyTo?: string
  tags?: ReadonlyArray<EmailTag>
  userId?: string
}

/** OTP dispatch payload — `action` selects generate (default) / verify / consume. */
export interface OtpDispatchPayload {
  recipient: string
  purpose: string
  action?: 'generate' | 'verify' | 'consume'
  /** Required when `action === 'verify'`. */
  code?: string
  deliverVia?: 'email' | 'manual'
  emailTemplate?: string
  emailData?: Record<string, unknown>
  locale?: string
  userId?: string
}

/** Discriminated dispatch input, one variant per channel. */
export type DispatchInput =
  | { channel: 'email'; tenantId: string; payload: EmailDispatchPayload }
  | { channel: 'otp'; tenantId: string; payload: OtpDispatchPayload }

/** Discriminated dispatch result, one variant per channel. */
export type DispatchResult =
  | { channel: 'email'; messageId: string }
  | { channel: 'otp'; result: OtpGenerateResult | OtpVerifyResult | void }

/** Uniform façade over the configured channel services. */
@Injectable()
export class NotificationService {
  /**
   * @param emailService - The email service, present only when the email channel is configured.
   * @param otpService - The OTP service, present only when the OTP channel is configured.
   */
  constructor(
    @Optional() private readonly emailService?: EmailService,
    @Optional() private readonly otpService?: OtpService
  ) {}

  /**
   * Dispatches a notification to the channel named in `input`.
   *
   * @param input - The channel-discriminated dispatch request.
   * @returns The channel-discriminated result.
   * @throws NotificationException `CHANNEL_DISABLED` (channel not configured) or
   * `EMAIL_MISSING_BODY` (email payload has neither a template nor subject+html).
   */
  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    if (input.channel === 'email') {
      return {
        channel: 'email',
        messageId: await this.dispatchEmail(input.tenantId, input.payload)
      }
    }
    return { channel: 'otp', result: await this.dispatchOtp(input.tenantId, input.payload) }
  }

  /**
   * Lists the channels whose service is present and reports itself configured.
   *
   * @returns The enabled channels.
   */
  getEnabledChannels(): NotificationChannel[] {
    const channels: NotificationChannel[] = []
    if (this.emailService?.isConfigured()) {
      channels.push('email')
    }
    if (this.otpService?.isConfigured()) {
      channels.push('otp')
    }
    return channels
  }

  /**
   * Returns the email service or throws when the email channel is not enabled.
   *
   * @returns The email service.
   * @throws NotificationException `CHANNEL_DISABLED` when email is not configured.
   */
  getEmail(): EmailService {
    if (!this.emailService) {
      throw new NotificationException('CHANNEL_DISABLED', { channel: 'email' })
    }
    return this.emailService
  }

  /**
   * Returns the OTP service or throws when the OTP channel is not enabled.
   *
   * @returns The OTP service.
   * @throws NotificationException `CHANNEL_DISABLED` when OTP is not configured.
   */
  getOtp(): OtpService {
    if (!this.otpService) {
      throw new NotificationException('CHANNEL_DISABLED', { channel: 'otp' })
    }
    return this.otpService
  }

  /** Routes an email dispatch to `sendTemplate` (template) or `send` (raw body). */
  private async dispatchEmail(tenantId: string, payload: EmailDispatchPayload): Promise<string> {
    const email = this.getEmail()
    if (payload.template !== undefined) {
      const input = this.toTemplateInput(tenantId, payload.template, payload)
      return (await email.sendTemplate(input)).messageId
    }
    if (payload.subject !== undefined && payload.html !== undefined) {
      const input = this.toSendInput(tenantId, payload.subject, payload.html, payload)
      return (await email.send(input)).messageId
    }
    throw new NotificationException('EMAIL_MISSING_BODY', {
      hint: 'payload requires either `template` OR `{ subject, html }`'
    })
  }

  /** Routes an OTP dispatch by `action`, defaulting to `generate`. */
  private async dispatchOtp(
    tenantId: string,
    payload: OtpDispatchPayload
  ): Promise<OtpGenerateResult | OtpVerifyResult | void> {
    const otp = this.getOtp()
    // Stryker disable next-line StringLiteral: 'generate' is the default only; it is never compared with `===` (the code branches on 'verify'/'consume' and falls through otherwise), so any non-'verify'/'consume' default — including the empty-string mutant — routes identically to generate.
    const action = payload.action ?? 'generate'
    const ref = {
      tenantId,
      recipient: payload.recipient,
      purpose: payload.purpose,
      ...(payload.userId !== undefined ? { userId: payload.userId } : {})
    }
    if (action === 'verify') {
      return otp.verify({ ...ref, code: payload.code ?? '' })
    }
    if (action === 'consume') {
      return otp.consume(ref)
    }
    return otp.generate(this.toGenerateInput(ref, payload))
  }

  /** Builds the `sendTemplate` input from a resolved template name and payload. */
  private toTemplateInput(
    tenantId: string,
    template: string,
    payload: EmailDispatchPayload
  ): EmailSendTemplateInput {
    return {
      tenantId,
      to: payload.to,
      template,
      data: payload.data ?? {},
      ...(payload.locale !== undefined ? { locale: payload.locale } : {}),
      ...this.commonEmailFields(payload)
    }
  }

  /** Builds the raw `send` input from a resolved subject/html and payload. */
  private toSendInput(
    tenantId: string,
    subject: string,
    html: string,
    payload: EmailDispatchPayload
  ): EmailSendInput {
    return {
      tenantId,
      to: payload.to,
      subject,
      html,
      ...(payload.text !== undefined ? { text: payload.text } : {}),
      ...this.commonEmailFields(payload)
    }
  }

  /** The optional envelope fields shared by both email paths. */
  private commonEmailFields(
    payload: EmailDispatchPayload
  ): Partial<Pick<EmailSendInput, 'from' | 'fromName' | 'replyTo' | 'tags' | 'userId'>> {
    return {
      ...(payload.from !== undefined ? { from: payload.from } : {}),
      ...(payload.fromName !== undefined ? { fromName: payload.fromName } : {}),
      ...(payload.replyTo !== undefined ? { replyTo: payload.replyTo } : {}),
      ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
      ...(payload.userId !== undefined ? { userId: payload.userId } : {})
    }
  }

  /** Builds the `generate` input from a reference and an OTP dispatch payload. */
  private toGenerateInput(
    ref: { tenantId: string; recipient: string; purpose: string; userId?: string },
    payload: OtpDispatchPayload
  ): OtpGenerateInput {
    return {
      ...ref,
      ...(payload.deliverVia !== undefined ? { deliverVia: payload.deliverVia } : {}),
      ...(payload.emailTemplate !== undefined ? { emailTemplate: payload.emailTemplate } : {}),
      ...(payload.emailData !== undefined ? { emailData: payload.emailData } : {}),
      ...(payload.locale !== undefined ? { locale: payload.locale } : {})
    }
  }
}
