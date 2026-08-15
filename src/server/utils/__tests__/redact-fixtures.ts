/**
 * @fileoverview Shared fixtures for the redaction spec files. Lives under
 * `__tests__/`, which the coverage and mutation configs exclude.
 * @layer domain
 */

/** A value whose coercion throws a secret-bearing error — hostile by design. */
export const hostileToString = (secret: string): object => ({
  toString: (): never => {
    throw new Error(`toString leaked ${secret}`)
  }
})
