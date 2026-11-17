/**
 * @fileoverview Number checks for module options, with messages that name the option.
 * @layer application
 *
 * A bound written as `NaN` passes a `< 1` test, because every comparison with `NaN` is false, and
 * then compares false against everything it is later held to: an attempts bound that never locks, a
 * cooldown that never holds, a TTL that never expires. Each helper therefore tests the type and the
 * finiteness before the range. The message says what the value was, because it is host
 * configuration and not caller input.
 */

/** What the value was, short enough for a message and safe for any value. */
function shown(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value.slice(0, 40))
  }
  if (typeof value === 'object' && value !== null) {
    return Array.isArray(value) ? 'an array' : 'an object'
  }
  return String(value)
}

/** The prefix every message carries. */
function named(path: string): string {
  return `[BymaxNotificationModule] options.${path}`
}

/**
 * Throws unless `value` is absent or an integer of at least `min`.
 *
 * @param path - The option, relative to `options`.
 * @param value - The option as the host gave it.
 * @param min - The smallest value accepted.
 */
export function assertIntegerAtLeast(path: string, value: unknown, min: number): void {
  if (value === undefined) {
    return
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${named(path)} must be an integer, got ${shown(value)}`)
  }
  if ((value as number) < min) {
    throw new Error(`${named(path)} must be at least ${String(min)}, got ${shown(value)}`)
  }
}

/**
 * Throws unless `value` is absent or a finite number greater than `bound`.
 *
 * @param path - The option, relative to `options`.
 * @param value - The option as the host gave it.
 * @param bound - The value it must exceed.
 */
export function assertFiniteAbove(path: string, value: unknown, bound: number): void {
  if (value === undefined) {
    return
  }
  // `Number.isFinite` does not coerce, so a string, `null` or an object is not finite.
  if (!Number.isFinite(value)) {
    throw new Error(`${named(path)} must be a finite number, got ${shown(value)}`)
  }
  if ((value as number) <= bound) {
    throw new Error(`${named(path)} must be greater than ${String(bound)}, got ${shown(value)}`)
  }
}

/**
 * Throws unless `value` is absent or a finite number of at least `bound`.
 *
 * @param path - The option, relative to `options`.
 * @param value - The option as the host gave it.
 * @param bound - The smallest value accepted.
 */
export function assertFiniteAtLeast(path: string, value: unknown, bound: number): void {
  if (value === undefined) {
    return
  }
  if (!Number.isFinite(value)) {
    throw new Error(`${named(path)} must be a finite number, got ${shown(value)}`)
  }
  if ((value as number) < bound) {
    throw new Error(`${named(path)} must be ${String(bound)} or greater, got ${shown(value)}`)
  }
}

/**
 * Throws unless `value` is an object that is not an array.
 *
 * @param path - The option, relative to `options`.
 * @param value - The option as the host gave it.
 */
export function assertObject(path: string, value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${named(path)} must be an object, got ${shown(value)}`)
  }
}
