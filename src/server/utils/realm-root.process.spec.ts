/**
 * @fileoverview Holds the realm-root check to what it promises in a real process, where the realm
 * is one a test worker cannot make: a runtime without `__proto__` (`--disable-proto=delete`) is a
 * standard one, and a root that was frozen after the import is hardened and not polluted; a key
 * planted in either is still refused.
 * @layer infrastructure
 */

import { bundle, runNode } from '../__tests__/real-process.fixture'
import type { Bundle } from '../__tests__/real-process.fixture'

let lib: Bundle

beforeAll(() => {
  lib = bundle('src/server/utils/realm-root.ts')
})

afterAll(() => lib.remove())

/** A script that prints `refused` or `accepted` for a call of the check after `setup`. */
const outcome = (setup: string): string => `
${setup}
try { lib.assertStandardRealmRoot('Owner'); console.log('accepted') } catch { console.log('refused') }
`

describe('a runtime started with --disable-proto=delete', () => {
  const flags = ['--disable-proto=delete']

  it('should accept the clean realm it is', () => {
    expect(runNode(lib, outcome(''), flags).stdout.trim()).toBe('accepted')
  })

  it('should still refuse a key planted in it', () => {
    expect(runNode(lib, outcome("Object.prototype.planted = 'x'"), flags).stdout.trim()).toBe(
      'refused'
    )
  })

  it('should refuse a __proto__ that appears after the import', () => {
    const setup = `Object.defineProperty(Object.prototype, '__proto__', { get() { return null }, configurable: true })`

    expect(runNode(lib, outcome(setup), flags).stdout.trim()).toBe('refused')
  })
})

describe('a root prototype frozen after the import', () => {
  it('should be accepted, because freezing is hardening and not pollution', () => {
    expect(runNode(lib, outcome('Object.freeze(Object.prototype)')).stdout.trim()).toBe('accepted')
  })

  it('should still refuse a key planted before it was frozen', () => {
    const setup = "Object.prototype.planted = 'x'; Object.freeze(Object.prototype)"

    expect(runNode(lib, outcome(setup)).stdout.trim()).toBe('refused')
  })

  it('should accept a standard key made read-only with the same value', () => {
    const setup = `Object.defineProperty(Object.prototype, 'toString', { writable: false, configurable: false })`

    expect(runNode(lib, outcome(setup)).stdout.trim()).toBe('accepted')
  })

  it('should refuse a standard key that was changed and then made read-only', () => {
    const setup = `Object.defineProperty(Object.prototype, 'toString', { value: () => 'x', writable: false, configurable: false })`

    expect(runNode(lib, outcome(setup)).stdout.trim()).toBe('refused')
  })

  it('should refuse a standard key whose enumerability changed', () => {
    const setup = `Object.defineProperty(Object.prototype, 'toString', { enumerable: true })`

    expect(runNode(lib, outcome(setup)).stdout.trim()).toBe('refused')
  })
})
