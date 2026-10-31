/**
 * @fileoverview Specifies the keyed digest an OTP code is stored under: deterministic for a
 * key, different for another key, never the code itself, and recognisable by its prefix.
 * @layer domain
 */
import {
  CODE_DIGEST_PREFIX,
  MIN_CODE_SECRET_BYTES,
  createCodeDigester,
  isCodeDigest
} from './code-digest'

const SECRET = 'a'.repeat(MIN_CODE_SECRET_BYTES)

describe('createCodeDigester', () => {
  // The same key and code must always give the same stored value, or verify cannot compare.
  it('should be deterministic for one key and one code', () => {
    const digest = createCodeDigester(SECRET)

    expect(digest('123456')).toBe(digest('123456'))
  })

  // A different code, or a different key, must give a different value.
  it('should differ by code and by key', () => {
    expect(createCodeDigester(SECRET)('123456')).not.toBe(createCodeDigester(SECRET)('123457'))
    expect(createCodeDigester(SECRET)('123456')).not.toBe(
      createCodeDigester(`b${'a'.repeat(MIN_CODE_SECRET_BYTES - 1)}`)('123456')
    )
  })

  // The stored value is a fixed-width hex digest behind the version prefix and never the code.
  it('should store a prefixed 64-hex digest that does not contain the code', () => {
    const stored = createCodeDigester(SECRET)('123456')

    expect(stored).toMatch(new RegExp(`^${CODE_DIGEST_PREFIX}[0-9a-f]{64}$`))
    expect(stored.replace(CODE_DIGEST_PREFIX, '')).not.toContain('123456')
  })

  // The digest is a keyed HMAC-SHA-256 over a domain separator and the code: pinned to a
  // known vector so a change of construction (a plain hash, a different context) fails.
  it('should match the HMAC-SHA-256 vector of the documented construction', () => {
    const stored = createCodeDigester(SECRET)('000000')

    expect(stored).toBe(
      `${CODE_DIGEST_PREFIX}f012569a166089d51968929ab36d385b9326f8e536f39921255e1408e4305f1a`
    )
  })
})

describe('isCodeDigest', () => {
  // A plaintext code (digits, letters) is never mistaken for a digest, and vice versa.
  it('should tell a digest from a plaintext code', () => {
    expect(isCodeDigest(createCodeDigester(SECRET)('123456'))).toBe(true)
    expect(isCodeDigest('123456')).toBe(false)
    expect(isCodeDigest('hmac-sha256')).toBe(false)
  })
})
