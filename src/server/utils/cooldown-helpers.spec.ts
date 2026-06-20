import { cooldownExpiresAt, formatCooldown, toRetryAfterHeader } from './cooldown-helpers'

describe('toRetryAfterHeader', () => {
  // A whole-second value passes through unchanged.
  it('should return whole seconds verbatim', () => {
    expect(toRetryAfterHeader(47)).toBe('47')
  })

  // A fractional value rounds up — a partial second still requires waiting.
  it('should ceil a fractional value', () => {
    expect(toRetryAfterHeader(47.3)).toBe('48')
  })

  // A negative (already-expired) value clamps to zero.
  it('should clamp a negative value to "0"', () => {
    expect(toRetryAfterHeader(-5)).toBe('0')
  })
})

describe('cooldownExpiresAt', () => {
  // A positive remaining maps to a future timestamp ~now + remaining*1000.
  it('should return a future epoch-ms timestamp', () => {
    const before = Date.now()

    const expiresAt = cooldownExpiresAt(60)

    expect(expiresAt).toBeGreaterThanOrEqual(before + 60_000)
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 60_000)
  })

  // A zero remaining maps to approximately now.
  it('should return approximately now when already expired', () => {
    const before = Date.now()

    const expiresAt = cooldownExpiresAt(0)

    expect(expiresAt).toBeGreaterThanOrEqual(before)
    expect(expiresAt).toBeLessThanOrEqual(Date.now())
  })

  // A negative remaining also floors to now.
  it('should return now for a negative remaining', () => {
    const before = Date.now()

    const expiresAt = cooldownExpiresAt(-10)

    expect(expiresAt).toBeGreaterThanOrEqual(before)
    expect(expiresAt).toBeLessThanOrEqual(Date.now())
  })
})

describe('formatCooldown', () => {
  // The full formatting matrix from the acceptance criteria.
  it.each([
    [0, '0s'],
    [-3, '0s'],
    [0.4, '1s'],
    [47, '47s'],
    [125, '2m 5s'],
    [120, '2m'],
    [3725, '1h 2m 5s'],
    [3600, '1h'],
    [3661, '1h 1m 1s']
  ])('should format %p seconds as %p', (input, expected) => {
    expect(formatCooldown(input)).toBe(expected)
  })
})
