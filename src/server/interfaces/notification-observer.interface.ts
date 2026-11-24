/**
 * @fileoverview The contract through which the services report what they do, without knowing who
 * listens. The library imports no metrics or tracing package: a host that wants either registers an
 * observer under {@link BYMAX_NOTIFICATION_OBSERVER}, and the `./observability` subpath ships one.
 * Every value here belongs to a closed set, so whatever records it cannot grow without bound.
 * @layer interfaces
 */

/** The channel a send or a code travels on. */
export type NotificationObservedChannel = 'email' | 'otp' | 'push'

/**
 * How a send ended: `sent` when the provider accepted the message, `failed` when the provider (or
 * anything else outside the library's own checks) did not, and `rejected` when the library refused
 * it before the provider was called.
 */
export type NotificationSendOutcome = 'sent' | 'failed' | 'rejected'

/** One OTP event: a code issued, a code accepted, a wrong or missing code, or a recipient locked out. */
export type NotificationOtpEventName = 'issued' | 'verified' | 'failed' | 'locked'

/** What the observer is told when a send ends. */
export interface NotificationSendEvent {
  /** The channel the send used. */
  readonly channel: NotificationObservedChannel
  /** How it ended. */
  readonly outcome: NotificationSendOutcome
  /** How long the whole operation took, in seconds. */
  readonly seconds: number
}

/** What the observer is told when something happens to a code. */
export interface NotificationOtpEvent {
  /** What happened. */
  readonly event: NotificationOtpEventName
}

/** The operations that run inside a span. */
export type NotificationSpanName = 'notification.send' | 'notification.otp.verify'

/** The attributes a span starts with: closed values only, never an identifier or a recipient. */
export interface NotificationSpanAttributes {
  /** The channel of the operation. */
  readonly channel: NotificationObservedChannel
}

/**
 * What the services call. Every member is optional, so an observer implements the part it cares
 * about, and a member that throws is ignored: observing never fails a send or a verification.
 */
export interface INotificationObserver {
  /** Called once when a send ends, whatever the outcome. */
  onSend?(event: NotificationSendEvent): void
  /** Called when a code is issued, accepted, refused or locked out. */
  onOtp?(event: NotificationOtpEvent): void
  /**
   * Runs `run` inside a span named `name` and returns what it returns. An implementation must call
   * `run` exactly once and settle the way it does.
   */
  span?<T>(
    name: NotificationSpanName,
    attributes: NotificationSpanAttributes,
    run: () => Promise<T>
  ): Promise<T>
}
