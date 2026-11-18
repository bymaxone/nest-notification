/**
 * @fileoverview The two things the services do with an observer: run an operation inside its span,
 * and tell it what happened without ever letting it fail the operation.
 * @layer utils
 */

import type {
  INotificationObserver,
  NotificationOtpEvent,
  NotificationSendEvent,
  NotificationSpanAttributes,
  NotificationSpanName
} from '../interfaces/notification-observer.interface'

/** How the operation settled, once it has. */
type Settled<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown }

/**
 * Runs `run` inside the observer's span when it has one, and plainly when it has none, and never
 * lets the span change the operation. If the span fails before it runs the operation, the
 * operation is run here; if it fails after the operation succeeded, the operation's result is
 * returned; and if the operation itself threw, its own error is what is rethrown, whatever the span
 * made of it.
 *
 * @param observer - The observer, when one is registered.
 * @param name - The span name.
 * @param attributes - The span's starting attributes.
 * @param run - The operation.
 * @returns What `run` returns.
 */
export async function runInSpan<T>(
  observer: INotificationObserver | undefined,
  name: NotificationSpanName,
  attributes: NotificationSpanAttributes,
  run: () => Promise<T>
): Promise<T> {
  if (observer?.span === undefined) {
    return run()
  }
  let settled: Settled<T> | undefined
  const recorded = async (): Promise<T> => {
    try {
      const value = await run()
      settled = { ok: true, value }
      return value
    } catch (error) {
      settled = { ok: false, error }
      throw error
    }
  }
  try {
    return await observer.span(name, attributes, recorded)
  } catch {
    if (settled === undefined) {
      // The observer failed before it ran the operation, which must still happen.
      return run()
    }
    if (settled.ok) {
      return settled.value
    }
    // The operation's own error, not the one the observer made of it.
    throw settled.error
  }
}

/**
 * Tells the observer a send ended. A throwing observer is ignored: observing is never a reason for
 * a send to fail.
 *
 * @param observer - The observer, when one is registered.
 * @param event - What happened.
 */
export function reportSend(
  observer: INotificationObserver | undefined,
  event: NotificationSendEvent
): void {
  try {
    observer?.onSend?.(event)
  } catch {
    // Telemetry must never change the result of the operation it describes.
  }
}

/**
 * Tells the observer something happened to a code. A throwing observer is ignored.
 *
 * @param observer - The observer, when one is registered.
 * @param event - What happened.
 */
export function reportOtp(
  observer: INotificationObserver | undefined,
  event: NotificationOtpEvent
): void {
  try {
    observer?.onOtp?.(event)
  } catch {
    // Telemetry must never change the result of the operation it describes.
  }
}
