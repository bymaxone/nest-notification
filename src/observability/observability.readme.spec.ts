/**
 * @fileoverview Holds the README's observability sections to what the subpath publishes: every
 * metric is a row with its type and each of its label values, both spans and the readiness check are
 * named, and the closed value sets of the constants are the ones the table lists.
 * @layer observability
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  NOTIFICATION_HEALTH_NAME,
  NOTIFICATION_METRIC_NAMES,
  NOTIFICATION_OTP_EVENTS,
  NOTIFICATION_SEND_CHANNELS,
  NOTIFICATION_SEND_OUTCOMES,
  NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE
} from './constants'

const README = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')
const start = README.indexOf('### Metrics')
const SECTION = README.slice(start, README.indexOf('\n## ', start))

/** The row of the Metrics table that starts with a metric's name. */
function rowOf(name: string): string {
  return SECTION.split('\n').find((line) => line.startsWith(`| \`${name}\``)) ?? ''
}

describe('README observability sections', () => {
  it.each([
    [
      NOTIFICATION_METRIC_NAMES.messages,
      'counter',
      ['channel', ...NOTIFICATION_SEND_CHANNELS, 'outcome', ...NOTIFICATION_SEND_OUTCOMES]
    ],
    [
      NOTIFICATION_METRIC_NAMES.sendDuration,
      'histogram',
      ['channel', ...NOTIFICATION_SEND_CHANNELS]
    ],
    [NOTIFICATION_METRIC_NAMES.otp, 'counter', ['event', ...NOTIFICATION_OTP_EVENTS]]
  ])('should list %s as a %s with every label and label value', (name, type, words) => {
    const row = rowOf(name)

    expect(row).not.toBe('')
    expect(row).toContain(`| ${type} `)
    for (const word of words) {
      expect(row).toContain(`\`${word}\``)
    }
  })

  it('should list no metric the subpath does not publish', () => {
    const rows = SECTION.split('\n').filter((line) => /^\| `bymax_notification_/.test(line))

    expect(rows).toHaveLength(Object.keys(NOTIFICATION_METRIC_NAMES).length)
  })

  it('should name both spans, their attribute and the readiness check', () => {
    expect(README).toContain('`notification.send`')
    expect(README).toContain('`notification.otp.verify`')
    expect(README).toContain(`\`${NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE}\``)
    expect(README).toContain(`under the name \`${NOTIFICATION_HEALTH_NAME}\``)
  })
})
