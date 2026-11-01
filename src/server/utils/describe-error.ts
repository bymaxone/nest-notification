/**
 * @fileoverview Printable text for whatever a `catch` or a rejected promise delivered.
 * @layer utils
 */

/** What {@link describeError} answers when the value cannot be read or printed at all. */
export const UNPRINTABLE_ERROR = 'unprintable error'

/**
 * Describes a thrown or rejected value without ever throwing.
 *
 * A string `message` is read first and by shape, not by `instanceof Error`: an error from
 * another realm (a `vm` context, a worker, a transpiled dependency) fails `instanceof`
 * though it is a real error, and a plain `{ message }` is what many SDKs reject with.
 * Anything else goes through `String()`, which throws on a prototype-less object and on
 * a hostile `toString`; the same goes for a `message` getter that throws.
 *
 * @param reason - The value a `catch` clause delivered.
 * @param fallback - What to answer when the value cannot be read or printed.
 * @returns The message, the value's string form, or `fallback`.
 */
export function describeError(reason: unknown, fallback: string = UNPRINTABLE_ERROR): string {
  try {
    const message = (reason as { message?: unknown } | null | undefined)?.message
    return typeof message === 'string' ? message : String(reason)
  } catch {
    return fallback
  }
}
