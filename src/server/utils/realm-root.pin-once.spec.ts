/**
 * @fileoverview `pinOnce` accepts a promise only on its own data `constructor` descriptor: fields a
 * planted `Object.prototype` answers for cannot make an accessor look like the pin.
 * @layer utils
 */

/** A descriptor with no prototype, so it inherits nothing a plant puts on `Object.prototype`. */
function bare(fields: object): PropertyDescriptor {
  return Object.assign(Object.create(null), fields) as PropertyDescriptor
}

import { assertStandardRealmRoot, pinOnce } from './realm-root'

afterEach(() => {
  for (const key of ['value', 'writable', 'configurable']) {
    delete (Object.prototype as Record<string, unknown>)[key]
  }
})

describe('pinOnce', () => {
  it('should not take an accessor constructor for the pin, whatever Object.prototype answers for its descriptor', () => {
    const promise = Promise.resolve(1)
    Object.defineProperty(promise, 'constructor', { configurable: false, get: () => Object })
    Object.defineProperty(
      Object.prototype,
      'value',
      bare({ configurable: true, get: () => Promise })
    )
    Object.defineProperty(
      Object.prototype,
      'writable',
      bare({ configurable: true, get: () => false })
    )

    expect(() => pinOnce(promise, 'Test')).toThrow()
  })
})

describe('assertStandardRealmRoot', () => {
  const SPECIES = Object.getOwnPropertyDescriptor(Promise, Symbol.species) as PropertyDescriptor

  afterEach(() => {
    Object.defineProperty(Promise, Symbol.species, SPECIES)
  })

  it('should refuse a realm whose Promise[Symbol.species] getter was swapped', () => {
    Object.defineProperty(Promise, Symbol.species, bare({ configurable: true, get: () => Promise }))

    expect(() => assertStandardRealmRoot('Test')).toThrow()
  })
})
