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

/**
 * What the value was, in words that cannot carry it. A number, a bigint and a boolean are shown,
 * because none can hide a secret of the shapes a host puts in the wrong option. A string, a symbol,
 * a function (whose source would print), an object and an array are named by kind only: any of them
 * may be a credential, a token or a path, and a message reaches logs.
 *
 * @param value - The value the host gave.
 * @returns The words for a message.
 */
export function received(value: unknown): string {
  switch (typeof value) {
    case 'number':
    case 'bigint':
    case 'boolean':
      return String(value)
    case 'string':
      return 'a string'
    case 'symbol':
      return 'a symbol'
    case 'function':
      return 'a function'
    case 'undefined':
      return 'undefined'
    default:
      if (value === null) {
        return 'null'
      }
      return Array.isArray(value) ? 'an array' : 'an object'
  }
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
  // Past the largest safe integer a count is no longer exact, and it bounds nothing.
  if (!Number.isSafeInteger(value)) {
    throw new Error(
      `${named(path)} must be an integer of at most ${String(Number.MAX_SAFE_INTEGER)}, got ${received(value)}`
    )
  }
  if ((value as number) < min) {
    throw new Error(`${named(path)} must be at least ${String(min)}, got ${received(value)}`)
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
    throw new Error(`${named(path)} must be a finite number, got ${received(value)}`)
  }
  if ((value as number) <= bound) {
    throw new Error(`${named(path)} must be greater than ${String(bound)}, got ${received(value)}`)
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
    throw new Error(`${named(path)} must be a finite number, got ${received(value)}`)
  }
  if ((value as number) < bound) {
    throw new Error(`${named(path)} must be ${String(bound)} or greater, got ${received(value)}`)
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
    throw new Error(`${named(path)} must be an object, got ${received(value)}`)
  }
}

/**
 * Throws unless `value` is absent or exactly `true` or `false`. A string such as `'false'` is
 * truthy and would be read as `true`, so no other kind is accepted.
 *
 * @param path - The option, relative to `options`.
 * @param value - The option as the host gave it.
 */
export function assertBoolean(path: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${named(path)} must be a boolean, got ${received(value)}`)
  }
}

/**
 * Throws unless `value` is absent or a function.
 *
 * @param path - The option, relative to `options`.
 * @param value - The option as the host gave it.
 */
export function assertFunction(path: string, value: unknown): void {
  if (value !== undefined && typeof value !== 'function') {
    throw new Error(`${named(path)} must be a function, got ${received(value)}`)
  }
}
