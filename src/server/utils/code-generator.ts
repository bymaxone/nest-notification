/**
 * @fileoverview CSPRNG OTP code generation.
 * @layer infrastructure
 *
 * Every code is built character-by-character from a charset using
 * `node:crypto.randomInt` (CSPRNG-backed, never `Math.random`). The numeric path
 * deliberately does NOT use `randomInt(0, 10 ** length)`: for `length >= 15` that
 * exceeds `randomInt`'s 2**48 ceiling and loses integer precision (and would drop
 * leading zeros). Per-character `randomInt(0, charset.length)` is unbiased, works
 * for any length, and preserves leading zeros naturally.
 */

import { randomInt } from 'node:crypto'

import { NotificationException } from '../errors/notification-exception'

/** Digits only. */
const NUMERIC = '0123456789'
/** Uppercase letters excluding the visually ambiguous `I` and `O`. */
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
/** Digits + uppercase letters excluding the ambiguous `0`, `1`, `I`, `O`. */
const ALPHANUMERIC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Minimum permitted code length (inclusive). */
const MIN_LENGTH = 1
/** Maximum permitted code length (inclusive). */
const MAX_LENGTH = 32

/** Resolves a code type to its confusion-free charset. */
function charsetFor(type: 'numeric' | 'alpha' | 'alphanumeric'): string {
  if (type === 'numeric') {
    return NUMERIC
  }
  if (type === 'alpha') {
    return ALPHA
  }
  return ALPHANUMERIC
}

/**
 * Generates a crypto-secure OTP code.
 *
 * @param length - Code length; an integer in `[1, 32]`.
 * @param type - Charset to draw from.
 * @returns The generated code.
 * @throws NotificationException With `OTP_INVALID_LENGTH` when `length` is not an integer in `[1, 32]`.
 */
export function generateOtpCode(
  length: number,
  type: 'numeric' | 'alpha' | 'alphanumeric'
): string {
  if (!Number.isInteger(length) || length < MIN_LENGTH || length > MAX_LENGTH) {
    throw new NotificationException('OTP_INVALID_LENGTH', {
      provided: length,
      allowed: `${MIN_LENGTH}-${MAX_LENGTH}`
    })
  }
  const charset = charsetFor(type)
  let code = ''
  for (let i = 0; i < length; i++) {
    code += charset.charAt(randomInt(0, charset.length))
  }
  return code
}
