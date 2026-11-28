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
import { accepted, isAccepted } from './accepted-answer'
import { assertStandardRealmRoot, checkedAwait, own, silence } from './realm-root'

const freezeObject = Object.freeze
const assignTo = Object.assign
const createBare = Object.create

/**
 * A frozen copy of a result, so an observer that is handed the operation cannot rewrite the answer the
 * library reads again once the span has ended. The literal and the `freeze` are not looked up at call time.
 *
 * @param value - The result of an operation.
 * @returns A frozen shallow copy.
 */
export function frozenCopy<T extends object>(value: T): Readonly<T> {
  return freezeObject(assignTo(createBare(null) as T, value))
}

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
  run: () => Promise<T>,
  owner = 'OtpService'
): Promise<T> {
  if (observer?.span === undefined) {
    // Awaited, not returned: returning a promise from an async function reads its `then`.
    return await own(run(), owner)
  }
  let operation: Promise<T> | undefined
  const once = (): Promise<T> => {
    if (operation === undefined) {
      operation = run()
      // A span that waits before it settles must not leave the operation's rejection unhandled.
      silence(operation)
    }
    return operation
  }
  let spanned: Promise<unknown> | undefined
  try {
    spanned = observer.span(name, attributes, once) as Promise<unknown>
  } catch {
    // What the span made of the operation is not the operation's outcome.
  }
  // Outside the absorbing catch: a refusal of the realm, or of a span promise that cannot be pinned,
  // is the operation's outcome, and a rejection of that promise is never left without a handler.
  const pinned = spanned === undefined ? undefined : checkedAwait(spanned, owner)
  // A span that calls the operation starts it inside itself; one that never does, or never settles, is
  // waited on for a bounded time and the operation then runs here.
  if (pinned !== undefined) {
    await own(settledWithin(pinned, SPAN_GRACE_MS), owner)
  }
  const result = await own(once(), owner)
  // The span's `end()` and the rest of the host's code ran while it was awaited: the realm is
  // checked again right before the return, which reads `then` of the result. An accepted send's
  // answer carries its own `then` and is never refused.
  if (isAccepted(result)) {
    return accepted(result as T & object)
  }
  assertStandardRealmRoot(owner)
  return result
}

/** The longest the operation's answer waits for the span's own promise to settle. */
const SPAN_GRACE_MS = 5000

/** Resolves when the promise settles either way, or after `ms`; the promise is pinned and awaited, no `then` read. */
function settledWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    void (async (): Promise<void> => {
      try {
        await promise
      } catch {
        // How the span ended is not the operation's outcome.
      }
      clearTimeout(timer)
      resolve()
    })()
  })
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
