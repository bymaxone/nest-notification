/**
 * @fileoverview Holds loggableError to handing a logger a copy whose text cannot forge a line: the
 * message, the name and a string code are escaped, the original is untouched, and an error whose
 * properties throw becomes a fixed one.
 * @layer utils
 */

import { loggableError } from './loggable-error'

describe('loggableError', () => {
  it('should write a line break of the message as a visible sequence', () => {
    const copy = loggableError(new Error('550 rejected\nFAKE [LOG] line'))

    expect(copy.message).not.toContain('\n')
    expect(copy.message).toContain('550 rejected')
  })

  it('should escape the name and a string code, and leave a code that is not a string out', () => {
    const named = Object.assign(new Error('x'), { name: 'Evil\nName', code: 'E\rCODE' })
    const numeric = Object.assign(new Error('x'), { code: 550 })

    expect(loggableError(named).name).not.toContain('\n')
    expect((loggableError(named) as Error & { code?: string }).code).not.toContain('\r')
    expect('code' in loggableError(numeric)).toBe(false)
  })

  it('should return a new error and leave the original as it was', () => {
    const original = Object.assign(new Error('a\nb'), { code: 'X' })

    const copy = loggableError(original)

    expect(copy).not.toBe(original)
    expect(original.message).toBe('a\nb')
  })

  it('should carry neither the cause nor the stack of the original', () => {
    const original = new Error('boom', { cause: new Error('inner') })
    original.stack = 'Error: boom\n    at secret.js:1'

    const copy = loggableError(original)

    expect(copy.cause).toBeUndefined()
    expect(copy.stack).not.toContain('secret.js')
  })

  it('should become a fixed error when a property of the original throws', () => {
    const hostile = new Error('x')
    Object.defineProperty(hostile, 'message', {
      get: () => {
        throw new Error('getter')
      }
    })

    expect(loggableError(hostile).message).toBe('Error (unreadable)')
  })
})
