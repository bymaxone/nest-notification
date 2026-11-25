/**
 * @fileoverview Channel-agnostic notification façade.
 * @layer application
 *
 * A uniform `dispatch({ channel, tenantId, payload })` API over the per-channel
 * services, plus throwing accessors (`getEmail` / `getOtp`) and channel discovery
 * (`getEnabledChannels`). Channel services are `@Optional()`: a channel that was
 * not configured is simply absent, and dispatching to it throws `CHANNEL_DISABLED`.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common'
import type { OnModuleInit } from '@nestjs/common'

import type { NotificationChannel } from '../../shared/types/notification-channel.types'
import { NOTIFICATION_LOG_EVENTS } from '../constants/log-events.constants'
import { NotificationException } from '../errors/notification-exception'
import type { OtpVerifyResult } from '../interfaces/otp-storage.interface'
import type { PushSendResult } from '../interfaces/push-provider.interface'
import { copyByName } from '../utils/bounded-list'
import { logEvent } from '../utils/log-event'
import { readOtpAction } from '../utils/otp-input'
import { assertStandardRealmRoot, own, ownChecked, pinOnce } from '../utils/realm-root'
import { DISPATCH_EMAIL_KEYS } from './dispatch-email-keys'
import { EmailService } from './email.service'
import type { EmailSendInput, EmailSendTemplateInput } from './email.service'
import { OtpService } from './otp.service'
import type { OtpGenerateResult } from './otp.service'
import { PushService } from './push.service'
import type { PushSendInput } from './push.service'

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

/** Push dispatch payload — the tokens and the message; the tenant is the request's. */
export type PushDispatchPayload = Omit<PushSendInput, 'tenantId'>

/** The fields of a dispatch request and of an OTP payload, read by name so the root prototype is never asked. */
const DISPATCH_KEYS = ['channel', 'tenantId', 'payload'] as const
const OTP_PAYLOAD_KEYS = [
  'action',
  'recipient',
  'purpose',
  'userId',
  'code',
  'deliverVia',
  'emailTemplate',
  'emailData',
  'locale'
] as const satisfies readonly (keyof OtpDispatchPayload)[]

/** Discriminated dispatch input, one variant per channel. */
export type DispatchInput =
  | { channel: 'email'; tenantId: string; payload: EmailDispatchPayload }
  | { channel: 'otp'; tenantId: string; payload: OtpDispatchPayload }
  | { channel: 'push'; tenantId: string; payload: PushDispatchPayload }

/** Discriminated dispatch result, one variant per channel. */
export type DispatchResult =
  | { channel: 'email'; messageId: string }
  | { channel: 'otp'; result: OtpGenerateResult | OtpVerifyResult | void }
  | { channel: 'push'; result: PushSendResult }

