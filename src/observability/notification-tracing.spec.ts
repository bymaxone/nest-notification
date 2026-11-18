/**
 * @fileoverview Holds the tracing adapter to the README's "Traces" table: a span named for the
 * operation, with the channel as its only attribute, ended however the operation settles, marked as
 * an error with the library's code and never its text, and silent when no SDK is registered.
 * @layer observability
 */

import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { Span, Tracer } from '@opentelemetry/api'

import { NotificationException } from '../server/errors/notification-exception'

import { NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE, NOTIFICATION_TRACER_NAME } from './constants'
import { NotificationTracing } from './notification-tracing'

interface RecordedSpan {
  name: string
  attributes: Record<string, unknown>
  ended: number
  status: { code: SpanStatusCode; message?: string | undefined } | undefined
}

const recorded: RecordedSpan[] = []
const requestedTracers: string[] = []

/** A tracer whose active spans are recorded, so a case can read what the adapter did to them. */
const tracer = {
  startActiveSpan: (
    name: string,
    options: { attributes?: Record<string, unknown> },
    run: (span: Span) => unknown
  ): unknown => {
    const entry: RecordedSpan = {
      name,
      attributes: { ...options.attributes },
      ended: 0,
      status: undefined
    }
    recorded.push(entry)
    const span = {
      setStatus: (status: RecordedSpan['status']): void => {
        entry.status = status
      },
      end: (): void => {
        entry.ended += 1
      }
    }
    return run(span as unknown as Span)
  }
} as unknown as Tracer

beforeAll(() => {
  trace.setGlobalTracerProvider({
    getTracer: (name: string): Tracer => {
      requestedTracers.push(name)
      return tracer
    }
  })
})

beforeEach(() => {
  recorded.length = 0
  requestedTracers.length = 0
})

describe('NotificationTracing', () => {
  it('should run the operation in a span named for it, carrying only the channel', async () => {
    const result = await new NotificationTracing().span(
      'notification.send',
      { channel: 'email' },
      async () => 'done'
    )

    expect(result).toBe('done')
    expect(requestedTracers).toEqual([NOTIFICATION_TRACER_NAME])
    expect(NOTIFICATION_TRACER_NAME).toBe('@bymax-one/nest-notification')
    expect(recorded).toEqual([
      {
        name: 'notification.send',
        attributes: { [NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE]: 'email' },
        ended: 1,
        status: undefined
      }
    ])
    expect(NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE).toBe('bymax.notification.channel')
  })

  it('should name the verification span too', async () => {
    await new NotificationTracing().span(
      'notification.otp.verify',
      { channel: 'otp' },
      async () => 1
    )

    expect(recorded[0]?.name).toBe('notification.otp.verify')
    expect(recorded[0]?.attributes).toEqual({ [NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE]: 'otp' })
  })

  it('should mark a library failure as an error with its code and end the span', async () => {
    const failure = new NotificationException('EMAIL_SEND_FAILED', { providerName: 'relay' })

    await expect(
      new NotificationTracing().span('notification.send', { channel: 'email' }, async () => {
        throw failure
      })
    ).rejects.toBe(failure)

    expect(recorded[0]?.ended).toBe(1)
    expect(recorded[0]?.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'notification.email_send_failed'
    })
  })

  it('should never put the text of a failure in the status', async () => {
    await expect(
      new NotificationTracing().span('notification.send', { channel: 'email' }, async () => {
        throw new Error('550 rejected jane@acme.com, password hunter2')
      })
    ).rejects.toThrow('550 rejected')

    expect(recorded[0]?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'unknown' })
    expect(JSON.stringify(recorded[0])).not.toContain('hunter2')
    expect(JSON.stringify(recorded[0])).not.toContain('jane@acme.com')
  })
})
