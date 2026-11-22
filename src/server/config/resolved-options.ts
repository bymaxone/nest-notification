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
import { NOTIFICATION_PURPOSES } from '../constants/notification-purposes'
import type {
  BymaxNotificationModuleOptions,
  EmailChannelOptions,
  GlobalOptions,
  NotificationRequest,
  OtpChannelOptions,
  OtpPurposeConfig
} from '../interfaces/notification-module-options.interface'
import { createCodeDigester } from '../utils/code-digest'
import { nullProto } from '../utils/read-options'

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
  maxRecipients: number
}

/** Resolved OTP section — present only when the OTP channel is configured. */
export interface ResolvedOtpOptions {
  defaultLength: number
  defaultCodeType: 'numeric' | 'alpha' | 'alphanumeric'
  defaultTtlSeconds: number
  defaultMaxAttempts: number
  resendCooldownSeconds: number
  consumeOnVerify: boolean
  /**
   * Turns a plaintext code into the value that is stored; present only when `codeSecret`
   * is configured. A function rather than the secret, so the secret is not a property of
   * an object that is injected under a public token and can be logged or serialized.
   */
  digestCode?: (code: string) => string
  /** Per-purpose overrides, each fully resolved against the OTP defaults. */
  perPurpose: Record<string, OtpPurposeConfig>
  /** Effective config for a purpose: the resolved `perPurpose[purpose]`, or the OTP defaults. */
  resolveForPurpose(purpose: string): OtpPurposeConfig
  /** Whether an operation whose purpose is not registered is refused. */
  strictPurposes: boolean
  /** Whether `purpose` is one of the canonical purposes or a key of `perPurpose`. */
  isRegisteredPurpose(purpose: string): boolean
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
  // Every section has no prototype: an option that is not set is absent, and does not answer with a
  // key planted on the realm root.
  const resolved: ResolvedNotificationOptions = nullProto({
    global: nullProto(resolveGlobal(options.global)),
    audit: nullProto(resolveAudit(options)),
    ...(options.email ? { email: nullProto(resolveEmail(options.email)) } : {}),
    ...(options.otp ? { otp: nullProto(resolveOtp(options.otp)) } : {})
  })
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
    maxRecipients: email.maxRecipients ?? DEFAULT_EMAIL_OPTIONS.maxRecipients,
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
  const perPurpose = nullProto(Object.fromEntries(entries))
  const perPurposeMap = new Map<string, OtpPurposeConfig>(entries)
  // A Set, not an object: an object lookup finds 'constructor' and 'toString' through its prototype.
  const registered = new Set<string>([
    ...Object.values(NOTIFICATION_PURPOSES),
    ...perPurposeMap.keys()
  ])
  return {
    defaultLength: base.length,
    defaultCodeType: base.codeType,
    defaultTtlSeconds: base.ttlSeconds,
    defaultMaxAttempts: base.maxAttempts,
    resendCooldownSeconds: base.resendCooldownSeconds,
    consumeOnVerify: otp.consumeOnVerify ?? DEFAULT_OTP_OPTIONS.consumeOnVerify,
    ...(otp.codeSecret !== undefined ? { digestCode: createCodeDigester(otp.codeSecret) } : {}),
    perPurpose,
    resolveForPurpose: (purpose: string): OtpPurposeConfig => perPurposeMap.get(purpose) ?? base,
    strictPurposes: otp.strictPurposes ?? false,
    isRegisteredPurpose: (purpose: string): boolean => registered.has(purpose)
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
