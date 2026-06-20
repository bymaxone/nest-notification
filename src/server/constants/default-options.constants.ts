/**
 * @fileoverview Default values applied to each channel during option resolution.
 * @layer domain
 *
 * The single source of truth for every fallback the resolver layers over the
 * consumer-supplied options. `as const satisfies Partial<...>` preserves the
 * literal types while pinning each object to the shape of its option interface.
 */

import type {
  AuditOptions,
  EmailChannelOptions,
  GlobalOptions,
  OtpChannelOptions
} from '../interfaces/notification-module-options.interface'

/** Maximum total email attachment size, in bytes (10 MiB). */
export const DEFAULT_MAX_ATTACHMENT_BYTES = 10_485_760

/** Global defaults — always present in the resolved options. */
export const DEFAULT_GLOBAL_OPTIONS = {
  redisNamespace: 'notification',
  defaultLocale: 'en'
} as const satisfies Partial<GlobalOptions>

/** OTP channel defaults. */
export const DEFAULT_OTP_OPTIONS = {
  defaultLength: 6,
  defaultCodeType: 'numeric',
  defaultTtlSeconds: 600,
  defaultMaxAttempts: 5,
  resendCooldownSeconds: 60,
  consumeOnVerify: false,
  perPurpose: {}
} as const satisfies Partial<OtpChannelOptions>

/** Email channel defaults. */
export const DEFAULT_EMAIL_OPTIONS = {
  defaultTags: [] as ReadonlyArray<{ name: string; value: string }>,
  maxAttachmentBytes: DEFAULT_MAX_ATTACHMENT_BYTES
} as const satisfies Partial<EmailChannelOptions>

/** Audit defaults — audit writes are fire-and-forget by default. */
export const DEFAULT_AUDIT_OPTIONS = {
  swallowErrors: true
} as const satisfies Partial<AuditOptions>
