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
import type { OtpVerifyResult } from '../interfaces/otp-storage.interface'
import { own } from './realm-root'

/**
 * Runs `run` inside the observer's span when it has one, and plainly when it has none, and never
 * lets the span change the operation: the operation runs exactly once, however often the span
 * calls it, and when the span never calls it, here; and its outcome, the value or its own error, is
 * what this returns, whatever the span returned, resolved or threw.
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
    // Awaited, not returned: returning a promise from an async function reads its `then`.
    return await own(run())
  }
  let operation: Promise<T> | undefined
  const once = (): Promise<T> => {
    operation ??= run()
    return operation
  }
  try {
    await observer.span(name, attributes, once)
  } catch {
    // What the span made of the operation is not the operation's outcome.
  }
  return await own(once())
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

/**
 * What a verification result is, as the observer counts it: an accepted code is `verified`, a
 * recipient that has run into the attempt ceiling is `locked`, and any other refusal (a wrong code,
 * or none live) is `failed`.
 *
 * @param result - The answer of a verification.
 * @returns The event.
 */
export function otpEventOf(result: OtpVerifyResult): 'verified' | 'failed' | 'locked' {
  if (result.valid) {
    return 'verified'
  }
  return result.reason === 'max_attempts' ? 'locked' : 'failed'
}
