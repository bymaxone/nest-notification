import { safeCompare } from './timing-safe-compare'

describe('safeCompare', () => {
  // Identical strings must compare equal.
  it('should return true for identical strings', () => {
    expect(safeCompare('123456', '123456')).toBe(true)
  })

  // Different strings of the same length must compare unequal.
  it('should return false for different strings of the same length', () => {
    expect(safeCompare('123456', '123457')).toBe(false)
  })

  // A length mismatch must return false WITHOUT throwing — timingSafeEqual raises
  // a RangeError on unequal-length buffers, which the length guard prevents.
  it('should return false on a length mismatch without throwing', () => {
    expect(() => safeCompare('abc', 'ab')).not.toThrow()
    expect(safeCompare('abc', 'ab')).toBe(false)
  })

  // Two empty strings are equal (both zero-length buffers).
  it('should treat two empty strings as equal', () => {
    expect(safeCompare('', '')).toBe(true)
  })

  // UTF-8 multibyte content must compare correctly via the byte buffers. The
  // unequal pair keeps the same byte length so the byte comparison runs (not the
  // length guard): é and ë are both two UTF-8 bytes.
  it('should compare UTF-8 content correctly', () => {
    expect(safeCompare('café☕', 'café☕')).toBe(true)
    expect(safeCompare('café', 'cafë')).toBe(false)
  })
})
