/**
 * @fileoverview The names and the closed value sets of everything the observability subpath
 * publishes: three metrics, two spans, one readiness check. Every label value comes from one of the
 * sets below, so nothing a caller supplies can become a label and the series cannot grow.
 * @layer observability
 */

/** The metrics, by what they count. Names follow `bymax_<library>_<thing>_<unit>`. */
export const NOTIFICATION_METRIC_NAMES = {
  messages: 'bymax_notification_messages_total',
  sendDuration: 'bymax_notification_send_duration_seconds',
  otp: 'bymax_notification_otp_total'
} as const

/** The channels a send is counted on. */
export const NOTIFICATION_SEND_CHANNELS = ['email', 'push'] as const

/** How a send ends. */
export const NOTIFICATION_SEND_OUTCOMES = ['sent', 'failed', 'rejected'] as const

/** What happens to a code. */
export const NOTIFICATION_OTP_EVENTS = ['issued', 'verified', 'failed', 'locked'] as const

/** The attribute a span carries, in the `bymax.<library>.<attribute>` form. */
export const NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE = 'bymax.notification.channel'

/** The name the tracer is asked for. */
export const NOTIFICATION_TRACER_NAME = '@bymax-one/nest-notification'

/** The name the readiness check reports under. */
export const NOTIFICATION_HEALTH_NAME = 'notification'
