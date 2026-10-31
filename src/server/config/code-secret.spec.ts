/**
 * @fileoverview Specifies the `otp.codeSecret` option: the validator accepts a string of at
 * least 32 UTF-8 bytes and refuses anything weaker, and the resolver exposes a digest
 * function without exposing the secret.
 * @layer domain
 */
import type { IOtpStorage } from '../interfaces'
import { MIN_CODE_SECRET_BYTES, isCodeDigest } from '../utils/code-digest'

import { resolveOptions } from './resolved-options'
import { validateOptions } from './validate-options'

const storage = {} as IOtpStorage
const otp = (codeSecret: unknown): Parameters<typeof validateOptions>[0] => ({
  otp: { storage, codeSecret: codeSecret as string }
})

describe('otp.codeSecret validation', () => {
  // The secret is the whole defence of a stored code against a reader of the store, so a
  // short one is refused at startup instead of weakening it silently.
  it.each([
    ['empty', ''],
    ['31 ASCII bytes', 'a'.repeat(MIN_CODE_SECRET_BYTES - 1)],
    ['15 two-byte characters (30 bytes)', 'é'.repeat(15)],
    ['a number', 123456],
    ['a buffer', Buffer.alloc(32)]
  ])('should refuse a secret that is %s', (_label, secret) => {
    expect(() => validateOptions(otp(secret))).toThrow(/options\.otp\.codeSecret/)
  })

  // Length is counted in bytes: 16 two-byte characters are exactly 32 bytes.
  it.each([
    ['32 ASCII bytes', 'a'.repeat(MIN_CODE_SECRET_BYTES)],
    ['16 two-byte characters', 'é'.repeat(16)],
    ['a long random secret', 'x9'.repeat(40)]
  ])('should accept a secret that is %s', (_label, secret) => {
    expect(() => validateOptions(otp(secret))).not.toThrow()
  })

  // The option is optional: omitting it selects plaintext storage.
  it('should accept an OTP section without a secret', () => {
    expect(() => validateOptions({ otp: { storage } })).not.toThrow()
  })

  // The refusal must not echo the secret: it is a startup error that reaches logs.
  it('should not echo the secret in the error', () => {
    let message = ''
    try {
      validateOptions(otp('short-secret-value'))
    } catch (error) {
      message = (error as Error).message
    }

    expect(message).not.toContain('short-secret-value')
  })
})

describe('otp.codeSecret resolution', () => {
  // With a secret the resolved options carry a digest function; without one they carry none.
  it('should expose a digest function only when a secret is configured', () => {
    const withSecret = resolveOptions({ otp: { storage, codeSecret: 'k'.repeat(32) } })
    const without = resolveOptions({ otp: { storage } })

    expect(isCodeDigest(withSecret.otp?.digestCode?.('123456') ?? '')).toBe(true)
    expect(without.otp?.digestCode).toBeUndefined()
  })

  // The resolved options are injected under a public token and can be logged or serialized:
  // the secret must not be a property of them.
  it('should not carry the secret as a property of the resolved options', () => {
    const secret = 'unmistakable-secret-material-0123456789'
    const resolved = resolveOptions({ otp: { storage, codeSecret: secret } })

    expect(JSON.stringify(resolved)).not.toContain(secret)
    expect(Object.values(resolved.otp ?? {}).some((value) => value === secret)).toBe(false)
  })
})
