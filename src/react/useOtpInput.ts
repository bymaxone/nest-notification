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

/** Stable ref objects, one per slot. */
type SlotRefs = ReadonlyArray<RefObject<HTMLInputElement | null>>

/** Completion callback signature. */
type OnComplete = (code: string) => void | Promise<void>

/** Commits a fresh slot array to state. */
type Commit = (next: string[]) => void

/** Everything the slot handlers need, recomputed when any input changes. */
interface HandlerContext {
  values: string[]
  type: OtpInputType
  length: number
  sanitizeOnPaste: boolean
  setValues: Commit
  focus: (index: number) => void
  complete: (next: readonly string[]) => void
}

/** Curried event handlers for the slot inputs. */
interface OtpHandlers {
  onChange: (index: number) => (event: ChangeEvent<HTMLInputElement>) => void
  onKeyDown: (index: number) => (event: KeyboardEvent<HTMLInputElement>) => void
  onPaste: (event: ClipboardEvent<HTMLInputElement>) => void
}

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

/** Returns a copy of `values` with the slot at `index` replaced. */
function replaceAt(values: readonly string[], index: number, value: string): string[] {
  return values.map((slot, i) => (i === index ? value : slot))
}

/** Focuses the input at `index`, ignoring negative (no wrap) and missing slots. */
function focusSlot(refs: SlotRefs, index: number): void {
  if (index < 0) {
    return
  }
  refs.at(index)?.current?.focus()
}

/**
 * Fires the completion callback in a microtask once every slot is filled, so
 * React commits the slot state before the consumer reads it. The ref is read at
 * resolution time so a callback recreated each render is never stale.
 */
function deferComplete(ref: RefObject<OnComplete | undefined>, next: readonly string[]): void {
  if (!next.every((value) => value !== '')) {
    return
  }
  const code = next.join('')
  void Promise.resolve().then(() => {
    ref.current?.(code)
  })
}

/** Applies a single-character change at `index`, advancing focus when filled. */
function applyChange(ctx: HandlerContext, index: number, rawValue: string): void {
  // Mobile Safari fires `onChange` with the whole pasted string; the paste
  // handler owns that path.
  if (rawValue.length > 1) {
    return
  }
  if (rawValue !== '' && !isValidChar(rawValue, ctx.type)) {
    return
  }
  const char = normalizeChar(rawValue, ctx.type)
  const next = replaceAt(ctx.values, index, char)
  ctx.setValues(next)
  if (char !== '') {
    ctx.focus(index + 1)
  }
  ctx.complete(next)
}

/** Handles Backspace (clear + focus previous) and Arrow navigation. */
function applyKeyDown(ctx: HandlerContext, index: number, key: string): void {
  if (key === 'Backspace' && ctx.values.at(index) === '' && index > 0) {
    ctx.setValues(replaceAt(ctx.values, index - 1, ''))
    ctx.focus(index - 1)
    return
  }
  if (key === 'ArrowLeft') {
    ctx.focus(index - 1)
    return
  }
  if (key === 'ArrowRight') {
    ctx.focus(index + 1)
  }
}

/** Distributes pasted text across slots: sanitize, filter, slice, then focus. */
function applyPaste(ctx: HandlerContext, text: string): void {
  const cleaned = ctx.sanitizeOnPaste ? text.replace(/[\s-]+/g, '') : text
  const filled = filterValid(cleaned, ctx.type).slice(0, ctx.length)
  const next = Array.from({ length: ctx.length }, (_, i) => filled.charAt(i))
  ctx.setValues(next)
  ctx.focus(filled.length - 1)
  ctx.complete(next)
}

/** Suppresses the native paste and distributes the clipboard text. */
function handlePaste(ctx: HandlerContext, event: ClipboardEvent<HTMLInputElement>): void {
  event.preventDefault()
  applyPaste(ctx, event.clipboardData.getData('text'))
}

/** Builds the three slot event handlers bound to the current context. */
function buildHandlers(ctx: HandlerContext): OtpHandlers {
  return {
    onChange: (index) => (event) => applyChange(ctx, index, event.target.value),
    onKeyDown: (index) => (event) => applyKeyDown(ctx, index, event.key),
    onPaste: (event) => handlePaste(ctx, event)
  }
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
  const refs = useMemo<SlotRefs>(() => Array.from({ length }, () => ({ current: null })), [length])

  // Track the latest callback so the deferred microtask never fires stale.
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const focus = useCallback((index: number): void => focusSlot(refs, index), [refs])
  const complete = useCallback(
    (next: readonly string[]): void => {
      if (autoSubmit) {
        deferComplete(onCompleteRef, next)
      }
    },
    [autoSubmit]
  )
  const setValue = useCallback(
    (index: number, value: string): void => setValues((prev) => replaceAt(prev, index, value)),
    []
  )
  const reset = useCallback((): void => {
    setValues(makeEmptyValues(length))
    focus(0)
  }, [length, focus])

  const handlers = useMemo(
    () => buildHandlers({ values, type, length, sanitizeOnPaste, setValues, focus, complete }),
    [values, type, length, sanitizeOnPaste, focus, complete]
  )

  return {
    values,
    setValue,
    ...handlers,
    refs,
    reset,
    code: values.join(''),
    isComplete: values.every((value) => value !== '')
  }
}
