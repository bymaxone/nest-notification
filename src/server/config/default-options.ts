/**
 * @fileoverview Config-layer validation constants (charsets + length bounds).
 * @layer application
 *
 * Small, shared constants consumed by both `validateOptions` and `resolveOptions`.
 * The resolution default *values* live in `constants/default-options.constants.ts`;
 * this file holds the validation-domain limits (valid code types, OTP length range).
 */

/** The OTP code charsets the library accepts. */
export const VALID_CODE_TYPES = ['numeric', 'alpha', 'alphanumeric'] as const

/** Minimum permitted OTP length (inclusive). */
export const OTP_MIN_LENGTH = 1

/** Maximum permitted OTP length (inclusive). */
export const OTP_MAX_LENGTH = 32
