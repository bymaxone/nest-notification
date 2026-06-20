/**
 * @fileoverview Public types for the React subpath (`@bymax-one/nest-notification/react`).
 * @layer api
 *
 * Option and state shapes for the browser-targeted OTP hooks. These are pure
 * type declarations — no runtime code, no `react` runtime import — so the
 * subpath stays state/UX-only and never reaches for an HTTP client or a Node
 * builtin. Only the React event/ref *types* are referenced, erased at build.
 */

import type { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject } from 'react'

/** Character class a slot accepts: digits, letters, or both. */
export type OtpInputType = 'numeric' | 'alpha' | 'alphanumeric'

/** Options for {@link useOtpInput}. All fields are optional with sensible defaults. */
export interface UseOtpInputOptions {
  /** Number of single-character slots. Default: `6`. */
  length?: number

  /** Accepted character class per slot. Default: `'numeric'`. */
  type?: OtpInputType

  /** Invoked (deferred to a microtask) once every slot is filled. */
  onComplete?: (code: string) => void | Promise<void>

  /** Whether a full code auto-fires {@link UseOtpInputOptions.onComplete}. Default: `true`. */
  autoSubmit?: boolean

  /** Whether paste input has spaces and hyphens stripped before distribution. Default: `true`. */
  sanitizeOnPaste?: boolean
}

/** Reactive state and handlers returned by {@link useOtpInput}. */
export interface UseOtpInputState {
  /** Current value of each slot (one character per slot, `''` when empty). */
  values: string[]

  /** Imperatively set a single slot's raw value. */
  setValue: (index: number, value: string) => void

  /** Per-slot change handler — attach to each input's `onChange`. */
  onChange: (index: number) => (event: ChangeEvent<HTMLInputElement>) => void

  /** Per-slot keydown handler — drives Backspace clear and Arrow navigation. */
  onKeyDown: (index: number) => (event: KeyboardEvent<HTMLInputElement>) => void

  /** Paste handler — distributes the clipboard across slots. Attach to the FIRST input only. */
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void

  /** Stable ref objects — spread onto each input as `ref={refs[i]}`. */
  refs: ReadonlyArray<RefObject<HTMLInputElement | null>>

  /** Clear every slot and move focus back to the first slot. */
  reset: () => void

  /** The slots joined into a single string. */
  code: string

  /** Whether every slot is filled. */
  isComplete: boolean
}

/** Options for {@link useOtpCountdown}. */
export interface UseOtpCountdownOptions {
  /** Unix epoch milliseconds of expiry, or `null` to disable the countdown. */
  expiresAt: number | null

  /** Recompute interval in milliseconds. Default: `1000`. */
  tickIntervalMs?: number

  /** Invoked once when the countdown first reaches zero. */
  onExpired?: () => void
}

/** Reactive state returned by {@link useOtpCountdown}. */
export interface UseOtpCountdownState {
  /** Whole seconds remaining until expiry (never negative). */
  remainingSeconds: number

  /** Whether the countdown has reached zero. */
  expired: boolean

  /** Remaining time as `MM:SS` (under one hour) or `HH:MM:SS` (one hour or more). */
  formatted: string
}
