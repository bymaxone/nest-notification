/**
 * @fileoverview Dependency-injection tokens for the notification module.
 * @layer infrastructure
 *
 * Tokens are `Symbol`s, not strings, so they can never collide with another
 * library's provider tokens. They are exported publicly so a consumer can pull a
 * provider out of the container (e.g. `app.get(BYMAX_NOTIFICATION_EMAIL_PROVIDER)`)
 * to override or assert it in tests.
 */

/** Token for the resolved, frozen `ResolvedNotificationOptions`. */
export const BYMAX_NOTIFICATION_OPTIONS = Symbol('BYMAX_NOTIFICATION_OPTIONS')

/** Token for the registered `IEmailProvider`. */
export const BYMAX_NOTIFICATION_EMAIL_PROVIDER = Symbol('BYMAX_NOTIFICATION_EMAIL_PROVIDER')

/** Token for the registered `IOtpStorage`. */
export const BYMAX_NOTIFICATION_OTP_STORAGE = Symbol('BYMAX_NOTIFICATION_OTP_STORAGE')

/** Token for the registered `ISmsProvider` (v0.2). */
export const BYMAX_NOTIFICATION_SMS_PROVIDER = Symbol('BYMAX_NOTIFICATION_SMS_PROVIDER')

/** Token for the registered `IPushProvider` (v0.2). */
export const BYMAX_NOTIFICATION_PUSH_PROVIDER = Symbol('BYMAX_NOTIFICATION_PUSH_PROVIDER')

/** Token for the registered `IEmailTemplateRenderer`. */
export const BYMAX_NOTIFICATION_TEMPLATE_RENDERER = Symbol('BYMAX_NOTIFICATION_TEMPLATE_RENDERER')

/** Token for the registered `INotificationLogRepository`. */
export const BYMAX_NOTIFICATION_LOG_REPOSITORY = Symbol('BYMAX_NOTIFICATION_LOG_REPOSITORY')
