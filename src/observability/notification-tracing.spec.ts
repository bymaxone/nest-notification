/**
 * @fileoverview Holds the tracing adapter to the README's "Traces" table: a span named for the
 * operation, with the channel as its only attribute, ended however the operation settles, marked as
 * an error with the library's code and never its text, and silent when no SDK is registered.
 * @layer observability
 */

import { INVALID_SPAN_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api'
import type {
  Context,
  Link,
  Span,
  SpanContext,
  SpanOptions,
  SpanStatus,
  Tracer
} from '@opentelemetry/api'

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

/** A span that writes what the adapter does to it into a record, and does nothing else. */
class RecordingSpan implements Span {
  constructor(private readonly entry: RecordedSpan) {}

  spanContext(): SpanContext {
    return INVALID_SPAN_CONTEXT
  }

  setAttribute(): this {
    return this
  }

  setAttributes(): this {
    return this
  }

  addEvent(): this {
    return this
  }

  addLink(_link: Link): this {
    return this
  }

  addLinks(_links: Link[]): this {
    return this
  }

  setStatus(status: SpanStatus): this {
    this.entry.status = status
    return this
  }

  updateName(): this {
    return this
  }

  end(): void {
    this.entry.ended += 1
  }

  isRecording(): boolean {
    return true
  }

  recordException(): void {
    // The adapter reports a failure through the status only, so there is nothing to record.
  }
}

/** A tracer whose active spans are recorded, so a case can read what the adapter did to them. */
class RecordingTracer implements Tracer {
  startSpan(name: string, options?: SpanOptions): Span {
    const entry: RecordedSpan = {
      name,
      attributes: { ...options?.attributes },
      ended: 0,
      status: undefined
    }
    recorded.push(entry)
    return new RecordingSpan(entry)
  }

  startActiveSpan<F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    fn: F
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    context: Context,
    fn: F
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    second: SpanOptions | F,
    third?: Context | F,
    fourth?: F
  ): ReturnType<F> {
    const options = typeof second === 'function' ? undefined : second
    const run = [second, third, fourth].find(
      (candidate): candidate is F => typeof candidate === 'function'
    )
    if (run === undefined) {
      throw new TypeError('startActiveSpan needs a callback')
    }
    return run(this.startSpan(name, options)) as ReturnType<F>
  }
}

const tracer = new RecordingTracer()

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

  // The class check on a thrown value can itself throw; the span must still end, with no text.
  it('should mark a hostile failure as unknown and end the span', async () => {
    const thrown = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('getPrototypeOf trap of the host object')
        }
      }
    )

    await new NotificationTracing()
      .span('notification.send', { channel: 'email' }, async () => {
        throw thrown
      })
      .catch(() => undefined)

    expect(recorded[0]?.status).toEqual({ code: SpanStatusCode.ERROR, message: 'unknown' })
    expect(recorded[0]?.ended).toBe(1)
  })
})
