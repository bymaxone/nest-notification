/**
 * @fileoverview Holds the tracing adapter to rethrowing exactly what the operation threw, even when
 * the class check on that value throws: a hostile object must not replace itself with the trap's
 * error, and the span must still end.
 * @layer observability
 */

import { SpanStatusCode, trace } from '@opentelemetry/api'
import type { Span, Tracer } from '@opentelemetry/api'

import { NotificationTracing } from './notification-tracing'

const TRAP = 'getPrototypeOf trap of the host object'

describe('NotificationTracing with a hostile failure', () => {
  it('should rethrow the object the operation threw, not the error of its class check', async () => {
    const thrown = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(TRAP)
        }
      }
    )

    const running = new NotificationTracing().span(
      'notification.send',
      { channel: 'email' },
      async () => {
        throw thrown
      }
    )

    await expect(running).rejects.toBe(thrown)
  })

  it('should mark the span as an error with the status message unknown and end it', async () => {
    const statuses: Array<{ code: SpanStatusCode; message?: string | undefined }> = []
    let ended = 0
    const span = {
      setStatus: (status: { code: SpanStatusCode; message?: string | undefined }) => {
        statuses.push(status)
      },
      end: () => {
        ended += 1
      }
    } as unknown as Span
    const tracer = {
      startActiveSpan: (_name: string, _options: unknown, run: (span: Span) => unknown) => run(span)
    } as unknown as Tracer
    jest.spyOn(trace, 'getTracer').mockReturnValue(tracer)
    const thrown = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(TRAP)
        }
      }
    )

    await new NotificationTracing()
      .span('notification.send', { channel: 'email' }, async () => {
        throw thrown
      })
      .catch(() => undefined)

    expect(statuses).toEqual([{ code: SpanStatusCode.ERROR, message: 'unknown' }])
    expect(ended).toBe(1)
    jest.restoreAllMocks()
  })
})
