/**
 * @fileoverview Public configuration surface for `BymaxNotificationModule`.
 * @layer domain
 *
 * Declares the synchronous + async module options and every channel sub-interface.
 * Each `provider`/`storage`/`renderer`/`repository` field accepts either a ready
 * instance OR a class constructor — the module resolves the form at registration
 * time (`useValue` vs `useClass`).
 */

import type { FactoryProvider, ModuleMetadata } from '@nestjs/common'

import type { IEmailProvider } from './email-provider.interface'
import type { IEmailTemplateRenderer } from './email-template-renderer.interface'
import type { INotificationLogRepository } from './notification-log-repository.interface'
import type { IOtpStorage } from './otp-storage.interface'
import type { IPushProvider } from './push-provider.interface'
import type { ISmsProvider } from './sms-provider.interface'

/**
 * A class constructor that yields `T`. The `never[]` parameter list makes any
 * constructor assignable (parameters are contravariant), so the module can accept
 * a bare class reference for adapters whose dependencies NestJS can resolve.
 */
type Newable<T> = new (...args: never[]) => T

/**
 * Minimal, framework-agnostic request shape used by `global.tenantIdResolver`.
 * Compatible with both Express and Fastify request objects (both expose
 * `headers`; `hostname` is present on Express and Fastify >= 4). Cast to your
 * framework's request type inside the resolver.
 */
export interface NotificationRequest {
  headers: Record<string, string | string[] | undefined>
  hostname?: string
}

/** Library-wide settings applied across channels unless overridden. */
export interface GlobalOptions {
  /** Namespace prefixed to every storage key. Default: `'notification'`. */
  redisNamespace?: string
  /** Default template locale when the caller does not specify. Default: `'en'`. */
  defaultLocale?: string
  /**
   * Resolves the tenant id from the request. When provided, the module prefers
   * this source over a tenant id passed in the body/argument — preventing tenant
   * spoofing.
   *
   * What it returns must identify a tenant: a value that is not a string, is empty or
   * is whitespace-only is refused by the audit interceptor rather than recorded (see
   * `audit.swallowErrors` for what the caller then sees).
   */
  tenantIdResolver?: (req: NotificationRequest) => string | Promise<string>
}

/** Per-purpose OTP overrides (every field required when overriding). */
export interface OtpPurposeConfig {
  length: number
  codeType: 'numeric' | 'alpha' | 'alphanumeric'
  ttlSeconds: number
  maxAttempts: number
  resendCooldownSeconds: number
}

/** Email channel configuration. Omitted when the email channel is not used. */
export interface EmailChannelOptions {
  /** Send adapter (required). */
  provider: IEmailProvider | Newable<IEmailProvider>
  /** Default `from` address (required, e.g. `'noreply@example.com'`). */
  defaultFrom: string
  /** Default sender display name. */
  defaultFromName?: string
  /** Template renderer. Default: `DefaultTemplateRenderer` (`{{var}}` interpolation). */
  templateRenderer?: IEmailTemplateRenderer | Newable<IEmailTemplateRenderer>
  /** Default reply-to address. */
  defaultReplyTo?: string
  /** Default tags attached to every email. */
  defaultTags?: ReadonlyArray<{ name: string; value: string }>
  /**
   * Maximum total attachment size in bytes. `EmailService` sums attachment byte
   * lengths and throws `EMAIL_ATTACHMENTS_TOO_LARGE` when exceeded.
   * Default: `10_485_760` (10 MiB).
   */
  maxAttachmentBytes?: number
}

