/**
 * @jest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, RefObject } from 'react'

import { useOtpInput } from './useOtpInput'

// --- Synthetic event factories (the hook reads only these fields) ------------

const changeEvent = (value: string): ChangeEvent<HTMLInputElement> =>
  ({ target: { value } }) as unknown as ChangeEvent<HTMLInputElement>

const keyEvent = (key: string): KeyboardEvent<HTMLInputElement> =>
  ({ key }) as unknown as KeyboardEvent<HTMLInputElement>

const pasteEvent = (text: string): ClipboardEvent<HTMLInputElement> =>
  ({
    preventDefault: jest.fn(),
    clipboardData: { getData: (): string => text }
  }) as unknown as ClipboardEvent<HTMLInputElement>

// Attach a focus-spy element to every ref so `focus()` calls are observable.
const wireFocusSpies = (
  refs: ReadonlyArray<RefObject<HTMLInputElement | null>>
): jest.Mock[] =>
  refs.map((ref) => {
    const focus = jest.fn()
    ref.current = { focus } as unknown as HTMLInputElement
    return focus
  })

describe('useOtpInput', () => {
  // The hook seeds one empty slot per `length` and exposes matching refs.
  it('should initialize with `length` empty slots and derived state', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))

    expect(result.current.values).toEqual(['', '', '', '', '', ''])
    expect(result.current.refs).toHaveLength(6)
    expect(result.current.code).toBe('')
    expect(result.current.isComplete).toBe(false)
  })

  // Calling with no argument exercises the `options = {}` default path.
  it('should default to 6 numeric slots when called with no options', () => {
    const { result } = renderHook(() => useOtpInput())

    expect(result.current.values).toHaveLength(6)
  })

  // A valid digit fills its slot and advances focus to the next input.
  it('should fill a slot with a valid char and focus the next slot', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onChange(0)(changeEvent('1'))
    })

    expect(result.current.values[0]).toBe('1')
    expect(focusSpies[1]).toHaveBeenCalledTimes(1)
  })

  // With no DOM node attached, the focus call short-circuits without throwing.
  it('should not throw advancing focus when no input node is mounted', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))

    act(() => {
      result.current.onChange(0)(changeEvent('2'))
    })

    expect(result.current.values[0]).toBe('2')
  })

  // An out-of-charset character is rejected and the slot stays empty.
  it('should reject an invalid char in numeric mode', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))

    act(() => {
      result.current.onChange(0)(changeEvent('a'))
    })

    expect(result.current.values[0]).toBe('')
  })

  // Mobile Safari fires onChange with the full pasted string; it is ignored here.
  it('should ignore a multi-character onChange (paste-through)', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))

    act(() => {
      result.current.onChange(0)(changeEvent('123'))
    })

    expect(result.current.values[0]).toBe('')
  })

  // Clearing a slot (empty value) keeps focus put — no advance.
  it('should clear a slot on empty onChange without advancing focus', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))

    act(() => {
      result.current.setValue(0, '1')
    })
    const focusSpies = wireFocusSpies(result.current.refs)
    act(() => {
      result.current.onChange(0)(changeEvent(''))
    })

    expect(result.current.values[0]).toBe('')
    expect(focusSpies[1]).not.toHaveBeenCalled()
  })

  // Alpha mode upper-cases letters.
  it('should uppercase input in alpha mode', () => {
    const { result } = renderHook(() => useOtpInput({ type: 'alpha' }))

    act(() => {
      result.current.onChange(0)(changeEvent('a'))
    })

    expect(result.current.values[0]).toBe('A')
  })

  // Alphanumeric mode accepts digits and upper-cases letters.
  it('should accept digit and uppercase letter in alphanumeric mode', () => {
    const { result } = renderHook(() => useOtpInput({ type: 'alphanumeric' }))

    act(() => {
      result.current.onChange(0)(changeEvent('b'))
    })
    act(() => {
      result.current.onChange(1)(changeEvent('3'))
    })

    expect(result.current.values[0]).toBe('B')
    expect(result.current.values[1]).toBe('3')
  })

  // Backspace on an empty slot clears the previous slot and focuses it.
  it('should clear and focus the previous slot on Backspace in an empty slot', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    act(() => {
      result.current.setValue(0, '1')
    })
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onKeyDown(1)(keyEvent('Backspace'))
    })

    expect(result.current.values[0]).toBe('')
    expect(focusSpies[0]).toHaveBeenCalledTimes(1)
  })

  // Backspace on a filled slot is a no-op for the hook (the browser clears it).
  it('should not navigate on Backspace in a filled slot', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    act(() => {
      result.current.setValue(0, '1')
    })
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onKeyDown(0)(keyEvent('Backspace'))
    })

    expect(result.current.values[0]).toBe('1')
    expect(focusSpies.some((spy) => spy.mock.calls.length > 0)).toBe(false)
  })

  // Backspace on the first slot has no previous slot to clear.
  it('should do nothing on Backspace in the empty first slot', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onKeyDown(0)(keyEvent('Backspace'))
    })

    expect(result.current.values).toEqual(['', '', '', '', '', ''])
    expect(focusSpies.some((spy) => spy.mock.calls.length > 0)).toBe(false)
  })

  // ArrowLeft moves focus to the previous slot.
  it('should focus the previous slot on ArrowLeft', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onKeyDown(1)(keyEvent('ArrowLeft'))
    })

    expect(focusSpies[0]).toHaveBeenCalledTimes(1)
  })

  // ArrowLeft on the first slot must not wrap to the last slot.
  it('should not wrap focus on ArrowLeft in the first slot', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onKeyDown(0)(keyEvent('ArrowLeft'))
    })

    expect(focusSpies.some((spy) => spy.mock.calls.length > 0)).toBe(false)
  })

  // ArrowRight moves focus to the next slot.
  it('should focus the next slot on ArrowRight', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onKeyDown(0)(keyEvent('ArrowRight'))
    })

    expect(focusSpies[1]).toHaveBeenCalledTimes(1)
  })

  // ArrowRight on the last slot resolves to no input and is a no-op.
  it('should not advance focus past the last slot on ArrowRight', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onKeyDown(5)(keyEvent('ArrowRight'))
    })

    expect(focusSpies.some((spy) => spy.mock.calls.length > 0)).toBe(false)
  })

  // Keys other than Backspace/Arrows are ignored.
  it('should ignore unrelated keys', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onKeyDown(0)(keyEvent('Enter'))
    })

    expect(focusSpies.some((spy) => spy.mock.calls.length > 0)).toBe(false)
  })

  // Paste distributes characters, stripping separators and dropping invalid ones.
  it('should distribute, sanitize and filter a pasted code', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onPaste(pasteEvent('12-34a56'))
    })

    expect(result.current.values).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(focusSpies[5]).toHaveBeenCalledTimes(1)
  })

  // With sanitize disabled, separators are kept and dropped only by the validator.
  it('should keep separators out of distribution only via the validator when sanitize is off', () => {
    const { result } = renderHook(() =>
      useOtpInput({ length: 6, sanitizeOnPaste: false })
    )

    act(() => {
      result.current.onPaste(pasteEvent('a1b2c3'))
    })

    expect(result.current.values).toEqual(['1', '2', '3', '', '', ''])
  })

  // An all-invalid paste yields an empty code and focuses nothing.
  it('should focus nothing when a paste contains no valid chars', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.onPaste(pasteEvent('abcdef'))
    })

    expect(result.current.values).toEqual(['', '', '', '', '', ''])
    expect(focusSpies.some((spy) => spy.mock.calls.length > 0)).toBe(false)
  })

  // A complete code defers onComplete to a microtask and fires it once.
  it('should fire onComplete once with the full code after a microtask', async () => {
    const onComplete = jest.fn()
    const { result } = renderHook(() => useOtpInput({ length: 6, onComplete }))

    act(() => {
      result.current.onPaste(pasteEvent('123456'))
    })
    expect(onComplete).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.code).toBe('123456')
    expect(result.current.isComplete).toBe(true)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('123456')
  })

  // autoSubmit:false suppresses the completion callback.
  it('should not fire onComplete when autoSubmit is false', async () => {
    const onComplete = jest.fn()
    const { result } = renderHook(() =>
      useOtpInput({ length: 6, onComplete, autoSubmit: false })
    )

    act(() => {
      result.current.onPaste(pasteEvent('123456'))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.isComplete).toBe(true)
    expect(onComplete).not.toHaveBeenCalled()
  })

  // Completing without an onComplete callback must not throw.
  it('should complete without throwing when no onComplete is provided', async () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))

    act(() => {
      result.current.onPaste(pasteEvent('123456'))
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.isComplete).toBe(true)
  })

  // setValue writes a slot imperatively without validation.
  it('should set a slot value imperatively', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))

    act(() => {
      result.current.setValue(2, '9')
    })

    expect(result.current.values[2]).toBe('9')
  })

  // reset clears every slot and returns focus to the first slot.
  it('should clear all slots and focus the first on reset', () => {
    const { result } = renderHook(() => useOtpInput({ length: 6 }))
    act(() => {
      result.current.onPaste(pasteEvent('123456'))
    })
    const focusSpies = wireFocusSpies(result.current.refs)

    act(() => {
      result.current.reset()
    })

    expect(result.current.values).toEqual(['', '', '', '', '', ''])
    expect(result.current.code).toBe('')
    expect(focusSpies[0]).toHaveBeenCalledTimes(1)
  })

  // Filling every slot through the imperative setter runs the completion path,
  // so a programmatic fill fires onComplete just like typing or pasting.
  it('should fire onComplete once when setValue fills the final slot', async () => {
    const onComplete = jest.fn()
    const { result } = renderHook(() => useOtpInput({ length: 2, onComplete }))

    act(() => {
      result.current.setValue(0, '1')
    })
    act(() => {
      result.current.setValue(1, '2')
    })
    expect(onComplete).not.toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.code).toBe('12')
    expect(result.current.isComplete).toBe(true)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(onComplete).toHaveBeenCalledWith('12')
  })

  // autoSubmit:false suppresses the completion callback on a programmatic fill.
  it('should not fire onComplete via setValue when autoSubmit is false', async () => {
    const onComplete = jest.fn()
    const { result } = renderHook(() =>
      useOtpInput({ length: 1, onComplete, autoSubmit: false })
    )

    act(() => {
      result.current.setValue(0, '9')
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.isComplete).toBe(true)
    expect(onComplete).not.toHaveBeenCalled()
  })

  // A partial programmatic fill leaves the completion callback untouched.
  it('should not fire onComplete via setValue while a slot stays empty', async () => {
    const onComplete = jest.fn()
    const { result } = renderHook(() => useOtpInput({ length: 2, onComplete }))

    act(() => {
      result.current.setValue(0, '1')
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.isComplete).toBe(false)
    expect(onComplete).not.toHaveBeenCalled()
  })
})
