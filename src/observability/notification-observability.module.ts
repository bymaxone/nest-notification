/**
 * @fileoverview Wires the observability pieces to the services: it provides the metrics, the
 * tracing and the readiness check, and registers the one observer the services call.
 * @layer observability
 */

import { Global, Module } from '@nestjs/common'
import type { DynamicModule } from '@nestjs/common'

import { BYMAX_NOTIFICATION_OBSERVER } from '@bymax-one/nest-notification'
import type { INotificationObserver } from '@bymax-one/nest-notification'

import {
  NotificationHealthIndicator,
  NOTIFICATION_HEALTH_OPTIONS
} from './notification-health.indicator'
import type { NotificationHealthOptions } from './notification-health.indicator'
import { NotificationMetrics } from './notification-metrics'
import { NotificationTracing } from './notification-tracing'

/** What `NotificationObservabilityModule.register` takes; every field is optional. */
export interface NotificationObservabilityOptions {
  /** How the readiness check caches and bounds its verification. */
  readonly health?: NotificationHealthOptions
}

/**
 * The observer the services call: metrics for the counts and the durations, tracing for the spans.
 *
 * @param metrics - Where sends and code events are counted.
 * @param tracing - Where operations run inside spans.
 * @returns The observer to register under `BYMAX_NOTIFICATION_OBSERVER`.
 */
function composeObserver(
  metrics: NotificationMetrics,
  tracing: NotificationTracing
): INotificationObserver {
  return {
    onSend: (event): void => {
      metrics.onSend(event)
    },
    onOtp: (event): void => {
      metrics.onOtp(event)
    },
    span: (name, attributes, run) => tracing.span(name, attributes, run)
  }
}

/**
 * Global, so the services of `BymaxNotificationModule` see the observer without an import. Import
 * it once, after `BymaxNotificationModule`:
 *
 * ```ts
 * imports: [BymaxNotificationModule.forRoot(options), NotificationObservabilityModule.register()]
 * ```
 */
@Global()
@Module({})
export class NotificationObservabilityModule {
  /**
   * Registers the providers and the observer.
   *
   * @param options - The readiness check's options.
   * @returns The dynamic module.
   */
  static register(options: NotificationObservabilityOptions = {}): DynamicModule {
    return {
      module: NotificationObservabilityModule,
      global: true,
      providers: [
        NotificationMetrics,
        NotificationTracing,
        { provide: NOTIFICATION_HEALTH_OPTIONS, useValue: options.health ?? {} },
        NotificationHealthIndicator,
        {
          provide: BYMAX_NOTIFICATION_OBSERVER,
          useFactory: composeObserver,
          inject: [NotificationMetrics, NotificationTracing]
        }
      ],
      exports: [BYMAX_NOTIFICATION_OBSERVER, NotificationMetrics, NotificationHealthIndicator]
    }
  }
}
