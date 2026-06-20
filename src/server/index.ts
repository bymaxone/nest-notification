/**
 * @fileoverview Public entry point for the server subpath (`@bymax-one/nest-notification`).
 * @layer api
 *
 * Exposes the dynamic module, DI tokens, public interface types, reference
 * providers, the error catalog + exception, and the canonical purpose constants.
 * Internal implementation (config resolution internals, crypto utils) stays
 * internal until a later surface needs it.
 */

// Dynamic module
export { BymaxNotificationModule } from './bymax-notification.module'

// Services
export {
  EmailService,
  type EmailSendInput,
  type EmailSendTemplateInput
} from './services/email.service'
export {
  OtpService,
  type OtpGenerateInput,
  type OtpVerifyInput,
  type OtpConsumeInput,
  type OtpStatusInput,
  type OtpGenerateResult,
  type OtpStatusResult
} from './services/otp.service'
export {
  NotificationService,
  type DispatchInput,
  type DispatchResult,
  type EmailDispatchPayload,
  type OtpDispatchPayload
} from './services/notification.service'

// Injection tokens
export {
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_EMAIL_PROVIDER,
  BYMAX_NOTIFICATION_OTP_STORAGE,
  BYMAX_NOTIFICATION_SMS_PROVIDER,
  BYMAX_NOTIFICATION_PUSH_PROVIDER,
  BYMAX_NOTIFICATION_TEMPLATE_RENDERER,
  BYMAX_NOTIFICATION_LOG_REPOSITORY
} from './bymax-notification.constants'

// Canonical constants
export {
  NOTIFICATION_PURPOSES,
  type CanonicalNotificationPurpose
} from './constants/notification-purposes'
export {
  CANONICAL_EMAIL_TEMPLATES,
  type CanonicalEmailTemplate
} from './constants/canonical-templates'

// Interface contracts (types)
export type {
  IEmailProvider,
  EmailSendOptions,
  EmailSendResult,
  EmailAttachment,
  IOtpStorage,
  OtpEntry,
  OtpVerifyResult,
  ConsumeAttemptResult,
  IEmailTemplateRenderer,
  RenderedEmail,
  INotificationLogRepository,
  NotificationLogEntry,
  NotificationLogVerb,
  ISmsProvider,
  SmsSendOptions,
  SmsSendResult,
  IPushProvider,
  PushSendOptions,
  PushSendResult,
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
} from './interfaces'

// Resolved-options types (advanced consumers)
export type {
  ResolvedNotificationOptions,
  ResolvedGlobalOptions,
  ResolvedEmailOptions,
  ResolvedOtpOptions,
  ResolvedAuditOptions
} from './config/resolved-options'

// Reference providers
export { NoOpEmailProvider } from './providers/no-op-email.provider'
export { NoOpNotificationLogRepository } from './providers/no-op-notification-log.repository'
export {
  DefaultTemplateRenderer,
  type DefaultTemplateRendererOptions,
  type TemplateDefinition,
  type MissingVariableMode
} from './providers/default-template-renderer'
export {
  ResendEmailProvider,
  type ResendEmailProviderOptions
} from './providers/resend-email.provider'
export { InMemoryOtpStorage, type InMemoryStorageSize } from './providers/in-memory-otp.storage'
export {
  RedisOtpStorage,
  type RedisOtpStorageOptions,
  type RedisLike
} from './providers/redis-otp.storage'

// Utilities — for advanced consumers writing custom storages/providers
export { hashTenantRecipient } from './utils/hash'
export { generateOtpCode } from './utils/code-generator'
export { safeCompare } from './utils/timing-safe-compare'

// Errors and exception
export {
  NotificationException,
  NOTIFICATION_ERROR_DEFINITIONS,
  NOTIFICATION_ERROR_CODES,
  type NotificationErrorKey,
  type NotificationErrorDefinition
} from './errors'

// Convenience re-exports from the shared subpath
export type {
  OtpPurpose,
  NotificationChannel,
  NotificationErrorResponse,
  NotificationErrorCode
} from '../shared'
export { DEFAULT_TTLS } from '../shared'
