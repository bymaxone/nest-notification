/**
 * @fileoverview Recommended OTP/cooldown TTLs for the shared subpath.
 * @layer shared
 *
 * Zero-dependency reference values a consumer can wire into per-purpose OTP
 * config (or display as "expires in N minutes" in the UI). They are suggestions,
 * not enforced defaults — the server defaults live in the OTP channel options.
 */

/**
 * Recommended time-to-live values (in seconds), with rationale per entry.
 */
export const DEFAULT_TTLS = {
  /** Email verification: 1h — lets the user check their inbox at leisure. */
  OTP_EMAIL_VERIFICATION_SECONDS: 3600,
  /** Password reset: 10min — short window limits exposure of a sensitive flow. */
  OTP_PASSWORD_RESET_SECONDS: 600,
  /** MFA out-of-band: 5min — tight window for an interactive challenge. */
  OTP_MFA_OOB_SECONDS: 300,
  /** Phone verification: 10min — covers SMS delivery latency. */
  OTP_PHONE_VERIFICATION_SECONDS: 600,
  /** Magic link: 15min — slightly longer; a URL is often opened on another device. */
  OTP_MAGIC_LINK_SECONDS: 900,
  /** Resend cooldown: 60s — throttles repeated sends to the same recipient. */
  RESEND_COOLDOWN_SECONDS: 60,
  /** Generic fallback: 10min — used when no purpose-specific TTL applies. */
  OTP_GENERIC_SECONDS: 600
} as const
