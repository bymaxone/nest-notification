/**
 * @fileoverview Barrel for the server interface contracts (types only).
 * @layer domain
 */

export type {
  IEmailProvider,
  EmailSendOptions,
  EmailSendResult,
  EmailAttachment
} from './email-provider.interface'

export type {
  IOtpStorage,
  OtpEntry,
  OtpVerifyResult,
  ConsumeAttemptResult
} from './otp-storage.interface'

export type { IEmailTemplateRenderer, RenderedEmail } from './email-template-renderer.interface'

export type {
  INotificationLogRepository,
  NotificationLogEntry,
  NotificationLogVerb
} from './notification-log-repository.interface'

export type { ISmsProvider, SmsSendOptions, SmsSendResult } from './sms-provider.interface'

export type { IPushProvider, PushSendOptions, PushSendResult } from './push-provider.interface'

export type {
  BymaxNotificationModuleOptions,
  BymaxNotificationModuleAsyncOptions,
  BymaxNotificationModuleOptionsFactory,
  GlobalOptions,
  NotificationRequest,
  EmailChannelOptions,
  OtpChannelOptions,
  OtpPurposeConfig,
  SmsChannelOptions,
  PushChannelOptions,
  AuditOptions
} from './notification-module-options.interface'
