/**
 * @fileoverview Holds `readOptionKeys` to reading each known option once by property access, so a
 * getter that answers differently on a second read cannot pass a check with one value and be kept
 * as another, and a class that supplies its options from the prototype works like a plain object.
 * @layer utils
 */

import { readOptionKeys } from './read-options'

interface Shape {
  a?: number
  b?: string
  c?: object
}

const KEYS = ['a', 'b', 'c'] as const satisfies readonly (keyof Shape)[]

describe('readOptionKeys', () => {
  it('should read own properties into a new plain object', () => {
    const source: Shape = { a: 1, b: 'x' }

    const read = readOptionKeys(source, KEYS)

    expect(read).toEqual({ a: 1, b: 'x' })
    expect(read).not.toBe(source)
  })

  it('should read the getters of a class from its prototype', () => {
    class Options implements Shape {
      get a(): number {
        return 7
      }
      get b(): string {
        return 'x'
      }
    }

    expect(readOptionKeys<Shape>(new Options(), KEYS)).toEqual({ a: 7, b: 'x' })
  })

  it('should read each key once', () => {
    let reads = 0
    const source = {}
    Object.defineProperty(source, 'a', {
      enumerable: true,
      get: () => {
        reads += 1
        return reads === 1 ? 3 : Number.NaN
      }
    })

    expect(readOptionKeys(source as Shape, KEYS)).toEqual({ a: 3 })
    expect(reads).toBe(1)
  })

  it('should leave out a value that is undefined, and a key the list does not name', () => {
    const source = { a: undefined, b: 'x', other: 1 } as unknown as Shape

    const read = readOptionKeys(source, KEYS)

    expect(Object.keys(read)).toEqual(['b'])
  })

  it('should keep the host objects by reference', () => {
    const c = {}

    expect(readOptionKeys({ c } as Shape, KEYS).c).toBe(c)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
    ['a number', 5],
    ['an array', []],
    ['an array holding a value', ['x']]
  ])('should return %s as it is', (_label, value) => {
    expect(readOptionKeys(value as never, KEYS as never)).toBe(value)
  })
})