/** OTP channel configuration. Omitted when the OTP channel is not used. */
export interface OtpChannelOptions {
  /** Storage backend (required). Recommended default: `RedisOtpStorage`. */
  storage: IOtpStorage | Newable<IOtpStorage>
  /** Default code length. Default: `6`. */
  defaultLength?: number
  /** Default code charset. Default: `'numeric'`. */
  defaultCodeType?: 'numeric' | 'alpha' | 'alphanumeric'
  /** Default TTL in seconds. Default: `600`. */
  defaultTtlSeconds?: number
  /** Default maximum verification attempts. Default: `5`. */
  defaultMaxAttempts?: number
  /** Cooldown between resends of the same OTP. Default: `60`. */
  resendCooldownSeconds?: number
  /** When `true`, `verify()` consumes (deletes) the OTP on success. Default: `false`. */
  consumeOnVerify?: boolean
  /**
   * Secret under which a code is stored as an HMAC-SHA-256 digest instead of in plaintext.
   * At least 32 UTF-8 bytes, kept with the application and never in the store, so a reader
   * of the store alone cannot recover or test a code. Omitted: codes are stored in plaintext
   * and a warning is logged at startup. A plaintext entry written before the secret was set
   * still verifies until it expires; changing or removing the secret makes a stored digest
   * unverifiable, so those codes must be requested again.
   */
  codeSecret?: string
  /** Per-purpose overrides of the defaults above. */
  perPurpose?: Record<string, Partial<OtpPurposeConfig>>
}

/**
 * SMS channel configuration.
 *
 * Declared so consumers can plan code paths against a stable shape; no service
 * implements the channel and `validateOptions` rejects it at startup.
 */
export interface SmsChannelOptions {
  provider: ISmsProvider | Newable<ISmsProvider>
  defaultFrom?: string
  resendCooldownSeconds?: number
}

/**
 * Push channel configuration.
 *
 * Declared so consumers can plan code paths against a stable shape; no service
 * implements the channel and `validateOptions` rejects it at startup.
 */
export interface PushChannelOptions {
  provider: IPushProvider | Newable<IPushProvider>
  defaultTtlSeconds?: number
}

/** Audit-log configuration. Omitted when no audit sink is wired. */
export interface AuditOptions {
  /** Log repository (required). */
  repository: INotificationLogRepository | Newable<INotificationLogRepository>
  /** When `true`, audit failures do not propagate to the caller. Default: `true`. */
  swallowErrors?: boolean
  /**
   * Transforms the recipient before it is written to the audit entry — for PII
   * minimization (e.g. `'jane@acme.com'` -> `'j***@acme.com'`). When `to` is an
   * array, the mask is applied to each element and joined with `', '`.
   * Default: identity (recipient stored verbatim).
   */
  maskRecipient?: (recipient: string) => string
}

/** Top-level synchronous module options passed to `BymaxNotificationModule.forRoot`. */
export interface BymaxNotificationModuleOptions {
  /** Library-wide settings. */
  global?: GlobalOptions
  /** Email channel — registered only when present. */
  email?: EmailChannelOptions
  /** OTP channel — registered only when present. */
  otp?: OtpChannelOptions
  /** SMS channel — declared; rejected at startup. */
  sms?: SmsChannelOptions
  /** Push channel — declared; rejected at startup. */
  push?: PushChannelOptions
  /** Audit log — defaults to a no-op sink when absent. */
  audit?: AuditOptions
}

/**
 * Factory interface for the `useClass` / `useExisting` async pattern.
 *
 * Reserved — only `useFactory` is wired today.
 */
export interface BymaxNotificationModuleOptionsFactory {
  createNotificationOptions():
    BymaxNotificationModuleOptions | Promise<BymaxNotificationModuleOptions>
}

/**
 * Asynchronous module options passed to `BymaxNotificationModule.forRootAsync`.
 *
 * Only the `useFactory` + `inject` form is supported; `useClass`/`useExisting` are
 * reserved and rejected at registration.
 */
export interface BymaxNotificationModuleAsyncOptions {
  /** Modules to import so the factory's injected dependencies are available. */
  imports?: ModuleMetadata['imports']
  /** Providers injected into `useFactory`, in order. */
  inject?: FactoryProvider['inject']
  /**
   * Builds the module options at runtime. Injected dependencies (per `inject`)
   * arrive as positional arguments.
   */
  useFactory: (
    ...args: never[]
  ) => BymaxNotificationModuleOptions | Promise<BymaxNotificationModuleOptions>
}
