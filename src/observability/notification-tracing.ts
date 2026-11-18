/**
 * @fileoverview Runs the services' operations inside OpenTelemetry spans. With no SDK registered the
 * API hands out a tracer that does nothing, so installing the optional peer without an SDK costs
 * nothing.
 * @layer observability
 */

import { Injectable } from '@nestjs/common'
import { SpanStatusCode, trace } from '@opentelemetry/api'

import { NotificationException } from '@bymax-one/nest-notification'
import type {
  INotificationObserver,
  NotificationSpanAttributes,
  NotificationSpanName
} from '@bymax-one/nest-notification'

import { NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE, NOTIFICATION_TRACER_NAME } from './constants'

/** The status message of a failed span: the library's error code, or a fixed word, never text. */
function statusMessageOf(error: unknown): string {
  return error instanceof NotificationException ? error.code : 'unknown'
}

/**
 * Wraps `notification.send` and `notification.otp.verify` in spans whose only attribute is the
 * channel, and whose error status carries the library's error code.
 */
@Injectable()
export class NotificationTracing implements INotificationObserver {
  /**
   * Runs `run` in a span and ends the span however it settles.
   *
   * @param name - The span name.
   * @param attributes - The starting attributes.
   * @param run - The operation.
   * @returns What `run` returns.
   * @throws Whatever `run` throws, after marking the span as an error.
   */
  span<T>(
    name: NotificationSpanName,
    attributes: NotificationSpanAttributes,
    run: () => Promise<T>
  ): Promise<T> {
    const tracer = trace.getTracer(NOTIFICATION_TRACER_NAME)
    return tracer.startActiveSpan(
      name,
      { attributes: { [NOTIFICATION_SPAN_CHANNEL_ATTRIBUTE]: attributes.channel } },
      async (span) => {
        try {
          return await run()
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: statusMessageOf(error) })
          throw error
        } finally {
          span.end()
        }
      }
    )
  }
}
