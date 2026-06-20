/**
 * @fileoverview Resolution of module options into the frozen runtime shape.
 * @layer application
 *
 * `resolveOptions` merges consumer options with the channel defaults and publishes
 * `ResolvedNotificationOptions` under `BYMAX_NOTIFICATION_OPTIONS` — the value every
 * service injects. Channel sections are omitted when the consumer did not configure
 * them, enabling `if (resolved.email)` narrowing; the result is deep-frozen so a
 * service cannot mutate shared config at runtime.
 *
 * Provider/storage/renderer/repository instances are NOT nested here — they are
 * registered under their own DI tokens, keeping this object pure scalar config.
 */

import {
  DEFAULT_AUDIT_OPTIONS,
  DEFAULT_EMAIL_OPTIONS,
  DEFAULT_GLOBAL_OPTIONS,
  DEFAULT_OTP_OPTIONS
} from '../constants/default-options.constants'
import type {
  BymaxNotificationModuleOptions,
  EmailChannelOptions,
  GlobalOptions,
  NotificationRequest,
  OtpChannelOptions,
  OtpPurposeConfig
} from '../interfaces/notification-module-options.interface'

/** Resolved global section — always present. */
export interface ResolvedGlobalOptions {
  redisNamespace: string
  defaultLocale: string
  tenantIdResolver?: (req: NotificationRequest) => string | Promise<string>
}

/** Resolved email section — present only when the email channel is configured. */
export interface ResolvedEmailOptions {
  defaultFrom: string
  defaultFromName?: string
  defaultReplyTo?: string
  defaultTags: ReadonlyArray<{ name: string; value: string }>
  maxAttachmentBytes: number
}

/** Resolved OTP section — present only when the OTP channel is configured. */
export interface ResolvedOtpOptions {
  defaultLength: number
  defaultCodeType: 'numeric' | 'alpha' | 'alphanumeric'
  defaultTtlSeconds: number
  defaultMaxAttempts: number
  resendCooldownSeconds: number
  consumeOnVerify: boolean
  /** Per-purpose overrides, each fully resolved against the OTP defaults. */
  perPurpose: Record<string, OtpPurposeConfig>
  /** Effective config for a purpose: the resolved `perPurpose[purpose]`, or the OTP defaults. */
  resolveForPurpose(purpose: string): OtpPurposeConfig
}

/** Resolved audit section — always present; the no-op sink obeys these settings too. */
export interface ResolvedAuditOptions {
  swallowErrors: boolean
  maskRecipient: (recipient: string) => string
}

/** The fully resolved, frozen module options injected under `BYMAX_NOTIFICATION_OPTIONS`. */
export interface ResolvedNotificationOptions {
  global: ResolvedGlobalOptions
  email?: ResolvedEmailOptions
  otp?: ResolvedOtpOptions
  audit: ResolvedAuditOptions
}

/**
 * Merges consumer options with defaults and returns a deep-frozen result.
 *
 * @param options - The consumer-supplied module options (already validated).
 * @returns The resolved, recursively frozen options.
 */
export function resolveOptions(
  options: BymaxNotificationModuleOptions
): Readonly<ResolvedNotificationOptions> {
  const resolved: ResolvedNotificationOptions = {
    global: resolveGlobal(options.global),
    audit: resolveAudit(options),
    ...(options.email ? { email: resolveEmail(options.email) } : {}),
    ...(options.otp ? { otp: resolveOtp(options.otp) } : {})
  }
  return deepFreeze(resolved)
}

/** Builds the always-present global section. */
function resolveGlobal(global: GlobalOptions | undefined): ResolvedGlobalOptions {
  return {
    redisNamespace: global?.redisNamespace ?? DEFAULT_GLOBAL_OPTIONS.redisNamespace,
    defaultLocale: global?.defaultLocale ?? DEFAULT_GLOBAL_OPTIONS.defaultLocale,
    ...(global?.tenantIdResolver ? { tenantIdResolver: global.tenantIdResolver } : {})
  }
}

/** Builds the email section from the configured email options. */
function resolveEmail(email: EmailChannelOptions): ResolvedEmailOptions {
  return {
    defaultFrom: email.defaultFrom,
    defaultTags: email.defaultTags ?? DEFAULT_EMAIL_OPTIONS.defaultTags,
    maxAttachmentBytes: email.maxAttachmentBytes ?? DEFAULT_EMAIL_OPTIONS.maxAttachmentBytes,
    ...(email.defaultFromName !== undefined ? { defaultFromName: email.defaultFromName } : {}),
    ...(email.defaultReplyTo !== undefined ? { defaultReplyTo: email.defaultReplyTo } : {})
  }
}

/** Builds the OTP section, including the per-purpose resolver. */
function resolveOtp(otp: OtpChannelOptions): ResolvedOtpOptions {
  const base: OtpPurposeConfig = Object.freeze({
    length: otp.defaultLength ?? DEFAULT_OTP_OPTIONS.defaultLength,
    codeType: otp.defaultCodeType ?? DEFAULT_OTP_OPTIONS.defaultCodeType,
    ttlSeconds: otp.defaultTtlSeconds ?? DEFAULT_OTP_OPTIONS.defaultTtlSeconds,
    maxAttempts: otp.defaultMaxAttempts ?? DEFAULT_OTP_OPTIONS.defaultMaxAttempts,
    resendCooldownSeconds: otp.resendCooldownSeconds ?? DEFAULT_OTP_OPTIONS.resendCooldownSeconds
  })
  const entries = Object.entries(otp.perPurpose ?? {}).map(
    ([purpose, partial]) => [purpose, { ...base, ...partial }] as const
  )
  const perPurpose = Object.fromEntries(entries)
  const perPurposeMap = new Map<string, OtpPurposeConfig>(entries)
  return {
    defaultLength: base.length,
    defaultCodeType: base.codeType,
    defaultTtlSeconds: base.ttlSeconds,
    defaultMaxAttempts: base.maxAttempts,
    resendCooldownSeconds: base.resendCooldownSeconds,
    consumeOnVerify: otp.consumeOnVerify ?? DEFAULT_OTP_OPTIONS.consumeOnVerify,
    perPurpose,
    resolveForPurpose: (purpose: string): OtpPurposeConfig => perPurposeMap.get(purpose) ?? base
  }
}

/** Builds the always-present audit section. */
function resolveAudit(options: BymaxNotificationModuleOptions): ResolvedAuditOptions {
  return {
    swallowErrors: options.audit?.swallowErrors ?? DEFAULT_AUDIT_OPTIONS.swallowErrors,
    maskRecipient: options.audit?.maskRecipient ?? ((recipient: string): string => recipient)
  }
}

/**
 * Recursively freezes an object graph so mutation throws in strict mode. Uses
 * `Object.values` (never bracket access) to avoid an object-injection sink, and
 * `Object(value) === value` to recurse into objects and functions but stop at
 * primitives.
 */
function deepFreeze<T>(value: T): T {
  if (Object(value) === value) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested)
    }
    Object.freeze(value)
  }
  return value
}
