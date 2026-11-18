/**
 * @fileoverview Reads what a spy on a Nest `Logger` method was called with. The library writes the
 * structured form `{ event, message }`, with an `err` field when an error stands behind the line,
 * so a case that wants the text of a line, its event or its error reads it here instead of from the
 * first argument directly.
 * @layer test
 */

/**
 * The text of one logged call: the `message` of the structured form, or the argument itself when
 * a caller of the logger passed a string.
 *
 * @param call - One entry of a spy's `mock.calls`.
 * @returns The text.
 */
export function loggedText(call: readonly unknown[] | undefined): string {
  const first = call?.[0]
  if (typeof first === 'object' && first !== null && 'message' in first) {
    return String((first as { message: unknown }).message)
  }
  return String(first)
}

/**
 * The `event` of one logged call, or `undefined` when it carries none.
 *
 * @param call - One entry of a spy's `mock.calls`.
 * @returns The event.
 */
export function loggedEvent(call: readonly unknown[] | undefined): string | undefined {
  const first = call?.[0]
  if (typeof first === 'object' && first !== null && 'event' in first) {
    return String((first as { event: unknown }).event)
  }
  return undefined
}

/**
 * The error a logged call carries in its `err` field, or `undefined` when it carries none.
 *
 * @param call - One entry of a spy's `mock.calls`.
 * @returns The error.
 */
export function loggedErr(call: readonly unknown[] | undefined): Error | undefined {
  const first = call?.[0]
  if (typeof first === 'object' && first !== null && 'err' in first) {
    const err = (first as { err: unknown }).err
    return err instanceof Error ? err : undefined
  }
  return undefined
}

/**
 * Everything one logged call writes: its text, and the name, message and code of its error. A case
 * that holds a secret out of the log reads this, so the error field cannot be where it hides.
 *
 * @param call - One entry of a spy's `mock.calls`.
 * @returns The text and the error's fields, joined.
 */
export function loggedAll(call: readonly unknown[] | undefined): string {
  const err = loggedErr(call) as (Error & { code?: unknown }) | undefined
  return err === undefined
    ? loggedText(call)
    : [loggedText(call), err.name, err.message, String(err.code ?? '')].join(' | ')
}
