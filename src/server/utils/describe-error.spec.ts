/**
 * @fileoverview Specifies `describeError`: it answers with text for every value a `catch`
 * can deliver, and it never throws.
 * @layer utils
 */
import * as vm from 'node:vm'

import { describeError, UNPRINTABLE_ERROR } from './describe-error'

describe('describeError', () => {
  // The ordinary case.
  it('should return the message of an Error', () => {
    expect(describeError(new Error('boom'))).toBe('boom')
  })

  // `instanceof Error` is false across realms, yet the value is an error.
  it('should return the message of an Error from another realm', () => {
    const foreign: unknown = vm.runInNewContext('new Error("from another realm")')

    expect(foreign instanceof Error).toBe(false)
    expect(describeError(foreign)).toBe('from another realm')
  })

  // SDKs reject with plain objects.
  it('should return the message of a plain object', () => {
    expect(describeError({ message: 'plain' })).toBe('plain')
  })

  // `String()` throws on an object with no prototype.
  it('should not throw on an object with no prototype', () => {
    expect(describeError(Object.create(null))).toBe(UNPRINTABLE_ERROR)
  })

  it('should answer the caller fallback when the value cannot be printed', () => {
    expect(describeError(Object.create(null), '[REDACTED]')).toBe('[REDACTED]')
  })

  // A `message` getter runs consumer code.
  it('should not throw when the message getter throws', () => {
    const hostile = {
      get message(): string {
        throw new Error('getter')
      }
    }

    expect(describeError(hostile)).toBe(UNPRINTABLE_ERROR)
  })

  it('should not throw when toString throws', () => {
    const hostile = {
      toString(): string {
        throw new Error('toString')
      }
    }

    expect(describeError(hostile)).toBe(UNPRINTABLE_ERROR)
  })

  // Nothing to read a message from.
  it.each([
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['a string', 'plain text', 'plain text'],
    ['a number', 42, '42'],
    ['an object with a non-string message', { message: 7 }, '[object Object]']
  ])('should print %s', (_label, value, expected) => {
    expect(describeError(value)).toBe(expected)
  })
})
