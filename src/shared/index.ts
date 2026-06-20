/**
 * @fileoverview Public entry point for the shared subpath (`@bymax-one/nest-notification/shared`).
 * @layer api
 *
 * Zero-dependency public types and constants importable from any runtime
 * (backend or frontend). Nothing behind this barrel reaches for NestJS or a
 * Node builtin — keep it that way so the subpath stays universal.
 */

export type { OtpPurpose } from './types/otp-purpose.types'
export type { NotificationChannel } from './types/notification-channel.types'
export type { NotificationErrorResponse } from './types/notification-error.types'
export { NOTIFICATION_ERROR_CODES, type NotificationErrorCode } from './constants/error-codes'
export { DEFAULT_TTLS } from './constants/default-ttls'
