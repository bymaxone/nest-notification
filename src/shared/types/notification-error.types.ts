/**
 * @fileoverview Public error-response envelope for the shared subpath.
 * @layer shared
 *
 * Zero-dependency type mirroring the body shape `NotificationException` emits on
 * the server, so a frontend can type the parsed JSON and match on `error.code`.
 */

/**
 * The JSON envelope every `NotificationException` serializes to.
 *
 * The frontend matches on `error.code` (a stable identifier from
 * `NOTIFICATION_ERROR_CODES`) to render a localized message; `error.message` is
 * the English default; `error.details` carries optional structured context and
 * is `null` when absent.
 */
export interface NotificationErrorResponse {
  error: {
    code: string
    message: string
    details: Record<string, unknown> | null
  }
}
