/**
 * @fileoverview Publishes what the services report as Prometheus metrics, on the registry the
 * application's scrape endpoint serves: messages by channel and outcome, how long a send took, and
 * what happens to codes.
 * @layer observability
 *
 * Marked as a contributor, so `BymaxCoreModule` calls it once at bootstrap with the registry. Until
 * then, and in an application with metrics off, it records nothing. Every series that can exist is
 * created at zero when the metrics are registered, so a rate is defined from the first scrape, and a
 * label value outside the closed sets is dropped, so no caller can make the series grow.
 */

import { BymaxMetricsContributor } from '@bymax-one/nest-core/metrics'
import type { IMetricsContributor, MetricsRegistry } from '@bymax-one/nest-core/metrics'
import { Injectable } from '@nestjs/common'
import { Counter, Histogram } from 'prom-client'

import type {
  INotificationObserver,
  NotificationOtpEvent,
  NotificationSendEvent
} from '../server/interfaces/notification-observer.interface'
import {
  NOTIFICATION_METRIC_NAMES,
  NOTIFICATION_OTP_EVENTS,
  NOTIFICATION_SEND_CHANNELS,
  NOTIFICATION_SEND_OUTCOMES
} from './constants'

/** Whether `value` is one of the closed `values`. */
function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value)
}

/**
 * Counts sends and codes, and times sends, as metrics.
 *
 * Provide it, and hand it to the services as their observer with
 * `NotificationObservabilityModule`, which does both.
 */
@BymaxMetricsContributor()
@Injectable()
export class NotificationMetrics implements IMetricsContributor, INotificationObserver {
  #messages: Counter<'channel' | 'outcome'> | undefined
  #duration: Histogram<'channel'> | undefined
  #otp: Counter<'event'> | undefined

  /**
   * Registers the collectors against the scrape registry, every series at zero.
   *
   * @param registry - The registry the scrape endpoint serves.
   */
  registerMetrics(registry: MetricsRegistry): void {
    this.#messages = new Counter({
      name: NOTIFICATION_METRIC_NAMES.messages,
      help: 'Messages the library was asked to send, by channel and how the send ended.',
      labelNames: ['channel', 'outcome'],
      registers: [registry]
    })
    this.#duration = new Histogram({
      name: NOTIFICATION_METRIC_NAMES.sendDuration,
      help: 'Seconds a send took, by channel, from the call to its end.',
      labelNames: ['channel'],
      registers: [registry]
    })
    this.#otp = new Counter({
      name: NOTIFICATION_METRIC_NAMES.otp,
      help: 'What happened to one-time codes: issued, verified, refused or locked out.',
      labelNames: ['event'],
      registers: [registry]
    })
    for (const channel of NOTIFICATION_SEND_CHANNELS) {
      this.#duration.zero({ channel })
      for (const outcome of NOTIFICATION_SEND_OUTCOMES) {
        this.#messages.inc({ channel, outcome }, 0)
      }
    }
    for (const event of NOTIFICATION_OTP_EVENTS) {
      this.#otp.inc({ event }, 0)
    }
  }

  /**
   * Counts a send that ended and records how long it took.
   *
   * @param event - The channel, the outcome and the duration in seconds.
   */
  onSend(event: NotificationSendEvent): void {
    if (
      !isOneOf(NOTIFICATION_SEND_CHANNELS, event.channel) ||
      !isOneOf(NOTIFICATION_SEND_OUTCOMES, event.outcome)
    ) {
      return
    }
    this.#messages?.inc({ channel: event.channel, outcome: event.outcome })
    this.#duration?.observe({ channel: event.channel }, event.seconds)
  }

  /**
   * Counts something that happened to a code.
   *
   * @param event - What happened.
   */
  onOtp(event: NotificationOtpEvent): void {
    if (isOneOf(NOTIFICATION_OTP_EVENTS, event.event)) {
      this.#otp?.inc({ event: event.event })
    }
  }
}