/** Uniform façade over the configured channel services. */
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name)

  /**
   * @param emailService - The email service, present only when the email channel is configured.
   * @param otpService - The OTP service, present only when the OTP channel is configured.
   */
  constructor(
    @Optional() @Inject(EmailService) private readonly emailService?: EmailService,
    @Optional() @Inject(OtpService) private readonly otpService?: OtpService,
    @Optional() @Inject(PushService) private readonly pushService?: PushService
  ) {}

  /**
   * Dispatches a notification to the channel named in `input`.
   *
   * @param input - The channel-discriminated dispatch request.
   * @returns The channel-discriminated result.
   * @throws NotificationException `CHANNEL_DISABLED` (channel not configured) or
   * `EMAIL_MISSING_BODY` (email payload has neither a template nor subject+html).
   */
  dispatch(input: DispatchInput): Promise<DispatchResult> {
    // Pinned and checked as it is handed over: the caller's own `await` reads nothing off the realm.
    return ownChecked(this.route(input), 'NotificationService')
  }

  /** Reads the request once and routes it to its channel. */
  private async route(input: DispatchInput): Promise<DispatchResult> {
    // The request is read once: the channel that routes is the channel whose payload is used.
    const { channel, tenantId, payload } = copyByName(
      input,
      DISPATCH_KEYS
    ) as unknown as DispatchInput
    if (channel === 'email') {
      return {
        channel: 'email',
        messageId: await own(this.dispatchEmail(tenantId, payload), 'NotificationService')
      }
    }
    if (channel === 'push') {
      return {
        channel: 'push',
        result: await own(this.dispatchPush(tenantId, payload), 'NotificationService')
      }
    }
    return {
      channel: 'otp',
      result: await own(this.dispatchOtp(tenantId, payload), 'NotificationService')
    }
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
    if (this.pushService?.isConfigured()) {
      channels.push('push')
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
    if (!this.emailService.isConfigured()) {
      throw new NotificationException('CHANNEL_DISABLED', {
        channel: 'email',
        reason: 'provider_not_configured'
      })
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
    if (!this.otpService.isConfigured()) {
      throw new NotificationException('CHANNEL_DISABLED', {
        channel: 'otp',
        reason: 'storage_not_configured'
      })
    }
    return this.otpService
  }

  /**
   * Returns the push service or throws when the push channel is not enabled.
   *
   * @returns The push service.
   * @throws NotificationException `CHANNEL_DISABLED` when push is not configured.
   */
  getPush(): PushService {
    if (!this.pushService) {
      throw new NotificationException('CHANNEL_DISABLED', { channel: 'push' })
    }
    if (!this.pushService.isConfigured()) {
      throw new NotificationException('CHANNEL_DISABLED', {
        channel: 'push',
        reason: 'provider_not_configured'
      })
    }
    return this.pushService
  }

  /**
   * Warns once per channel that is configured but cannot be used, because its provider or
   * storage reports `isConfigured() === false`. Such a channel is absent from
   * {@link NotificationService.getEnabledChannels} and refused by the accessors; without this
   * line the first sign of it would be a failed send.
   */
  onModuleInit(): void {
    if (this.emailService && !this.emailService.isConfigured()) {
      this.warnNotUsable('email', 'provider')
    }
    if (this.otpService && !this.otpService.isConfigured()) {
      this.warnNotUsable('otp', 'storage')
    }
    // A push channel is new, so a provider that cannot send fails the boot instead of warning: the
    // host asked for push and would otherwise learn it is off from a missing notification.
    if (this.pushService && !this.pushService.isConfigured()) {
      throw new NotificationException('PUSH_PROVIDER_NOT_CONFIGURED')
    }
  }

  /** Logs the not-usable warning for one channel. */
  private warnNotUsable(channel: NotificationChannel, part: 'provider' | 'storage'): void {
    logEvent(
      this.logger,
      'warn',
      NOTIFICATION_LOG_EVENTS.CHANNEL_NOT_USABLE,
      `[BYMAX_NOTIFICATION_CHANNEL_NOT_USABLE] The ${channel} channel is configured but its ${part} reports isConfigured() = false, ` +
        `so it is not enabled: check the ${part}'s credentials or environment.`
    )
  }

  /** Routes an email dispatch to `sendTemplate` (template) or `send` (raw body). */
  private async dispatchEmail(tenantId: string, raw: EmailDispatchPayload): Promise<string> {
    const email = this.getEmail()
    // Each field of the payload is read once, here, and only the copy is used below.
    const payload = copyByName(raw, DISPATCH_EMAIL_KEYS) as unknown as EmailDispatchPayload
    if (payload.template !== undefined) {
      const input = this.toTemplateInput(tenantId, payload.template, payload)
      return (await pinOnce(email.sendTemplate(input), 'NotificationService')).messageId
    }
    if (payload.subject !== undefined && payload.html !== undefined) {
      const input = this.toSendInput(tenantId, payload.subject, payload.html, payload)
      return (await pinOnce(email.send(input), 'NotificationService')).messageId
    }
    throw new NotificationException('EMAIL_MISSING_BODY', {
      hint: 'payload requires either `template` OR `{ subject, html }`'
    })
  }

  /** Routes a push dispatch to `PushService.send`, with the request's tenant. */
  private async dispatchPush(
    tenantId: string,
    payload: PushDispatchPayload
  ): Promise<PushSendResult> {
    const push = this.getPush()
    // `send` reads every field of the payload once; the tenant is the request's, never the payload's.
    const result = await pinOnce(push.send({ ...payload, tenantId }), 'NotificationService')
    assertStandardRealmRoot('NotificationService')
    return result
  }

  /** Routes an OTP dispatch by `action`, defaulting to `generate`. */
  private async dispatchOtp(
    tenantId: string,
    payload: OtpDispatchPayload
  ): Promise<OtpGenerateResult | OtpVerifyResult | void> {
    const otp = this.getOtp()
    // Each field of the payload is read once, here, and only these values are used below.
    const {
      action,
      recipient,
      purpose,
      userId,
      code,
      deliverVia,
      emailTemplate,
      emailData,
      locale
    } = copyByName(payload, OTP_PAYLOAD_KEYS) as unknown as OtpDispatchPayload
    const run = readOtpAction('NotificationService', action)
    const ref = {
      tenantId,
      recipient,
      purpose,
      ...(userId !== undefined ? { userId } : {})
    }
    const pending: Promise<OtpGenerateResult | OtpVerifyResult | void> =
      run === 'verify'
        ? otp.verify({ ...ref, code: code ?? '' })
        : run === 'consume'
          ? otp.consume(ref)
          : otp.generate({
              ...ref,
              ...(deliverVia !== undefined ? { deliverVia } : {}),
              ...(emailTemplate !== undefined ? { emailTemplate } : {}),
              ...(emailData !== undefined ? { emailData } : {}),
              ...(locale !== undefined ? { locale } : {})
            })
    // Awaited, not returned: returning a promise from an async function reads its `then`.
    const result = await pinOnce(pending, 'NotificationService')
    assertStandardRealmRoot('NotificationService')
    return result
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
}
