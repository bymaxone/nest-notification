/**
 * @fileoverview Reads what a spy on a Nest `Logger` method was called with. The library writes the
 * structured form `{ event, message }`, so a case that wants the text of a line, or its event,
 * reads it here instead of from the first argument directly.
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
