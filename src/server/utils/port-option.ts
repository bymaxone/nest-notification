/**
 * @fileoverview Refuses a port that a socket cannot open.
 * @layer utils
 *
 * A port is an integer from 1 to 65535. `NaN`, zero, a value past the top, a fraction and a string
 * such as `'587'` are typos that would fail every send or be coerced into something nobody wrote,
 * so they are refused when the provider is built.
 */

/** The highest port a socket opens. */
export const MAX_PORT = 65_535

/**
 * Throws unless `value` is absent or an integer from `1` to {@link MAX_PORT}.
 *
 * @param owner - The component named in the message, e.g. `SmtpEmailProvider`.
 * @param value - The option as the host gave it.
 * @throws Error When `value` is present and is not a port.
 */
export function assertPort(owner: string, value: unknown): void {
  if (value === undefined) {
    return
  }
  if (!(Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_PORT)) {
    throw new Error(`${owner}: port must be an integer from 1 to ${String(MAX_PORT)}`)
  }
}
