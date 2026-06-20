/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/jsdom
 */
import { act, renderHook } from '@testing-library/react'

import { useOtpCountdown } from './useOtpCountdown'

describe('useOtpCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.setSystemTime(0)
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  // A null expiry disables the countdown entirely.
  it('should report zero/expired/00:00 when expiresAt is null', () => {
    const { result } = renderHook(() => useOtpCountdown({ expiresAt: null }))

    expect(result.current.remainingSeconds).toBe(0)
    expect(result.current.expired).toBe(true)
    expect(result.current.formatted).toBe('00:00')
  })

  // The initial remainder is derived from `expiresAt` and formatted MM:SS.
  it('should compute the initial remainder and format MM:SS', () => {
    const { result } = renderHook(() => useOtpCountdown({ expiresAt: 90_000 }))

    expect(result.current.remainingSeconds).toBe(90)
    expect(result.current.expired).toBe(false)
    expect(result.current.formatted).toBe('01:30')
  })

  // Each tick recomputes the remainder from the (faked) wall clock.
  it('should decrement on each tick', () => {
    const { result } = renderHook(() => useOtpCountdown({ expiresAt: 60_000 }))

    act(() => {
      jest.advanceTimersByTime(1000)
    })
    expect(result.current.remainingSeconds).toBe(59)

    act(() => {
      jest.advanceTimersByTime(2000)
    })
    expect(result.current.remainingSeconds).toBe(57)
  })

  // onExpired fires exactly once at zero and the interval stops afterwards.
  it('should call onExpired once at zero and stop ticking', () => {
    const onExpired = jest.fn()
    const { result } = renderHook(() => useOtpCountdown({ expiresAt: 3000, onExpired }))

    act(() => {
      jest.advanceTimersByTime(3000)
    })
    expect(result.current.remainingSeconds).toBe(0)
    expect(result.current.expired).toBe(true)
    expect(onExpired).toHaveBeenCalledTimes(1)

    act(() => {
      jest.advanceTimersByTime(5000)
    })
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  // Reaching zero without a callback must not throw.
  it('should reach zero without throwing when no onExpired is given', () => {
    const { result } = renderHook(() => useOtpCountdown({ expiresAt: 1000 }))

    act(() => {
      jest.advanceTimersByTime(1000)
    })

    expect(result.current.remainingSeconds).toBe(0)
  })

  // An hour or more switches the format to HH:MM:SS.
  it('should format HH:MM:SS once an hour or more remains', () => {
    const { result } = renderHook(() => useOtpCountdown({ expiresAt: 3_661_000 }))

    expect(result.current.formatted).toBe('01:01:01')
  })

  // A custom tick cadence fires sooner than the 1s default.
  it('should honor a custom tick interval', () => {
    const { result } = renderHook(() =>
      useOtpCountdown({ expiresAt: 60_000, tickIntervalMs: 500 })
    )

    act(() => {
      jest.advanceTimersByTime(500)
    })

    expect(result.current.remainingSeconds).toBe(59)
  })

  // Unmounting tears the interval down.
  it('should clear the interval on unmount', () => {
    const clearSpy = jest.spyOn(globalThis, 'clearInterval')
    const { unmount } = renderHook(() => useOtpCountdown({ expiresAt: 60_000 }))

    unmount()

    expect(clearSpy).toHaveBeenCalled()
  })

  // Swapping `expiresAt` recomputes the remainder without waiting for a tick.
  it('should reset immediately when expiresAt changes', () => {
    const { result, rerender } = renderHook(
      (props: { expiresAt: number }) => useOtpCountdown(props),
      { initialProps: { expiresAt: 30_000 } }
    )
    expect(result.current.remainingSeconds).toBe(30)

    rerender({ expiresAt: 120_000 })

    expect(result.current.remainingSeconds).toBe(120)
  })

  // An already-past expiry fires onExpired on mount and never starts a clock.
  it('should fire onExpired immediately and start no interval when already expired', () => {
    const onExpired = jest.fn()
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval')

    const { result } = renderHook(() => useOtpCountdown({ expiresAt: -1000, onExpired }))

    expect(result.current.remainingSeconds).toBe(0)
    expect(result.current.expired).toBe(true)
    expect(onExpired).toHaveBeenCalledTimes(1)
    expect(setIntervalSpy).not.toHaveBeenCalled()

    act(() => {
      jest.advanceTimersByTime(10_000)
    })
    expect(onExpired).toHaveBeenCalledTimes(1)
  })

  // The immediate-expiry path is safe when no onExpired callback is supplied.
  it('should reach zero immediately without throwing when already expired and no callback', () => {
    const { result } = renderHook(() => useOtpCountdown({ expiresAt: 0 }))

    expect(result.current.remainingSeconds).toBe(0)
    expect(result.current.expired).toBe(true)
  })
})
