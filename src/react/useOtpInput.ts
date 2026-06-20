/**
 * @fileoverview `useOtpInput` — multi-slot OTP entry state and UX for React.
 * @layer api
 *
 * Manages N single-character inputs: per-character validation, auto-advance,
 * Backspace/Arrow navigation, and clipboard distribution. State and UX only —
 * the hook never performs network I/O; verifying the code is the consumer's job.
 * `react` is an optional peer dependency, external in the published bundle.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject } from 'react'

import type { OtpInputType, UseOtpInputOptions, UseOtpInputState } from './types'

/** Default number of slots when the caller does not specify a length. */
const DEFAULT_LENGTH = 6

/** Single-character validation pattern for the given character class. */
function charPattern(type: OtpInputType): RegExp {
  switch (type) {
    case 'alpha':
      return /^[A-Za-z]$/
    case 'alphanumeric':
      return /^[A-Za-z0-9]$/
    default:
      return /^[0-9]$/
  }
}

/** Whether `char` is a single accepted character for `type`. */
function isValidChar(char: string, type: OtpInputType): boolean {
  return charPattern(type).test(char)
}

/** Upper-cases letters; digits are returned unchanged. */
function normalizeChar(char: string, type: OtpInputType): string {
  return type === 'numeric' ? char : char.toUpperCase()
}

/** Keeps only valid characters from `input`, normalized for `type`. */
function filterValid(input: string, type: OtpInputType): string {
  let result = ''
  for (const char of input) {
    if (isValidChar(char, type)) {
      result += normalizeChar(char, type)
    }
  }
  return result
}

/** A fresh array of `length` empty slots. */
function makeEmptyValues(length: number): string[] {
  return Array.from({ length }, () => '')
}

/**
 * Hook that manages an N-slot OTP input with auto-focus, paste distribution, and
 * Backspace/Arrow navigation.
 *
 * @param options - Length, character class, completion callback, and UX toggles.
 * @returns Slot values, event handlers, stable input refs, and derived state.
 */
export function useOtpInput(options: UseOtpInputOptions = {}): UseOtpInputState {
  const {
    length = DEFAULT_LENGTH,
    type = 'numeric',
    autoSubmit = true,
    sanitizeOnPaste = true,
    onComplete
  } = options

  const [values, setValues] = useState<string[]>(() => makeEmptyValues(length))

  // Stable ref identities so `focus()` targets the live DOM node across renders.
  const refs = useMemo<ReadonlyArray<RefObject<HTMLInputElement | null>>>(
    () => Array.from({ length }, () => ({ current: null })),
    [length]
  )

  // Track the latest callback in a ref so the deferred microtask never fires a
  // stale closure when the consumer recreates `onComplete` each render.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const focusInput = useCallback(
    (index: number): void => {
      // A negative index (Backspace/ArrowLeft at slot 0) must not wrap to the
      // last slot via `Array.at`; an index past the end resolves to `undefined`
      // and is a harmless no-op.
      if (index < 0) {
        return
      }
      refs.at(index)?.current?.focus()
    },
    [refs]
  )

  const scheduleComplete = useCallback(
    (next: readonly string[]): void => {
      if (!autoSubmit || !next.every((value) => value !== '')) {
        return
      }
      const code = next.join('')
      // Defer to a microtask so React commits the slot state before the consumer
      // reads it (e.g. issues a verify request) from inside the callback.
      void Promise.resolve().then(() => {
        onCompleteRef.current?.(code)
      })
    },
    [autoSubmit]
  )

  const setValue = useCallback((index: number, value: string): void => {
    setValues((prev) => prev.map((slot, i) => (i === index ? value : slot)))
  }, [])

  const onChange = useCallback(
    (index: number) =>
      (event: ChangeEvent<HTMLInputElement>): void => {
        const raw = event.target.value
        // Mobile Safari fires `onChange` with the whole pasted string; the paste
        // handler owns that path.
        if (raw.length > 1) {
          return
        }
        if (raw !== '' && !isValidChar(raw, type)) {
          return
        }
        const char = normalizeChar(raw, type)
        const next = values.map((slot, i) => (i === index ? char : slot))
        setValues(next)
        if (char !== '') {
          focusInput(index + 1)
        }
        scheduleComplete(next)
      },
    [values, type, focusInput, scheduleComplete]
  )

  const onKeyDown = useCallback(
    (index: number) =>
      (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'Backspace' && values.at(index) === '' && index > 0) {
          setValues(values.map((slot, i) => (i === index - 1 ? '' : slot)))
          focusInput(index - 1)
          return
        }
        if (event.key === 'ArrowLeft') {
          focusInput(index - 1)
          return
        }
        if (event.key === 'ArrowRight') {
          focusInput(index + 1)
        }
      },
    [values, focusInput]
  )

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLInputElement>): void => {
      event.preventDefault()
      const raw = event.clipboardData.getData('text')
      const sanitized = sanitizeOnPaste ? raw.replace(/[\s-]+/g, '') : raw
      const filled = filterValid(sanitized, type).slice(0, length)
      const next = Array.from({ length }, (_, i) => filled.charAt(i))
      setValues(next)
      focusInput(filled.length - 1)
      scheduleComplete(next)
    },
    [sanitizeOnPaste, type, length, focusInput, scheduleComplete]
  )

  const reset = useCallback((): void => {
    setValues(makeEmptyValues(length))
    focusInput(0)
  }, [length, focusInput])

  return {
    values,
    setValue,
    onChange,
    onKeyDown,
    onPaste,
    refs,
    reset,
    code: values.join(''),
    isComplete: values.every((value) => value !== '')
  }
}
