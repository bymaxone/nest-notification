import { cooldownExpiresAt, formatCooldown, toRetryAfterHeader } from './cooldown-helpers'

describe('cooldown helpers, a count too large for milliseconds', () => {
  it('should read it as no cooldown everywhere', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000)

    expect(cooldownExpiresAt(Number.MAX_VALUE)).toBe(1000)
    expect(toRetryAfterHeader(Number.MAX_VALUE)).toBe('0')
    expect(formatCooldown(Number.MAX_VALUE)).toBe('0s')
    jest.restoreAllMocks()
  })
})

describe('cooldown helpers, the largest count that is presented', () => {
  afterEach(() => jest.restoreAllMocks())

  it('should present 2147483647 seconds as it is', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1000)

    expect(toRetryAfterHeader(2_147_483_647)).toBe('2147483647')
    expect(cooldownExpiresAt(2_147_483_647)).toBe(2_147_483_648_000)
    expect(formatCooldown(2_147_483_647)).toBe('596523h 14m 7s')
  })

  it.each([2_147_483_648, 1e21, 1e300])('should read %p seconds as no cooldown', (seconds) => {
    jest.spyOn(Date, 'now').mockReturnValue(1000)

    expect(toRetryAfterHeader(seconds)).toBe('0')
    expect(cooldownExpiresAt(seconds)).toBe(1000)
    expect(formatCooldown(seconds)).toBe('0s')
  })
})

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

describe('non-finite remaining seconds', () => {
  // A value that is not a finite number is read as "nothing left", never rendered.
  it.each([NaN, Infinity, -Infinity])('should read %p as no cooldown in every helper', (input) => {
    jest.useFakeTimers()
    jest.setSystemTime(5000)
    try {
      expect(formatCooldown(input)).toBe('0s')
      expect(toRetryAfterHeader(input)).toBe('0')
      expect(cooldownExpiresAt(input)).toBe(5000)
    } finally {
      jest.useRealTimers()
    }
  })
})
