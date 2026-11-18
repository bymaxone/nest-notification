/**
 * @fileoverview Holds the metrics to what the README's "Metrics" table says: the three names, their
 * types and labels, one sample after each kind of event on the registry a scrape serves, every
 * series present at zero from the start, and a label set that stays the closed one however the
 * metrics are fed.
 * @layer observability
 */

import { BYMAX_METRICS_CONTRIBUTOR_METADATA } from '@bymax-one/nest-core/metrics'
import { Registry } from 'prom-client'

import {
  NOTIFICATION_METRIC_NAMES,
  NOTIFICATION_OTP_EVENTS,
  NOTIFICATION_SEND_CHANNELS,
  NOTIFICATION_SEND_OUTCOMES
} from './constants'
import { NotificationMetrics } from './notification-metrics'

/** The scrape text of the registry. */
async function scrape(registry: Registry): Promise<string> {
  return registry.metrics()
}

/** The sample lines of a scrape, comments left out. */
function samples(text: string): string[] {
  return text.split('\n').filter((line) => line !== '' && !line.startsWith('#'))
}

/** The value of one sample line, by its full name and labels. */
function valueOf(text: string, series: string): number | undefined {
  const line = samples(text).find((candidate) => candidate.startsWith(`${series} `))
  return line === undefined ? undefined : Number(line.slice(series.length + 1))
}

function registered(): { metrics: NotificationMetrics; registry: Registry } {
  const registry = new Registry()
  const metrics = new NotificationMetrics()
  metrics.registerMetrics(registry)
  return { metrics, registry }
}

describe('NotificationMetrics', () => {
  it('should be marked as a metrics contributor', () => {
    expect(Reflect.getMetadata(BYMAX_METRICS_CONTRIBUTOR_METADATA, NotificationMetrics)).toBe(true)
  })

  it('should publish the three metrics with their names, types, help and labels', async () => {
    const text = await scrape(registered().registry)

    expect(text).toContain(`# TYPE ${NOTIFICATION_METRIC_NAMES.messages} counter`)
    expect(text).toContain(`# TYPE ${NOTIFICATION_METRIC_NAMES.sendDuration} histogram`)
    expect(text).toContain(`# TYPE ${NOTIFICATION_METRIC_NAMES.otp} counter`)
    for (const name of Object.values(NOTIFICATION_METRIC_NAMES)) {
      expect(text).toMatch(new RegExp(`# HELP ${name} .{20,}`))
    }
    expect(Object.values(NOTIFICATION_METRIC_NAMES)).toEqual([
      'bymax_notification_messages_total',
      'bymax_notification_send_duration_seconds',
      'bymax_notification_otp_total'
    ])
  })

  it('should have every series at zero before anything happens', async () => {
    const text = await scrape(registered().registry)

    for (const channel of NOTIFICATION_SEND_CHANNELS) {
      for (const outcome of NOTIFICATION_SEND_OUTCOMES) {
        expect(
          valueOf(
            text,
            `${NOTIFICATION_METRIC_NAMES.messages}{channel="${channel}",outcome="${outcome}"}`
          )
        ).toBe(0)
      }
      expect(
        valueOf(text, `${NOTIFICATION_METRIC_NAMES.sendDuration}_count{channel="${channel}"}`)
      ).toBe(0)
    }
    for (const event of NOTIFICATION_OTP_EVENTS) {
      expect(valueOf(text, `${NOTIFICATION_METRIC_NAMES.otp}{event="${event}"}`)).toBe(0)
    }
  })

  it.each(NOTIFICATION_SEND_OUTCOMES)('should count a %s send and time it', async (outcome) => {
    const { metrics, registry } = registered()

    metrics.onSend({ channel: 'email', outcome, seconds: 0.25 })

    const text = await scrape(registry)
    expect(
      valueOf(text, `${NOTIFICATION_METRIC_NAMES.messages}{channel="email",outcome="${outcome}"}`)
    ).toBe(1)
    expect(valueOf(text, `${NOTIFICATION_METRIC_NAMES.sendDuration}_count{channel="email"}`)).toBe(
      1
    )
    expect(valueOf(text, `${NOTIFICATION_METRIC_NAMES.sendDuration}_sum{channel="email"}`)).toBe(
      0.25
    )
  })

  it.each(NOTIFICATION_OTP_EVENTS)('should count a %s code event', async (event) => {
    const { metrics, registry } = registered()

    metrics.onOtp({ event })
    metrics.onOtp({ event })

    expect(
      valueOf(await scrape(registry), `${NOTIFICATION_METRIC_NAMES.otp}{event="${event}"}`)
    ).toBe(2)
  })

  // The label sets are the closed ones, whatever the caller supplies: the same series, before and
  // after, so no identifier, recipient or error text can ever become a label.
  it('should keep the series it started with however it is fed', async () => {
    const { metrics, registry } = registered()
    const before = samples(await scrape(registry)).map((line) => line.split(' ')[0])

    metrics.onSend({ channel: 'sms' as never, outcome: 'sent', seconds: 1 })
    metrics.onSend({ channel: 'email', outcome: 'jane@acme.com' as never, seconds: 1 })
    metrics.onOtp({ event: 'tenant-42' as never })
    metrics.onOtp({ event: '__proto__' as never })

    const after = samples(await scrape(registry)).map((line) => line.split(' ')[0])
    expect(after).toEqual(before)
  })

  it('should record nothing, and not throw, before it is registered', () => {
    const metrics = new NotificationMetrics()

    expect(() => {
      metrics.onSend({ channel: 'email', outcome: 'sent', seconds: 1 })
      metrics.onOtp({ event: 'issued' })
    }).not.toThrow()
  })
})
