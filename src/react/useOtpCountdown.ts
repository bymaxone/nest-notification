/**
 * @fileoverview `useOtpCountdown` — reactive countdown to an OTP expiry.
 * @layer api
 *
 * Recomputes the seconds remaining until `expiresAt` on a fixed tick, fires a
 * one-shot `onExpired` callback at zero, and formats the remainder as `MM:SS`
 * (or `HH:MM:SS` past one hour). State only — no network I/O. `react` is an
 * optional peer dependency, external in the published bundle.
 */

import { useEffect, useRef, useState } from 'react'

import type { UseOtpCountdownOptions, UseOtpCountdownState } from './types'

/** Milliseconds in one second. */
const MS_PER_SECOND = 1000

/** Default recompute cadence when the caller does not specify one. */
const DEFAULT_TICK_MS = MS_PER_SECOND

/** Seconds in one minute. */
const SECONDS_PER_MINUTE = 60

/** Seconds in one hour. */
const SECONDS_PER_HOUR = 3600

/** Whole seconds remaining until `expiresAt`, never negative; `0` when disabled. */
function computeRemaining(expiresAt: number | null): number {
  if (expiresAt === null) {
    return 0
  }
  return Math.max(0, Math.floor((expiresAt - Date.now()) / MS_PER_SECOND))
}

/** Two-digit zero-padded string for a clock component. */
function pad2(value: number): string {
  return value.toString().padStart(2, '0')
}

/** Formats `totalSeconds` as `MM:SS`, or `HH:MM:SS` once it reaches one hour. */
function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return '00:00'
  }
  const hours = Math.floor(totalSeconds / SECONDS_PER_HOUR)
  const minutes = Math.floor((totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)
  const seconds = totalSeconds % SECONDS_PER_MINUTE
  if (hours > 0) {
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
  }
  return `${pad2(minutes)}:${pad2(seconds)}`
}

/**
 * Hook that exposes a live countdown to `expiresAt`.
 *
 * @param options - Expiry timestamp, tick cadence, and optional expiry callback.
 * @returns Remaining seconds, an `expired` flag, and the formatted remainder.
 */
export function useOtpCountdown(options: UseOtpCountdownOptions): UseOtpCountdownState {
  const { expiresAt, tickIntervalMs = DEFAULT_TICK_MS, onExpired } = options

  const [remainingSeconds, setRemainingSeconds] = useState<number>(() =>
    computeRemaining(expiresAt)
  )

  // Track the latest callback in a ref so the interval never fires a stale
  // closure when the consumer recreates `onExpired` each render.
  const onExpiredRef = useRef(onExpired)
  onExpiredRef.current = onExpired

  useEffect(() => {
    if (expiresAt === null) {
      setRemainingSeconds(0)
      return
    }
    // Recompute immediately so a re-render with a new `expiresAt` does not wait
    // a full tick before reflecting the change.
    setRemainingSeconds(computeRemaining(expiresAt))
    const interval = setInterval(() => {
      const remaining = computeRemaining(expiresAt)
      setRemainingSeconds(remaining)
      if (remaining === 0) {
        clearInterval(interval)
        onExpiredRef.current?.()
      }
    }, tickIntervalMs)
    return (): void => {
      clearInterval(interval)
    }
  }, [expiresAt, tickIntervalMs])

  return {
    remainingSeconds,
    expired: remainingSeconds === 0,
    formatted: formatTime(remainingSeconds)
  }
}
