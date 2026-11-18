/**
 * @fileoverview Public entry point of the observability subpath
 * (`@bymax-one/nest-notification/observability`): metrics, spans and a readiness check for the
 * notification services. It needs the optional peers `@bymax-one/nest-core`, `prom-client` and
 * `@opentelemetry/api`; the main entry imports none of them.
 * @layer api
 */

export {
  NOTIFICATION_HEALTH_NAME,
  NOTIFICATION_METRIC_NAMES,
  NOTIFICATION_OTP_EVENTS,
  NOTIFICATION_SEND_CHANNELS,
  NOTIFICATION_SEND_OUTCOMES,
  NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE,
  NOTIFICATION_TRACER_NAME
} from './constants'
export {
  NotificationHealthIndicator,
  NOTIFICATION_HEALTH_OPTIONS,
  type NotificationHealthOptions
} from './notification-health.indicator'
export { NotificationMetrics } from './notification-metrics'
export {
  NotificationObservabilityModule,
  type NotificationObservabilityOptions
} from './notification-observability.module'
export { NotificationTracing } from './notification-tracing'
